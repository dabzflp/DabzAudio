/**
 * credits.js — AI credit balances, spending and top-up packs.
 *
 * Two buckets: the Pro monthly allowance (resets each calendar month, no
 * rollover) and purchased credits (never expire). Spending drains the monthly
 * bucket first. All balance changes run in one transaction with the row locked,
 * so two parallel requests can never overspend.
 */
import crypto from "crypto";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import { stripe, giftCurrencies } from "./payments.js";
import { paystackEnabled, paystackInitTransaction, paystackVerify } from "./paystack.js";
import { paymentProviderForCountry } from "./country-routing.js";
import { CREDIT_PACKS, PRO_MONTHLY_ALLOWANCE, CREDIT_COSTS, MODEL_TIERS, creditCost } from "./pricing.js";

function appBase() {
  const configured = (process.env.APP_BASE_URL || "https://dabzaudio.com").replace(/\/$/, "");
  return /\/lyric-book$/i.test(configured) ? configured : `${configured}/lyric-book`;
}

const period = () => new Date().toISOString().slice(0, 7);

async function lockedRow(client, userId, isPro) {
  await client.query("INSERT INTO lb_credits (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
  const { rows } = await client.query("SELECT * FROM lb_credits WHERE user_id = $1 FOR UPDATE", [userId]);
  let row = rows[0];
  const now = period();
  if (isPro && row.monthly_period !== now) {
    const upd = await client.query(
      "UPDATE lb_credits SET monthly_credits = $2, monthly_period = $3, updated_at = NOW() WHERE user_id = $1 RETURNING *",
      [userId, PRO_MONTHLY_ALLOWANCE, now]
    );
    await client.query(
      "INSERT INTO lb_credit_ledger (user_id, kind, amount, bucket, ref) VALUES ($1,'allowance',$2,'monthly',$3)",
      [userId, PRO_MONTHLY_ALLOWANCE, now]
    );
    row = upd.rows[0];
  } else if (!isPro && row.monthly_credits > 0 && row.monthly_period !== now) {
    // Allowance from a past month that was never used is gone.
    const upd = await client.query(
      "UPDATE lb_credits SET monthly_credits = 0, updated_at = NOW() WHERE user_id = $1 RETURNING *",
      [userId]
    );
    row = upd.rows[0];
  }
  return row;
}

function shape(row, isPro) {
  const monthly = isPro ? row.monthly_credits : 0;
  return { monthly, purchased: row.purchased_credits, total: monthly + row.purchased_credits, allowance: PRO_MONTHLY_ALLOWANCE };
}

export async function getBalance(userId, isPro) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await lockedRow(client, userId, isPro);
    await client.query("COMMIT");
    return shape(row, isPro);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Takes `cost` credits (monthly first). Returns {parts, balance} or throws code INSUFFICIENT. */
export async function spendCredits(userId, isPro, cost, ref) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = await lockedRow(client, userId, isPro);
    const monthly = isPro ? row.monthly_credits : 0;
    if (monthly + row.purchased_credits < cost) {
      await client.query("ROLLBACK");
      const err = new Error("Not enough credits.");
      err.code = "INSUFFICIENT";
      err.balance = shape(row, isPro);
      throw err;
    }
    const fromMonthly = Math.min(monthly, cost);
    const fromPurchased = cost - fromMonthly;
    const upd = await client.query(
      `UPDATE lb_credits
          SET monthly_credits = monthly_credits - $2, purchased_credits = purchased_credits - $3, updated_at = NOW()
        WHERE user_id = $1 RETURNING *`,
      [userId, fromMonthly, fromPurchased]
    );
    if (fromMonthly) await client.query("INSERT INTO lb_credit_ledger (user_id, kind, amount, bucket, ref) VALUES ($1,'spend',$2,'monthly',$3)", [userId, -fromMonthly, ref]);
    if (fromPurchased) await client.query("INSERT INTO lb_credit_ledger (user_id, kind, amount, bucket, ref) VALUES ($1,'spend',$2,'purchased',$3)", [userId, -fromPurchased, ref]);
    await client.query("COMMIT");
    return { parts: { monthly: fromMonthly, purchased: fromPurchased }, balance: shape(upd.rows[0], isPro) };
  } catch (err) {
    if (err.code !== "INSUFFICIENT") await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Gives back exactly what spendCredits took, when the model call failed. */
export async function refundCredits(userId, isPro, parts, ref) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockedRow(client, userId, isPro);
    const upd = await client.query(
      `UPDATE lb_credits
          SET monthly_credits = monthly_credits + $2, purchased_credits = purchased_credits + $3, updated_at = NOW()
        WHERE user_id = $1 RETURNING *`,
      [userId, parts.monthly, parts.purchased]
    );
    if (parts.monthly) await client.query("INSERT INTO lb_credit_ledger (user_id, kind, amount, bucket, ref) VALUES ($1,'refund',$2,'monthly',$3)", [userId, parts.monthly, ref]);
    if (parts.purchased) await client.query("INSERT INTO lb_credit_ledger (user_id, kind, amount, bucket, ref) VALUES ($1,'refund',$2,'purchased',$3)", [userId, parts.purchased, ref]);
    await client.query("COMMIT");
    return shape(upd.rows[0], isPro);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Marks an order paid exactly once and adds its credits. Safe to call repeatedly. */
export async function fulfilCreditOrder(reference) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "UPDATE lb_credit_orders SET status = 'paid', paid_at = NOW() WHERE reference = $1 AND status <> 'paid' RETURNING user_id, credits",
      [reference]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return false;
    }
    const { user_id: userId, credits } = rows[0];
    await client.query("INSERT INTO lb_credits (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    await client.query("UPDATE lb_credits SET purchased_credits = purchased_credits + $2, updated_at = NOW() WHERE user_id = $1", [userId, credits]);
    await client.query("INSERT INTO lb_credit_ledger (user_id, kind, amount, bucket, ref) VALUES ($1,'topup',$2,'purchased',$3)", [userId, credits, reference]);
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function failCreditOrder(reference) {
  await pool.query("UPDATE lb_credit_orders SET status = 'failed' WHERE reference = $1 AND status = 'pending'", [reference]);
}

export function packCatalog() {
  return Object.entries(CREDIT_PACKS).map(([id, p]) => ({ id, credits: p.credits, usd: p.usd / 100, ngn: p.ngn / 100 }));
}

export function pricingCatalog() {
  return {
    allowance: PRO_MONTHLY_ALLOWANCE,
    costs: Object.fromEntries(Object.keys(CREDIT_COSTS).map((a) => [a, {
      standard: creditCost(a, "standard")
    }])),
    models: Object.fromEntries(Object.entries(MODEL_TIERS).map(([k, v]) => [k, { label: v.label, multiplier: v.multiplier }])),
    packs: packCatalog()
  };
}

export function registerCreditRoutes(app, { isProUser }) {
  app.get("/api/credits", requireAuth, async (req, res) => {
    try {
      const pro = await isProUser(req.user.id);
      res.json({ pro, balance: await getBalance(req.user.id, pro), ...pricingCatalog() });
    } catch (err) {
      console.error("Credits error:", err);
      res.status(500).json({ error: "Could not load your credits." });
    }
  });

  app.post("/api/credits/checkout", requireAuth, rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), async (req, res) => {
    const pack = CREDIT_PACKS[String(req.body?.pack || "")];
    const packId = String(req.body?.pack || "");
    if (!pack) return res.status(400).json({ error: "Choose a credit pack." });
    try {
      if (!(await isProUser(req.user.id))) return res.status(403).json({ error: "Credit packs are available on the Pro plan." });
      const { rows } = await pool.query("SELECT email, country_code FROM lb_users WHERE id = $1", [req.user.id]);
      if (!rows.length) return res.status(404).json({ error: "Account not found." });
      const provider = paymentProviderForCountry(rows[0].country_code);
      const reference = `lbcr_${req.user.id}_${crypto.randomBytes(10).toString("hex")}`;

      if (provider === "paystack") {
        if (!paystackEnabled()) return res.status(503).json({ error: "Naira payments are not configured yet." });
        await pool.query(
          "INSERT INTO lb_credit_orders (user_id, pack, credits, amount, currency, provider, reference) VALUES ($1,$2,$3,$4,'ngn','paystack',$5)",
          [req.user.id, packId, pack.credits, pack.ngn, reference]
        );
        const tx = await paystackInitTransaction({
          email: rows[0].email,
          amountKobo: pack.ngn,
          reference,
          callbackUrl: `${appBase()}/subscription.html?credits=paystack&reference=${encodeURIComponent(reference)}`,
          metadata: { creditReference: reference, creditUserId: String(req.user.id) }
        });
        return res.json({ provider: "paystack", url: tx.authorization_url, reference });
      }

      const currency = String(req.body?.currency || "usd").toLowerCase();
      if (!stripe) return res.status(503).json({ error: "Card payments are not configured yet." });
      if (!giftCurrencies().includes(currency)) return res.status(400).json({ error: "Choose a supported currency." });
      await pool.query(
        "INSERT INTO lb_credit_orders (user_id, pack, credits, amount, currency, provider, reference) VALUES ($1,$2,$3,$4,$5,'stripe',$6)",
        [req.user.id, packId, pack.credits, pack.usd, currency, reference]
      );
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: rows[0].email,
        client_reference_id: String(req.user.id),
        line_items: [{
          quantity: 1,
          price_data: {
            currency,
            unit_amount: pack.usd,
            product_data: { name: `Drop Pilot AI credits — ${pack.credits}` }
          }
        }],
        metadata: { creditReference: reference, creditUserId: String(req.user.id) },
        success_url: `${appBase()}/subscription.html?credits=success`,
        cancel_url: `${appBase()}/subscription.html?credits=cancelled`
      });
      res.json({ provider: "stripe", url: session.url });
    } catch (err) {
      console.error("Credit checkout error:", err);
      res.status(500).json({ error: "Could not start the credit purchase. Please try again." });
    }
  });

  app.post("/api/credits/paystack/verify", requireAuth, async (req, res) => {
    const reference = String(req.body?.reference || "");
    try {
      const { rows } = await pool.query("SELECT user_id FROM lb_credit_orders WHERE reference = $1", [reference]);
      if (!rows.length || String(rows[0].user_id) !== String(req.user.id)) return res.status(404).json({ error: "Order not found." });
      const tx = await paystackVerify(reference);
      if (tx.status !== "success") return res.status(409).json({ error: "Payment is not confirmed yet." });
      await fulfilCreditOrder(reference);
      const pro = await isProUser(req.user.id);
      res.json({ ok: true, balance: await getBalance(req.user.id, pro) });
    } catch (err) {
      console.error("Credit verify error:", err);
      res.status(500).json({ error: "Could not verify the payment." });
    }
  });
}
