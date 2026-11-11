/**
 * droppilot.js — Pro-only bridge to the separate Drop Pilot service.
 *
 *  - POST /api/droppilot/launch        browser (cookie auth) -> short-lived hand-off token
 *  - GET  /api/internal/droppilot/entitlement   service -> is this user Pro, balance
 *  - POST /api/internal/droppilot/ai            service -> metered AI call (keys stay here)
 *  - GET  /api/internal/droppilot/usage-report  service -> avg tokens/cost per action
 *
 * Internal routes require the x-service-key header. Prompts and replies are
 * never stored; only token counts and credit spend are logged.
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import { createModel } from "./ai-workflow.js";
import { getAIProvider } from "./ai-provider.js";
import { getBalance, spendCredits, refundCredits } from "./credits.js";
import { CREDIT_COSTS, DAILY_CAPS, MAX_OUTPUT_TOKENS, creditCost, estimateCostMicroUsd } from "./pricing.js";

const MAX_PROMPT_CHARS = 20000;

function serviceAuth(req, res, next) {
  const key = process.env.DROPPILOT_SERVICE_KEY || "";
  const sent = String(req.get("x-service-key") || "");
  const a = Buffer.from(key);
  const b = Buffer.from(sent);
  if (!key || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : c?.text || "")).join("");
  return "";
}

export function registerDropPilotRoutes(app, { isProUser }) {
  app.post("/api/droppilot/launch", requireAuth, rateLimit({ windowMs: 60 * 1000, max: 10 }), async (req, res) => {
    const secret = process.env.DROPPILOT_SHARED_SECRET;
    const base = (process.env.DROPPILOT_URL || "").replace(/\/$/, "");
    if (!secret || !base) return res.status(503).json({ error: "Drop Pilot is not available yet." });
    try {
      if (!(await isProUser(req.user.id))) {
        return res.status(403).json({ error: "Drop Pilot is part of the Pro plan.", code: "PRO_REQUIRED" });
      }
      const { rows } = await pool.query("SELECT u.email, p.display_name FROM lb_users u LEFT JOIN lb_profiles p ON p.user_id = u.id WHERE u.id = $1", [req.user.id]);
      if (!rows.length) return res.status(404).json({ error: "Account not found." });
      const token = jwt.sign(
        { uid: req.user.id, email: rows[0].email, name: rows[0].display_name || null },
        secret,
        { expiresIn: 60, jwtid: crypto.randomUUID(), audience: "droppilot", issuer: "lyricbook" }
      );
      res.json({ url: `${base}/auth/handoff?token=${encodeURIComponent(token)}` });
    } catch (err) {
      console.error("Drop Pilot launch error:", err);
      res.status(500).json({ error: "Could not open Drop Pilot." });
    }
  });

  app.get("/api/internal/droppilot/entitlement", serviceAuth, async (req, res) => {
    const uid = Number(req.query.uid);
    if (!uid) return res.status(400).json({ error: "uid required." });
    try {
      const pro = await isProUser(uid);
      const { rows } = await pool.query("SELECT 1 FROM lb_users WHERE id = $1", [uid]);
      if (!rows.length) return res.json({ exists: false, pro: false, readOnly: true, balance: null });
      const balance = await getBalance(uid, pro);
      // A lapsed Pro user keeps read-only access to what they made.
      res.json({ exists: true, pro, readOnly: !pro, balance });
    } catch (err) {
      console.error("Entitlement error:", err);
      res.status(500).json({ error: "Could not check access." });
    }
  });

  app.post("/api/internal/droppilot/ai", serviceAuth, async (req, res) => {
    const uid = Number(req.body?.uid);
    const action = String(req.body?.action || "");
    const modelTier = String(req.body?.modelTier || "standard");
    const system = String(req.body?.system || "");
    const prompt = String(req.body?.prompt || "");
    const cost = creditCost(action, modelTier);
    if (!uid || cost === null) return res.status(400).json({ error: "Invalid request.", code: "BAD_REQUEST" });
    if (system.length + prompt.length > MAX_PROMPT_CHARS) return res.status(413).json({ error: "Prompt too long.", code: "TOO_LONG" });

    let spent = null;
    let pro = false;
    try {
      pro = await isProUser(uid);
      if (!pro) return res.status(403).json({ error: "Pro required.", code: "PRO_REQUIRED" });

      // Daily abuse caps, counted from successful and failed calls alike.
      const { rows: usage } = await pool.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE action = 'campaign_generate')::int AS campaigns
           FROM lb_ai_usage WHERE user_id = $1 AND source = 'droppilot' AND created_at > NOW() - INTERVAL '24 hours'`,
        [uid]
      );
      if (usage[0].total >= DAILY_CAPS.total_calls || (action === "campaign_generate" && usage[0].campaigns >= DAILY_CAPS.campaign_generate)) {
        return res.status(429).json({ error: "Daily limit reached. Try again tomorrow.", code: "DAILY_CAP" });
      }

      const providerName = getAIProvider();
      const model = createModel(providerName);
      if (!model) return res.status(503).json({ error: "That AI model is not available right now.", code: "MODEL_UNAVAILABLE" });
      const max = MAX_OUTPUT_TOKENS[action];
      model.maxTokens = max;
      model.maxOutputTokens = max;
      model.numPredict = max;

      const ref = `dp_${action}_${crypto.randomBytes(6).toString("hex")}`;
      try {
        spent = await spendCredits(uid, pro, cost, ref);
      } catch (err) {
        if (err.code === "INSUFFICIENT") {
          return res.status(402).json({ error: "Not enough credits.", code: "INSUFFICIENT_CREDITS", needed: cost, balance: err.balance });
        }
        throw err;
      }

      let result;
      try {
        result = await model.invoke([["system", system], ["human", prompt]]);
      } catch (err) {
        const balance = await refundCredits(uid, pro, spent.parts, ref);
        await pool.query(
          "INSERT INTO lb_ai_usage (user_id, source, action, model_tier, provider, credits, ok) VALUES ($1,'droppilot',$2,$3,$4,0,FALSE)",
          [uid, action, modelTier, providerName]
        );
        console.error("Drop Pilot AI error:", err.message);
        return res.status(502).json({ error: "The AI service failed. You were not charged.", code: "PROVIDER_FAILED", balance });
      }

      const text = textOf(result.content);
      const inTok = result.usage_metadata?.input_tokens ?? Math.ceil((system.length + prompt.length) / 4);
      const outTok = result.usage_metadata?.output_tokens ?? Math.ceil(text.length / 4);
      await pool.query(
        `INSERT INTO lb_ai_usage (user_id, source, action, model_tier, provider, input_tokens, output_tokens, credits, est_cost_micro_usd)
         VALUES ($1,'droppilot',$2,$3,$4,$5,$6,$7,$8)`,
        [uid, action, modelTier, providerName, inTok, outTok, cost, providerName === "ollama" ? 0 : estimateCostMicroUsd(modelTier, inTok, outTok)]
      );
      res.json({ text, credits: cost, balance: spent.balance });
    } catch (err) {
      console.error("Drop Pilot gateway error:", err);
      if (err.status === 503) return res.status(503).json({ error: "The AI service is not configured.", code: "MODEL_UNAVAILABLE" });
      res.status(500).json({ error: "Could not complete the request.", code: "SERVER_ERROR" });
    }
  });

  app.get("/api/internal/droppilot/usage-report", serviceAuth, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT action, model_tier, COUNT(*)::int AS calls,
                ROUND(AVG(input_tokens))::int AS avg_in, ROUND(AVG(output_tokens))::int AS avg_out,
                ROUND(AVG(est_cost_micro_usd))::int AS avg_cost_micro_usd, SUM(credits)::int AS credits
           FROM lb_ai_usage WHERE source = 'droppilot' AND ok AND created_at > NOW() - INTERVAL '30 days'
          GROUP BY action, model_tier ORDER BY action, model_tier`
      );
      res.json({ days: 30, rows, configuredCosts: CREDIT_COSTS });
    } catch (err) {
      console.error("Usage report error:", err);
      res.status(500).json({ error: "Could not build the report." });
    }
  });
}
