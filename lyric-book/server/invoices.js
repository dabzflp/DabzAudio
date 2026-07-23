/**
 * invoices.js
 * Invoicing for the Lyric Book.
 *
 * A signed-in user (the "sender") bills anyone by email. The recipient does NOT
 * need a DabzAudio account — they get a secure public link where they can:
 *   1. Pay online (Stripe Checkout routed to the sender's connected account,
 *      minus the DabzAudio platform fee) → auto-marked Honored, or
 *   2. Upload proof of an offline payment → Awaiting confirmation, or
 *   the sender can manually mark it Honored (for cash / offline payments).
 *
 * Tax: per-invoice choice of none / VAT-exclusive / VAT-inclusive with an
 * editable rate + label. The tax is the sender's own liability — DabzAudio just
 * computes and displays it; we are a tool, not the merchant of record.
 *
 * Fully additive: online payment needs STRIPE_SECRET_KEY (same as gifting); the
 * rest (create / send / proof / manual-honor) works without Stripe.
 */
import Stripe from "stripe";
import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { displayNameForUser } from "./access.js";
import { sendInvoiceEmail, sendInvoiceHonoredEmail, sendInvoiceProofEmail } from "./email.js";
import {
  paystackEnabled,
  paystackPublicKey,
  paystackInitTransaction,
  paystackVerify,
  getPaystackAccountRow
} from "./paystack.js";

const SECRET = process.env.STRIPE_SECRET_KEY || "";
const stripe = SECRET ? new Stripe(SECRET) : null;
const PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
const EMBEDDED = !!(stripe && PUBLISHABLE_KEY);

// Same platform fee as gifting — DabzAudio keeps a % of any invoice paid online.
const FEE_BPS = Math.max(0, Math.min(10000, Number(process.env.PLATFORM_FEE_BPS ?? 1000)));
const DEFAULT_CURRENCY = (process.env.GIFT_CURRENCY || "gbp").toLowerCase();

// A short, sane set of currencies the picker offers. Any ISO code the sender's
// Stripe account supports would work; these are the common ones for the audience.
const CURRENCIES = ["gbp", "usd", "eur", "ngn", "cad", "aud"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAX_MODES = new Set(["none", "exclusive", "inclusive"]);
const MAX_ITEMS = 50;

function appBase() {
  return (process.env.APP_BASE_URL || "https://dabzaudio.netlify.app/lyric-book").replace(/\/$/, "");
}

function stripeError(res, err, fallback) {
  const msg = (err && err.raw && err.raw.message) || (err && err.message) || "";
  if (/signed up for Connect/i.test(msg)) {
    return res.status(503).json({ error: "Online payment isn't enabled yet. The DabzAudio team needs to activate Stripe Connect." });
  }
  if (err && err.type === "StripeInvalidRequestError" && msg) {
    return res.status(400).json({ error: msg });
  }
  return res.status(500).json({ error: fallback });
}

// Compute subtotal / tax / total (all in minor units) from line items + tax rule.
// - none:      tax 0, total = subtotal
// - exclusive: tax added on top of the subtotal
// - inclusive: subtotal already contains the tax; we back it out for display
function computeTotals(items, taxMode, taxRateBps) {
  const subtotal = items.reduce((s, it) => s + Math.round(it.quantity * it.unitCents), 0);
  let tax = 0;
  let total = subtotal;
  if (taxMode === "exclusive" && taxRateBps > 0) {
    tax = Math.round((subtotal * taxRateBps) / 10000);
    total = subtotal + tax;
  } else if (taxMode === "inclusive" && taxRateBps > 0) {
    total = subtotal;
    tax = subtotal - Math.round((subtotal * 10000) / (10000 + taxRateBps));
  }
  return { subtotal, tax, total };
}

function feeCentsFor(totalCents) {
  if (!FEE_BPS) return 0;
  return Math.floor((totalCents * FEE_BPS) / 10000);
}

// Parse + validate the invoice payload shared by create and update. Amounts come
// from the client in major units (e.g. 12.50) and are converted to minor units.
function parseInvoiceBody(body) {
  const toEmail = String(body.toEmail || "").trim().toLowerCase();
  if (!EMAIL_RE.test(toEmail)) return { error: "Enter a valid email address for the recipient." };

  const toName = String(body.toName || "").trim().slice(0, 120);
  const currency = CURRENCIES.includes(String(body.currency || "").toLowerCase())
    ? String(body.currency).toLowerCase()
    : DEFAULT_CURRENCY;
  const note = String(body.note || "").slice(0, 2000);

  let taxMode = String(body.taxMode || "none").toLowerCase();
  if (!TAX_MODES.has(taxMode)) taxMode = "none";
  let taxRateBps = Math.round(Number(body.taxRateBps || 0));
  if (!Number.isFinite(taxRateBps) || taxRateBps < 0) taxRateBps = 0;
  if (taxRateBps > 10000) taxRateBps = 10000;
  if (taxMode === "none") taxRateBps = 0;
  const taxLabel = (String(body.taxLabel || "VAT").trim() || "VAT").slice(0, 24);

  let dueDate = null;
  if (body.dueDate) {
    const d = new Date(body.dueDate);
    if (!isNaN(d.getTime())) dueDate = d.toISOString().slice(0, 10);
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = [];
  for (const it of rawItems.slice(0, MAX_ITEMS)) {
    const description = String(it.description || "").trim().slice(0, 300);
    const quantity = Number(it.quantity);
    const unitAmount = Number(it.unitAmount);
    if (!description) continue;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (!Number.isFinite(unitAmount) || unitAmount < 0) continue;
    items.push({ description, quantity, unitCents: Math.round(unitAmount * 100) });
  }
  if (!items.length) return { error: "Add at least one line item with a description and amount." };

  const totals = computeTotals(items, taxMode, taxRateBps);
  if (totals.total <= 0) return { error: "The invoice total must be greater than zero." };

  return { toEmail, toName, currency, note, taxMode, taxRateBps, taxLabel, dueDate, items, totals };
}

function newToken() {
  return crypto.randomBytes(24).toString("hex");
}

function invoiceNumber(id) {
  return "INV-" + String(id).padStart(5, "0");
}

async function loadItems(invoiceId) {
  const { rows } = await pool.query(
    "SELECT description, quantity, unit_cents FROM lb_invoice_items WHERE invoice_id = $1 ORDER BY position ASC, id ASC",
    [invoiceId]
  );
  return rows.map((r) => ({
    description: r.description,
    quantity: Number(r.quantity),
    unitCents: Number(r.unit_cents)
  }));
}

async function loadProofs(invoiceId) {
  const { rows } = await pool.query(
    "SELECT id, file_url, note, uploaded_by_email, created_at FROM lb_invoice_proofs WHERE invoice_id = $1 ORDER BY created_at DESC",
    [invoiceId]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    fileUrl: r.file_url,
    note: r.note || "",
    uploadedBy: r.uploaded_by_email || "",
    createdAt: r.created_at
  }));
}

function mapInvoice(r, extra = {}) {
  return {
    id: Number(r.id),
    number: invoiceNumber(r.id),
    toEmail: r.to_email,
    toName: r.to_name || "",
    currency: r.currency,
    note: r.note || "",
    taxMode: r.tax_mode,
    taxRateBps: Number(r.tax_rate_bps),
    taxLabel: r.tax_label || "VAT",
    subtotalCents: Number(r.subtotal_cents),
    taxCents: Number(r.tax_cents),
    totalCents: Number(r.total_cents),
    feeCents: Number(r.fee_cents || 0),
    status: r.status,
    honoredMethod: r.honored_method || null,
    honoredSeen: !!r.honored_seen,
    publicToken: r.public_token || null,
    dueDate: r.due_date || null,
    createdAt: r.created_at,
    sentAt: r.sent_at || null,
    honoredAt: r.honored_at || null,
    ...extra
  };
}

// Insert the item rows for an invoice (used by create + update).
async function insertItems(client, invoiceId, items) {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await client.query(
      `INSERT INTO lb_invoice_items (invoice_id, description, quantity, unit_cents, position)
       VALUES ($1,$2,$3,$4,$5)`,
      [invoiceId, it.description, it.quantity, it.unitCents, i]
    );
  }
}

/**
 * Webhook hook, called from the shared Stripe webhook in payments.js. Marks an
 * invoice Honored when its Checkout completes. No-op for non-invoice events.
 */
export async function handleInvoiceEvent(event) {
  if (event.type !== "checkout.session.completed") return;
  const session = event.data.object;
  const invoiceId = session.metadata && session.metadata.invoiceId;
  if (!invoiceId) return;
  await honorInvoiceOnline({
    invoiceId,
    provider: "stripe",
    paymentIntentId: session.payment_intent || null
  });
}

/**
 * Mark an invoice Honored after a verified online payment (Stripe webhook or
 * Paystack charge.success) and notify the sender. Idempotent: a no-op if the
 * invoice is already honored. Shared by both payment rails.
 */
export async function honorInvoiceOnline({ invoiceId, provider = "stripe", paymentIntentId = null, reference = null }) {
  const { rows } = await pool.query(
    `UPDATE lb_invoices
        SET status = 'honored', honored_method = 'online', honored_at = NOW(),
            honored_seen = FALSE, provider = $3,
            stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
            paystack_reference = COALESCE($4, paystack_reference),
            updated_at = NOW()
      WHERE id = $1 AND status <> 'honored'
      RETURNING *`,
    [invoiceId, paymentIntentId, provider, reference]
  );
  const inv = rows[0];
  if (!inv) return null;
  try {
    const sender = await senderContact(inv.from_user_id);
    await sendInvoiceHonoredEmail(sender.email, {
      senderName: sender.name,
      number: invoiceNumber(inv.id),
      payer: inv.to_name || inv.to_email,
      amount: formatMoney(inv.total_cents, inv.currency),
      method: "online payment"
    });
  } catch (e) {
    console.error("invoice honored email error", e?.message);
  }
  return inv;
}

async function senderContact(userId) {
  const { rows } = await pool.query(
    `SELECT u.email, COALESCE(NULLIF(p.artist_name,''), NULLIF(p.display_name,''), u.email) AS name
       FROM lb_users u LEFT JOIN lb_profiles p ON p.user_id = u.id WHERE u.id = $1`,
    [userId]
  );
  return { email: (rows[0] && rows[0].email) || "", name: (rows[0] && rows[0].name) || "A DabzAudio artist" };
}

function formatMoney(cents, currency) {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: String(currency || DEFAULT_CURRENCY).toUpperCase() })
      .format((Number(cents) || 0) / 100);
  } catch {
    return String(currency || DEFAULT_CURRENCY).toUpperCase() + " " + ((Number(cents) || 0) / 100).toFixed(2);
  }
}

export function registerInvoiceRoutes(app) {
  // Meta for the invoice UI (safe values only).
  app.get("/api/invoices/meta", requireAuth, async (req, res) => {
    let payoutsEnabled = false;
    if (stripe) {
      try {
        const { rows } = await pool.query(
          "SELECT payouts_enabled FROM lb_stripe_accounts WHERE user_id = $1",
          [req.user.id]
        );
        payoutsEnabled = !!(rows[0] && rows[0].payouts_enabled);
      } catch { /* ignore */ }
    }
    let ngnPayEnabled = false;
    if (paystackEnabled()) {
      try {
        const pa = await getPaystackAccountRow(req.user.id);
        ngnPayEnabled = !!(pa && pa.active);
      } catch { /* ignore */ }
    }
    res.json({
      onlinePayEnabled: !!stripe,
      payoutsEnabled,
      feeBps: FEE_BPS,
      defaultCurrency: DEFAULT_CURRENCY,
      currencies: CURRENCIES,
      embedded: EMBEDDED,
      publishableKey: PUBLISHABLE_KEY,
      // Paystack (Naira) rail for the sender.
      paystackEnabled: paystackEnabled(),
      ngnPayEnabled
    });
  });

  // List the current user's invoices (they are the biller/sender).
  app.get("/api/invoices", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM lb_invoices WHERE from_user_id = $1 ORDER BY created_at DESC LIMIT 200",
        [req.user.id]
      );
      const invoices = [];
      for (const r of rows) {
        invoices.push(mapInvoice(r, { items: await loadItems(r.id) }));
      }
      const counts = { drafts: 0, sent: 0, awaiting: 0, honored: 0, cancelled: 0 };
      let unseenHonored = 0;
      for (const inv of invoices) {
        if (inv.status === "draft") counts.drafts++;
        else if (inv.status === "sent" || inv.status === "viewed") counts.sent++;
        else if (inv.status === "awaiting_confirmation") counts.awaiting++;
        else if (inv.status === "honored") counts.honored++;
        else if (inv.status === "cancelled") counts.cancelled++;
        if (inv.status === "honored" && !inv.honoredSeen) unseenHonored++;
      }
      // Badge = things needing the sender's attention.
      res.json({ invoices, counts, unseenHonored, badge: unseenHonored + counts.awaiting });
    } catch (err) {
      console.error("invoices list error", err);
      res.status(500).json({ error: "Could not load invoices." });
    }
  });

  // Full invoice (owner only), including proofs.
  app.get("/api/invoices/:id", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM lb_invoices WHERE id = $1 AND from_user_id = $2",
        [Number(req.params.id), req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Invoice not found." });
      const inv = rows[0];
      res.json({ invoice: mapInvoice(inv, { items: await loadItems(inv.id), proofs: await loadProofs(inv.id) }) });
    } catch (err) {
      console.error("invoice get error", err);
      res.status(500).json({ error: "Could not load invoice." });
    }
  });

  // Create an invoice (draft, or send immediately with { send: true }).
  app.post("/api/invoices", requireAuth, async (req, res) => {
    const parsed = parseInvoiceBody(req.body || {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (parsed.toEmail === String(req.user.email).toLowerCase()) {
      return res.status(400).json({ error: "You can't invoice your own account." });
    }
    const send = !!req.body.send;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const payer = await client.query("SELECT id FROM lb_users WHERE email = $1", [parsed.toEmail]);
      const toUserId = payer.rows[0] ? payer.rows[0].id : null;
      const token = send ? newToken() : null;
      const status = send ? "sent" : "draft";
      const ins = await client.query(
        `INSERT INTO lb_invoices
           (from_user_id, to_user_id, to_email, to_name, currency, note, tax_mode, tax_rate_bps, tax_label,
            subtotal_cents, tax_cents, total_cents, status, public_token, due_date, sent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, CASE WHEN $13='sent' THEN NOW() ELSE NULL END)
         RETURNING *`,
        [
          req.user.id, toUserId, parsed.toEmail, parsed.toName, parsed.currency, parsed.note,
          parsed.taxMode, parsed.taxRateBps, parsed.taxLabel,
          parsed.totals.subtotal, parsed.totals.tax, parsed.totals.total,
          status, token, parsed.dueDate
        ]
      );
      const inv = ins.rows[0];
      await insertItems(client, inv.id, parsed.items);
      await client.query("COMMIT");

      if (send) await emailInvoice(req, inv, !!toUserId);
      res.status(201).json({ invoice: mapInvoice(inv, { items: parsed.items }) });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("invoice create error", err);
      res.status(500).json({ error: "Could not create invoice." });
    } finally {
      client.release();
    }
  });

  // Update a draft (only drafts are editable).
  app.put("/api/invoices/:id", requireAuth, async (req, res) => {
    const parsed = parseInvoiceBody(req.body || {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const cur = await client.query(
        "SELECT * FROM lb_invoices WHERE id = $1 AND from_user_id = $2 FOR UPDATE",
        [Number(req.params.id), req.user.id]
      );
      if (!cur.rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Invoice not found." }); }
      if (cur.rows[0].status !== "draft") {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Only draft invoices can be edited." });
      }
      const payer = await client.query("SELECT id FROM lb_users WHERE email = $1", [parsed.toEmail]);
      const toUserId = payer.rows[0] ? payer.rows[0].id : null;
      const upd = await client.query(
        `UPDATE lb_invoices SET
           to_user_id=$2, to_email=$3, to_name=$4, currency=$5, note=$6, tax_mode=$7, tax_rate_bps=$8,
           tax_label=$9, subtotal_cents=$10, tax_cents=$11, total_cents=$12, due_date=$13, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [
          cur.rows[0].id, toUserId, parsed.toEmail, parsed.toName, parsed.currency, parsed.note,
          parsed.taxMode, parsed.taxRateBps, parsed.taxLabel,
          parsed.totals.subtotal, parsed.totals.tax, parsed.totals.total, parsed.dueDate
        ]
      );
      await client.query("DELETE FROM lb_invoice_items WHERE invoice_id = $1", [cur.rows[0].id]);
      await insertItems(client, cur.rows[0].id, parsed.items);
      await client.query("COMMIT");
      res.json({ invoice: mapInvoice(upd.rows[0], { items: parsed.items }) });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("invoice update error", err);
      res.status(500).json({ error: "Could not update invoice." });
    } finally {
      client.release();
    }
  });

  // Send (or resend) an invoice.
  app.post("/api/invoices/:id/send", requireAuth, async (req, res) => {
    try {
      const cur = await pool.query(
        "SELECT * FROM lb_invoices WHERE id = $1 AND from_user_id = $2",
        [Number(req.params.id), req.user.id]
      );
      if (!cur.rows.length) return res.status(404).json({ error: "Invoice not found." });
      let inv = cur.rows[0];
      if (inv.status === "honored" || inv.status === "cancelled") {
        return res.status(400).json({ error: "This invoice can no longer be sent." });
      }
      const token = inv.public_token || newToken();
      const upd = await pool.query(
        `UPDATE lb_invoices SET public_token=$2, status = CASE WHEN status='draft' THEN 'sent' ELSE status END,
           sent_at = COALESCE(sent_at, NOW()), updated_at = NOW() WHERE id=$1 RETURNING *`,
        [inv.id, token]
      );
      inv = upd.rows[0];
      const emailed = await emailInvoice(req, inv, !!inv.to_user_id);
      res.json({ ok: true, emailed, invoice: mapInvoice(inv, { items: await loadItems(inv.id) }) });
    } catch (err) {
      console.error("invoice send error", err);
      res.status(500).json({ error: "Could not send invoice." });
    }
  });

  // Sender manually marks an invoice honored (paid offline / cash).
  app.post("/api/invoices/:id/mark-honored", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE lb_invoices SET status='honored', honored_method='manual', honored_at=NOW(),
            honored_seen=TRUE, updated_at=NOW()
          WHERE id=$1 AND from_user_id=$2 AND status NOT IN ('honored','cancelled')
          RETURNING *`,
        [Number(req.params.id), req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Invoice not found or already settled." });
      res.json({ ok: true, invoice: mapInvoice(rows[0], { items: await loadItems(rows[0].id) }) });
    } catch (err) {
      console.error("invoice mark-honored error", err);
      res.status(500).json({ error: "Could not update invoice." });
    }
  });

  // Sender confirms a proof-of-payment upload → Honored.
  app.post("/api/invoices/:id/confirm", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE lb_invoices SET status='honored', honored_method='proof', honored_at=NOW(),
            honored_seen=TRUE, updated_at=NOW()
          WHERE id=$1 AND from_user_id=$2 AND status='awaiting_confirmation'
          RETURNING *`,
        [Number(req.params.id), req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: "No proof awaiting your confirmation." });
      res.json({ ok: true, invoice: mapInvoice(rows[0], { items: await loadItems(rows[0].id) }) });
    } catch (err) {
      console.error("invoice confirm error", err);
      res.status(500).json({ error: "Could not confirm invoice." });
    }
  });

  // Cancel an invoice (not once honored).
  app.post("/api/invoices/:id/cancel", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `UPDATE lb_invoices SET status='cancelled', updated_at=NOW()
          WHERE id=$1 AND from_user_id=$2 AND status <> 'honored' RETURNING id`,
        [Number(req.params.id), req.user.id]
      );
      if (!rows.length) return res.status(404).json({ error: "Invoice not found or already honored." });
      res.json({ ok: true });
    } catch (err) {
      console.error("invoice cancel error", err);
      res.status(500).json({ error: "Could not cancel invoice." });
    }
  });

  // Delete a draft (only drafts can be deleted; keep an audit trail otherwise).
  app.delete("/api/invoices/:id", requireAuth, async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        "DELETE FROM lb_invoices WHERE id=$1 AND from_user_id=$2 AND status='draft'",
        [Number(req.params.id), req.user.id]
      );
      if (!rowCount) return res.status(400).json({ error: "Only draft invoices can be deleted." });
      res.json({ ok: true });
    } catch (err) {
      console.error("invoice delete error", err);
      res.status(500).json({ error: "Could not delete invoice." });
    }
  });

  // Clear the "honored" badge once the sender has looked at their invoices.
  app.post("/api/invoices/mark-seen", requireAuth, async (req, res) => {
    try {
      await pool.query(
        "UPDATE lb_invoices SET honored_seen=TRUE WHERE from_user_id=$1 AND status='honored' AND honored_seen=FALSE",
        [req.user.id]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error("invoice mark-seen error", err);
      res.status(500).json({ error: "Could not update invoices." });
    }
  });

  /* ------------------------- PUBLIC (no auth) ------------------------- */

  // View an invoice by its public token (the recipient's link). Marks it viewed.
  app.get("/api/public/invoices/:token", async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM lb_invoices WHERE public_token = $1",
        [String(req.params.token)]
      );
      if (!rows.length) return res.status(404).json({ error: "This invoice link is invalid or has expired." });
      const inv = rows[0];
      if (inv.status === "sent") {
        await pool.query("UPDATE lb_invoices SET status='viewed', viewed_at=NOW() WHERE id=$1 AND status='sent'", [inv.id]);
      }
      const sender = await displayNameForUser(inv.from_user_id);
      const isNgn = String(inv.currency).toLowerCase() === "ngn";
      let canPayOnline = false;
      // Naira invoices are paid via Paystack; everything else via Stripe.
      if (isNgn && paystackEnabled()) {
        const pa = await getPaystackAccountRow(inv.from_user_id);
        canPayOnline = !!(pa && pa.active);
      } else if (!isNgn && stripe) {
        const acc = await pool.query("SELECT payouts_enabled FROM lb_stripe_accounts WHERE user_id=$1", [inv.from_user_id]);
        canPayOnline = !!(acc.rows[0] && acc.rows[0].payouts_enabled);
      }
      const usePaystack = isNgn && paystackEnabled() && canPayOnline;
      res.json({
        invoice: {
          number: invoiceNumber(inv.id),
          fromName: sender.name,
          fromAvatar: sender.avatarUrl || "",
          toName: inv.to_name || "",
          toEmail: inv.to_email,
          currency: inv.currency,
          note: inv.note || "",
          taxMode: inv.tax_mode,
          taxRateBps: Number(inv.tax_rate_bps),
          taxLabel: inv.tax_label || "VAT",
          subtotalCents: Number(inv.subtotal_cents),
          taxCents: Number(inv.tax_cents),
          totalCents: Number(inv.total_cents),
          status: inv.status,
          dueDate: inv.due_date || null,
          createdAt: inv.created_at,
          items: await loadItems(inv.id)
        },
        canPayOnline,
        embedded: EMBEDDED && canPayOnline && !usePaystack,
        publishableKey: EMBEDDED && canPayOnline && !usePaystack ? PUBLISHABLE_KEY : "",
        // Paystack (Naira) on-page payment.
        paystack: usePaystack,
        paystackPublicKey: usePaystack ? paystackPublicKey() : "",
        settled: inv.status === "honored",
        cancelled: inv.status === "cancelled"
      });
    } catch (err) {
      console.error("public invoice view error", err);
      res.status(500).json({ error: "Could not load this invoice." });
    }
  });

  // Recipient pays the invoice online → Stripe Checkout to the sender's account.
  app.post("/api/public/invoices/:token/pay", async (req, res) => {
    if (!stripe) return res.status(503).json({ error: "Online payment isn't available for this invoice." });
    try {
      const { rows } = await pool.query("SELECT * FROM lb_invoices WHERE public_token=$1", [String(req.params.token)]);
      if (!rows.length) return res.status(404).json({ error: "This invoice link is invalid." });
      const inv = rows[0];
      if (inv.status === "honored") return res.status(400).json({ error: "This invoice has already been paid." });
      if (inv.status === "cancelled") return res.status(400).json({ error: "This invoice was cancelled." });

      const acc = await pool.query("SELECT stripe_account_id, payouts_enabled FROM lb_stripe_accounts WHERE user_id=$1", [inv.from_user_id]);
      const account = acc.rows[0];
      if (!account || !account.payouts_enabled) {
        return res.status(400).json({ error: "The sender hasn't set up online payments yet. You can pay them directly and upload proof instead." });
      }

      const feeCents = feeCentsFor(Number(inv.total_cents));
      const sender = await displayNameForUser(inv.from_user_id);
      const useEmbedded = !!(req.body && req.body.embedded) && EMBEDDED;
      const params = {
        mode: "payment",
        line_items: [{
          price_data: {
            currency: inv.currency,
            unit_amount: Number(inv.total_cents),
            product_data: {
              name: `Invoice ${invoiceNumber(inv.id)} from ${sender.name}`,
              description: inv.note ? String(inv.note).slice(0, 300) : "DabzAudio invoice"
            }
          },
          quantity: 1
        }],
        payment_intent_data: {
          transfer_data: { destination: account.stripe_account_id },
          application_fee_amount: feeCents || undefined,
          description: `DabzAudio invoice ${invoiceNumber(inv.id)}`,
          metadata: { invoiceId: String(inv.id) }
        },
        metadata: { invoiceId: String(inv.id) },
        customer_email: inv.to_email || undefined
      };
      if (useEmbedded) {
        params.ui_mode = "embedded";
        params.return_url = `${appBase()}/invoice.html?token=${inv.public_token}&paid=1`;
      } else {
        params.success_url = `${appBase()}/invoice.html?token=${inv.public_token}&paid=1`;
        params.cancel_url = `${appBase()}/invoice.html?token=${inv.public_token}`;
      }
      const session = await stripe.checkout.sessions.create(params);
      await pool.query("UPDATE lb_invoices SET stripe_checkout_session_id=$2, fee_cents=$3, updated_at=NOW() WHERE id=$1",
        [inv.id, session.id, feeCents]);
      if (useEmbedded) res.json({ clientSecret: session.client_secret, publishableKey: PUBLISHABLE_KEY });
      else res.json({ url: session.url });
    } catch (err) {
      console.error("invoice pay error", err);
      stripeError(res, err, "Could not start payment. Please try again.");
    }
  });

  // Recipient pays a Naira invoice online → Paystack (split to the sender's
  // subaccount, DabzAudio fee kept by the platform). Returns an access code for
  // the on-page Paystack inline popup (no redirect).
  app.post("/api/public/invoices/:token/paystack", async (req, res) => {
    if (!paystackEnabled()) return res.status(503).json({ error: "Online payment isn't available for this invoice." });
    try {
      const { rows } = await pool.query("SELECT * FROM lb_invoices WHERE public_token=$1", [String(req.params.token)]);
      if (!rows.length) return res.status(404).json({ error: "This invoice link is invalid." });
      const inv = rows[0];
      if (String(inv.currency).toLowerCase() !== "ngn") {
        return res.status(400).json({ error: "This invoice is not payable with Paystack." });
      }
      if (inv.status === "honored") return res.status(400).json({ error: "This invoice has already been paid." });
      if (inv.status === "cancelled") return res.status(400).json({ error: "This invoice was cancelled." });

      const account = await getPaystackAccountRow(inv.from_user_id);
      if (!account || !account.active) {
        return res.status(400).json({ error: "The sender hasn't set up Naira payments yet. You can pay them directly and upload proof instead." });
      }

      const feeKobo = feeCentsFor(Number(inv.total_cents));
      const reference = "lbinv_" + inv.id + "_" + crypto.randomBytes(6).toString("hex");
      const tx = await paystackInitTransaction({
        email: inv.to_email || "payer@dabzaudio.app",
        amountKobo: Number(inv.total_cents),
        subaccountCode: account.subaccount_code,
        transactionChargeKobo: feeKobo,
        reference,
        metadata: { invoiceId: String(inv.id) }
      });
      await pool.query(
        "UPDATE lb_invoices SET provider='paystack', paystack_reference=$2, fee_cents=$3, updated_at=NOW() WHERE id=$1",
        [inv.id, reference, feeKobo]
      );
      res.json({
        reference: tx.reference,
        accessCode: tx.access_code,
        authorizationUrl: tx.authorization_url,
        publicKey: paystackPublicKey(),
        email: inv.to_email || ""
      });
    } catch (err) {
      console.error("invoice paystack pay error", err);
      res.status(500).json({ error: err.message || "Could not start payment. Please try again." });
    }
  });

  // Confirm a Paystack invoice payment immediately after the inline popup
  // succeeds (the webhook is the source of truth, but this gives instant UX).
  app.post("/api/public/invoices/:token/paystack/verify", async (req, res) => {
    if (!paystackEnabled()) return res.status(503).json({ error: "Not available." });
    try {
      const reference = String((req.body && req.body.reference) || "");
      if (!reference) return res.status(400).json({ error: "Missing reference." });
      const { rows } = await pool.query(
        "SELECT * FROM lb_invoices WHERE public_token=$1 AND paystack_reference=$2",
        [String(req.params.token), reference]
      );
      if (!rows.length) return res.status(404).json({ error: "Invoice not found." });
      const inv = rows[0];
      if (inv.status === "honored") return res.json({ paid: true });
      const tx = await paystackVerify(reference);
      if (tx && tx.status === "success") {
        await honorInvoiceOnline({ invoiceId: inv.id, provider: "paystack", reference });
        return res.json({ paid: true });
      }
      res.json({ paid: false });
    } catch (err) {
      console.error("invoice paystack verify error", err);
      res.status(500).json({ error: "Could not verify payment." });
    }
  });

  // Recipient uploads proof of an offline payment → Awaiting confirmation.
  app.post("/api/public/invoices/:token/proof", async (req, res) => {
    try {
      const { imageBase64, note } = req.body || {};
      if (!cloudinary.config().cloud_name) {
        return res.status(503).json({ error: "Proof uploads aren't configured yet." });
      }
      if (!imageBase64 || typeof imageBase64 !== "string" ||
          !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(imageBase64)) {
        return res.status(400).json({ error: "Attach a screenshot or photo of your payment (PNG/JPG)." });
      }
      if (imageBase64.length > 8 * 1024 * 1024) {
        return res.status(400).json({ error: "Image too large (max ~5MB)." });
      }
      const { rows } = await pool.query("SELECT * FROM lb_invoices WHERE public_token=$1", [String(req.params.token)]);
      if (!rows.length) return res.status(404).json({ error: "This invoice link is invalid." });
      const inv = rows[0];
      if (inv.status === "honored") return res.status(400).json({ error: "This invoice is already settled." });
      if (inv.status === "cancelled") return res.status(400).json({ error: "This invoice was cancelled." });

      const result = await cloudinary.uploader.upload(imageBase64, {
        folder: "lyricbook/invoice-proofs",
        resource_type: "image",
        transformation: [{ quality: "auto", fetch_format: "auto" }]
      });
      await pool.query(
        `INSERT INTO lb_invoice_proofs (invoice_id, file_url, note, uploaded_by_email)
         VALUES ($1,$2,$3,$4)`,
        [inv.id, result.secure_url, String(note || "").slice(0, 500), inv.to_email]
      );
      await pool.query(
        "UPDATE lb_invoices SET status='awaiting_confirmation', updated_at=NOW() WHERE id=$1 AND status <> 'honored'",
        [inv.id]
      );
      try {
        const sender = await senderContact(inv.from_user_id);
        await sendInvoiceProofEmail(sender.email, {
          senderName: sender.name,
          number: invoiceNumber(inv.id),
          payer: inv.to_name || inv.to_email,
          amount: formatMoney(inv.total_cents, inv.currency),
          openUrl: `${appBase()}/app.html?invoices=1`
        });
      } catch (e) {
        console.error("invoice proof email error", e?.message);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("invoice proof error", err);
      res.status(500).json({ error: "Could not upload your proof. Please try again." });
    }
  });
}

// Send the invoice email to the recipient with a link to view/pay/honor it.
async function emailInvoice(req, inv, hasAccount) {
  try {
    const sender = await displayNameForUser(inv.from_user_id, req.user.email);
    const viewUrl = `${appBase()}/invoice.html?token=${inv.public_token}`;
    const r = await sendInvoiceEmail(inv.to_email, {
      senderName: sender.name,
      number: invoiceNumber(inv.id),
      amount: formatMoney(inv.total_cents, inv.currency),
      note: inv.note || "",
      dueDate: inv.due_date || null,
      viewUrl,
      hasAccount: !!hasAccount
    });
    return !!(r && r.sent);
  } catch (e) {
    console.error("emailInvoice error", e?.message);
    return false;
  }
}
