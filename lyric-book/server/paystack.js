/**
 * paystack.js — Naira (NGN) payment rail for the Lyric Book.
 *
 * Second provider alongside Stripe, chosen by currency: NGN routes here, other
 * currencies stay on Stripe. Like Stripe Connect, Paystack is the regulated
 * fund-holder — DabzAudio never holds the money:
 *   - An artist links their Nigerian bank via a Paystack *subaccount*; Paystack
 *     settles their share straight to that bank.
 *   - Gifts / invoices paid in NGN use a split transaction: the artist's
 *     subaccount gets the money, the DabzAudio platform fee is taken as a flat
 *     `transaction_charge` kept in the platform's Paystack balance.
 *
 * Fully additive & gated: every route is a no-op (503 / disabled) unless
 * PAYSTACK_SECRET_KEY is set, so the rest of the app is unaffected.
 */
import crypto from "crypto";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { displayNameForUser } from "./access.js";

const SECRET = process.env.PAYSTACK_SECRET_KEY || "";
const PUBLIC = process.env.PAYSTACK_PUBLIC_KEY || "";
const API = "https://api.paystack.co";

// Platform fee — same basis points as Stripe gifting/invoicing (10% default).
const FEE_BPS = Math.max(0, Math.min(10000, Number(process.env.PLATFORM_FEE_BPS ?? 1000)));

// Naira gift bounds (in whole naira). Kept generous; Paystack's own minimum is
// effectively a few naira. Override via env for a different floor/ceiling.
const MIN_GIFT_NGN = Math.max(1, Number(process.env.PAYSTACK_MIN_GIFT ?? 100));
const MAX_GIFT_NGN = Math.max(MIN_GIFT_NGN, Number(process.env.PAYSTACK_MAX_GIFT ?? 5000000));

export function paystackEnabled() { return !!SECRET; }
export function paystackPublicKey() { return PUBLIC; }

function feeKoboFor(amountKobo) {
  return Math.round((Number(amountKobo) || 0) * FEE_BPS / 10000);
}

// Thin Paystack REST helper. Throws a friendly Error on a non-2xx / status:false.
async function pst(path, { method = "GET", body } = {}) {
  if (!SECRET) throw new Error("Paystack isn't configured.");
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: "Bearer " + SECRET,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = {};
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || json.status === false) {
    throw new Error(json.message || `Paystack request failed (${res.status}).`);
  }
  return json.data;
}

export async function getPaystackAccountRow(userId) {
  const { rows } = await pool.query(
    "SELECT * FROM lb_paystack_accounts WHERE user_id = $1",
    [userId]
  );
  return rows[0] || null;
}

/**
 * Initialize a Paystack transaction (optionally split to a subaccount). Returns
 * { reference, access_code, authorization_url } — access_code drives the on-page
 * inline popup, authorization_url is the hosted fallback.
 */
export async function paystackInitTransaction({ email, amountKobo, subaccountCode, transactionChargeKobo, reference, metadata }) {
  const body = {
    email: email || "payer@dabzaudio.app",
    amount: Math.round(Number(amountKobo)),
    currency: "NGN",
    reference,
    metadata: metadata || {}
  };
  if (subaccountCode) {
    body.subaccount = subaccountCode;
    // Platform keeps this flat fee; the subaccount gets the rest. The platform
    // (main account) bears Paystack's processing fee, mirroring Stripe.
    if (transactionChargeKobo != null) body.transaction_charge = Math.round(Number(transactionChargeKobo));
    body.bearer = "account";
  }
  return pst("/transaction/initialize", { method: "POST", body });
}

export async function paystackVerify(reference) {
  return pst("/transaction/verify/" + encodeURIComponent(reference));
}

/* ------------------------------- Webhook -------------------------------- */

/**
 * Raw-body Paystack webhook. Mounted before express.json() in server.js so we
 * can verify the x-paystack-signature (HMAC SHA512 of the raw body, keyed by the
 * secret key). Marks gifts/invoices paid on charge.success.
 */
export function paystackWebhookHandler(req, res) {
  if (!SECRET) return res.status(200).json({ received: true });
  try {
    const signature = req.headers["x-paystack-signature"];
    const hash = crypto.createHmac("sha512", SECRET).update(req.body).digest("hex");
    if (!signature || hash !== signature) {
      return res.status(401).send("Invalid signature");
    }
  } catch (err) {
    return res.status(400).send("Webhook error");
  }
  let event;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch {
    return res.status(400).send("Bad payload");
  }
  handlePaystackEvent(event)
    .then(() => res.json({ received: true }))
    .catch((err) => {
      console.error("paystack webhook handler error", err);
      res.json({ received: true }); // 200 so Paystack doesn't retry our own bug
    });
}

async function handlePaystackEvent(event) {
  if (!event || event.event !== "charge.success") return;
  const data = event.data || {};
  const meta = data.metadata || {};
  const reference = data.reference;

  if (meta.giftId) {
    await pool.query(
      `UPDATE lb_gifts
          SET status = 'paid', paid_at = NOW(), paystack_reference = COALESCE($2, paystack_reference)
        WHERE id = $1 AND status <> 'paid'`,
      [meta.giftId, reference || null]
    );
    return;
  }
  if (meta.invoiceId) {
    // Defer to invoices.js so the sender still gets the "honored" email.
    const { honorInvoiceOnline } = await import("./invoices.js");
    await honorInvoiceOnline({ invoiceId: meta.invoiceId, provider: "paystack", reference });
  }
}

/* -------------------------------- Routes -------------------------------- */

export function registerPaystackRoutes(app) {
  // Public config for the NGN payment UI (safe values only).
  app.get("/api/paystack/config", (req, res) => {
    res.json({
      enabled: paystackEnabled(),
      publicKey: PUBLIC,
      currency: "ngn",
      feeBps: FEE_BPS,
      minAmount: MIN_GIFT_NGN,
      maxAmount: MAX_GIFT_NGN
    });
  });

  // The signed-in artist's NGN payout (subaccount) status.
  app.get("/api/paystack/account", requireAuth, async (req, res) => {
    if (!paystackEnabled()) return res.json({ enabled: false });
    try {
      const row = await getPaystackAccountRow(req.user.id);
      res.json({
        enabled: true,
        connected: !!row,
        active: !!(row && row.active),
        bankName: (row && row.bank_name) || "",
        accountName: (row && row.account_name) || "",
        accountNumberMasked: row && row.account_number
          ? "••••" + String(row.account_number).slice(-4)
          : ""
      });
    } catch (err) {
      console.error("paystack/account error", err);
      res.status(500).json({ error: "Could not load your Naira payout status." });
    }
  });

  // Naira wallet / earnings for the signed-in artist. Unlike Stripe (where gifts
  // sit in the artist's own Stripe balance until they withdraw), Paystack settles
  // a subaccount's share straight to the linked bank on Paystack's schedule — so
  // there's no held balance to "withdraw". This surfaces what has been received
  // (net of the DabzAudio fee) and where it settles, so Naira feels like real
  // receiving rather than "just added a bank".
  app.get("/api/paystack/wallet", requireAuth, async (req, res) => {
    if (!paystackEnabled()) return res.json({ enabled: false });
    try {
      const row = await getPaystackAccountRow(req.user.id);
      if (!row || !row.active) {
        return res.json({ enabled: true, active: false, currency: "ngn" });
      }
      // Net to the artist = gross minus the platform fee taken as transaction_charge.
      const agg = await pool.query(
        `SELECT status, COALESCE(SUM(amount_cents - fee_cents), 0) AS net, COUNT(*) AS n
           FROM lb_gifts
          WHERE to_user_id = $1 AND currency = 'ngn' AND provider = 'paystack'
          GROUP BY status`,
        [req.user.id]
      );
      let receivedNetKobo = 0, pendingNetKobo = 0, paidCount = 0;
      for (const r of agg.rows) {
        if (r.status === "paid") { receivedNetKobo = Number(r.net); paidCount = Number(r.n); }
        else if (r.status === "pending") { pendingNetKobo = Number(r.net); }
      }
      // Invoices honored online in NGN settle to the same bank via Paystack, so
      // fold them into the artist's earnings (manual/proof honors settle offline
      // and never touch Paystack, so they're excluded).
      const inv = await pool.query(
        `SELECT COALESCE(SUM(total_cents - fee_cents), 0) AS net, COUNT(*) AS n
           FROM lb_invoices
          WHERE from_user_id = $1 AND currency = 'ngn' AND provider = 'paystack'
            AND status = 'honored' AND honored_method = 'online'`,
        [req.user.id]
      );
      if (inv.rows[0]) {
        receivedNetKobo += Number(inv.rows[0].net || 0);
        paidCount += Number(inv.rows[0].n || 0);
      }
      res.json({
        enabled: true,
        active: true,
        currency: "ngn",
        receivedNetKobo,
        pendingNetKobo,
        paidCount,
        bankName: row.bank_name || "",
        accountName: row.account_name || "",
        accountNumberMasked: row.account_number ? "••••" + String(row.account_number).slice(-4) : "",
        // Paystack pays the subaccount's share to this bank automatically — no
        // manual withdrawal step (and DabzAudio never holds the funds).
        autoSettles: true
      });
    } catch (err) {
      console.error("paystack/wallet error", err);
      res.status(500).json({ error: "Could not load your Naira earnings." });
    }
  });

  // List Nigerian banks (for the account-setup dropdown). Cached in memory.
  let bankCache = { at: 0, banks: [] };
  app.get("/api/paystack/banks", requireAuth, async (req, res) => {
    if (!paystackEnabled()) return res.status(503).json({ error: "Naira payouts aren't configured." });
    try {
      if (Date.now() - bankCache.at > 6 * 60 * 60 * 1000 || !bankCache.banks.length) {
        const data = await pst("/bank?currency=NGN&perPage=100");
        bankCache = {
          at: Date.now(),
          banks: (data || []).map((b) => ({ name: b.name, code: b.code }))
        };
      }
      res.json({ banks: bankCache.banks });
    } catch (err) {
      console.error("paystack/banks error", err);
      res.status(500).json({ error: "Could not load banks." });
    }
  });

  // Resolve a bank account number → account holder name (confirmation step).
  app.post("/api/paystack/resolve", requireAuth, async (req, res) => {
    if (!paystackEnabled()) return res.status(503).json({ error: "Naira payouts aren't configured." });
    try {
      const accountNumber = String((req.body && req.body.accountNumber) || "").trim();
      const bankCode = String((req.body && req.body.bankCode) || "").trim();
      if (!/^\d{10}$/.test(accountNumber)) return res.status(400).json({ error: "Enter a valid 10-digit account number." });
      if (!bankCode) return res.status(400).json({ error: "Choose your bank." });
      const data = await pst(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
      res.json({ accountName: data.account_name });
    } catch (err) {
      res.status(400).json({ error: err.message || "Could not verify that account." });
    }
  });

  // Create / update the artist's Paystack subaccount so they can receive NGN.
  app.post("/api/paystack/subaccount", requireAuth, async (req, res) => {
    if (!paystackEnabled()) return res.status(503).json({ error: "Naira payouts aren't configured." });
    try {
      const bankCode = String((req.body && req.body.bankCode) || "").trim();
      const accountNumber = String((req.body && req.body.accountNumber) || "").trim();
      if (!/^\d{10}$/.test(accountNumber)) return res.status(400).json({ error: "Enter a valid 10-digit account number." });
      if (!bankCode) return res.status(400).json({ error: "Choose your bank." });

      const who = await displayNameForUser(req.user.id);
      const businessName = String((req.body && req.body.businessName) || who.name || req.user.email || "DabzAudio artist").slice(0, 100);

      // Confirm the account resolves (also gives us the holder name + bank name).
      const resolved = await pst(`/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`);
      const banks = bankCache.banks.length ? bankCache.banks : ((await pst("/bank?currency=NGN&perPage=100")) || []).map((b) => ({ name: b.name, code: b.code }));
      const bankName = (banks.find((b) => b.code === bankCode) || {}).name || "";

      const existing = await getPaystackAccountRow(req.user.id);
      let subaccountCode;
      const payload = {
        business_name: businessName,
        bank_code: bankCode,
        account_number: accountNumber,
        percentage_charge: FEE_BPS / 100,
        primary_contact_email: req.user.email || undefined
      };
      if (existing && existing.subaccount_code) {
        const data = await pst("/subaccount/" + existing.subaccount_code, { method: "PUT", body: payload });
        subaccountCode = data.subaccount_code || existing.subaccount_code;
      } else {
        const data = await pst("/subaccount", { method: "POST", body: payload });
        subaccountCode = data.subaccount_code;
      }

      await pool.query(
        `INSERT INTO lb_paystack_accounts
           (user_id, subaccount_code, business_name, bank_code, bank_name, account_number, account_name, currency, active, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ngn',TRUE, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           subaccount_code = EXCLUDED.subaccount_code,
           business_name   = EXCLUDED.business_name,
           bank_code       = EXCLUDED.bank_code,
           bank_name       = EXCLUDED.bank_name,
           account_number  = EXCLUDED.account_number,
           account_name    = EXCLUDED.account_name,
           active          = TRUE,
           updated_at      = NOW()`,
        [req.user.id, subaccountCode, businessName, bankCode, bankName, accountNumber, resolved.account_name]
      );

      res.json({ ok: true, active: true, accountName: resolved.account_name, bankName });
    } catch (err) {
      console.error("paystack/subaccount error", err);
      res.status(400).json({ error: err.message || "Could not set up Naira payouts." });
    }
  });

  // Send a Naira gift → returns an access code for the on-page inline popup.
  app.post("/api/gifts/paystack", requireAuth, async (req, res) => {
    if (!paystackEnabled()) return res.status(503).json({ error: "Naira gifting isn't configured." });
    try {
      const toUserId = Number(req.body.toUserId);
      const lyricId = req.body.lyricId ? Number(req.body.lyricId) : null;
      const amount = Number(req.body.amount);
      const message = String((req.body && req.body.message) || "").slice(0, 500);
      if (!toUserId) return res.status(400).json({ error: "Pick an artist to gift." });
      if (toUserId === req.user.id) return res.status(400).json({ error: "You can't gift yourself." });
      if (!(amount >= MIN_GIFT_NGN && amount <= MAX_GIFT_NGN)) {
        return res.status(400).json({ error: `Enter an amount between ${MIN_GIFT_NGN} and ${MAX_GIFT_NGN}.` });
      }

      const recipient = await getPaystackAccountRow(toUserId);
      if (!recipient || !recipient.active) {
        return res.status(400).json({ error: "This artist hasn't set up Naira payouts yet." });
      }

      const amountKobo = Math.round(amount * 100);
      const feeKobo = feeKoboFor(amountKobo);
      const ins = await pool.query(
        `INSERT INTO lb_gifts (from_user_id, to_user_id, lyric_id, amount_cents, fee_cents, currency, message, status, provider)
         VALUES ($1,$2,$3,$4,$5,'ngn',$6,'pending','paystack') RETURNING id`,
        [req.user.id, toUserId, lyricId, amountKobo, feeKobo, message]
      );
      const giftId = ins.rows[0].id;
      const reference = "lbgift_" + giftId + "_" + crypto.randomBytes(6).toString("hex");
      const tx = await paystackInitTransaction({
        email: req.user.email,
        amountKobo,
        subaccountCode: recipient.subaccount_code,
        transactionChargeKobo: feeKobo,
        reference,
        metadata: { giftId: String(giftId) }
      });
      await pool.query("UPDATE lb_gifts SET paystack_reference = $2 WHERE id = $1", [giftId, reference]);

      res.json({
        giftId,
        reference: tx.reference,
        accessCode: tx.access_code,
        authorizationUrl: tx.authorization_url,
        publicKey: PUBLIC,
        email: req.user.email
      });
    } catch (err) {
      console.error("gifts/paystack error", err);
      res.status(500).json({ error: err.message || "Could not start the gift." });
    }
  });

  // Confirm a Naira gift right after the inline popup succeeds (webhook remains
  // the source of truth, but this updates the UI instantly).
  app.post("/api/gifts/paystack/verify", requireAuth, async (req, res) => {
    if (!paystackEnabled()) return res.status(503).json({ error: "Not available." });
    try {
      const reference = String((req.body && req.body.reference) || "");
      if (!reference) return res.status(400).json({ error: "Missing reference." });
      const { rows } = await pool.query(
        "SELECT * FROM lb_gifts WHERE paystack_reference = $1 AND from_user_id = $2",
        [reference, req.user.id]
      );
      const gift = rows[0];
      if (!gift) return res.status(404).json({ error: "Gift not found." });
      if (gift.status === "paid") return res.json({ paid: true });
      const tx = await paystackVerify(reference);
      if (tx && tx.status === "success") {
        await pool.query(
          "UPDATE lb_gifts SET status='paid', paid_at=NOW() WHERE id=$1 AND status<>'paid'",
          [gift.id]
        );
        return res.json({ paid: true });
      }
      res.json({ paid: false });
    } catch (err) {
      console.error("gifts/paystack/verify error", err);
      res.status(500).json({ error: "Could not verify payment." });
    }
  });
}
