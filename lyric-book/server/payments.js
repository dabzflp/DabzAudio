/**
 * payments.js
 * "Gift Me" for the Lyric Book — integrated Stripe Connect.
 *
 * Model: an artist gifts a collaborator on a lyric. Recipients onboard to a
 * Stripe Connect *Express* account (Stripe handles KYC + bank payouts), so
 * DabzAudio never holds the money. The sender pays by card via Stripe Checkout;
 * the charge is routed to the recipient's connected account (a "destination
 * charge") with an optional DabzAudio platform fee.
 *
 * This module is fully additive: without STRIPE_SECRET_KEY every route responds
 * with a clear "not configured" message and the rest of the Lyric Book keeps
 * working exactly as before.
 *
 * Env vars:
 *  - STRIPE_SECRET_KEY        sk_test_... / sk_live_... (required to enable)
 *  - STRIPE_WEBHOOK_SECRET    whsec_...    (required to verify webhooks)
 *  - STRIPE_CONNECT_COUNTRY   2-letter country for new Express accounts (default US)
 *  - GIFT_CURRENCY            primary ISO currency for gifts (default usd)
 *  - GIFT_CURRENCIES          comma-separated ISO currencies a sender may pay in
 *                             (default "usd,gbp,eur,cad,aud"; GIFT_CURRENCY is always added)
 *  - PLATFORM_FEE_BPS         platform fee in basis points, e.g. 500 = 5% (default 0)
 *  - APP_BASE_URL             frontend base, used for Stripe redirect URLs
 */
import Stripe from "stripe";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { getLyricAccess, displayNameForUser } from "./access.js";
import { handleInvoiceEvent } from "./invoices.js";

const SECRET = process.env.STRIPE_SECRET_KEY || "";
export const stripe = SECRET ? new Stripe(SECRET) : null;

// Publishable key (pk_...) — safe to expose to the browser. Required for the
// embedded (on-page) Checkout + Connect onboarding experiences so users never
// leave DabzAudio for a Stripe-hosted page.
const PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "";
export function publishableKey() { return PUBLISHABLE_KEY; }
export function embeddedEnabled() { return !!(stripe && PUBLISHABLE_KEY); }

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const CONNECT_COUNTRY = (process.env.STRIPE_CONNECT_COUNTRY || "US").toUpperCase();
const CURRENCY = (process.env.GIFT_CURRENCY || "usd").toLowerCase();

// Currencies a sender may pay in on the Stripe rail. Stripe accepts the card in
// any of these (the "presentment" currency) and settles/converts to the artist's
// Stripe balance automatically — so senders aren't locked to a single currency.
// Override with GIFT_CURRENCIES (comma-separated ISO codes); the primary
// GIFT_CURRENCY is always included first. (Naira is a separate Paystack rail.)
const GIFT_CURRENCIES = (() => {
  const raw = String(process.env.GIFT_CURRENCIES || "").trim();
  const list = raw
    ? raw.split(",").map((c) => c.trim().toLowerCase()).filter(Boolean)
    : ["usd", "gbp", "eur", "cad", "aud"];
  return [...new Set([CURRENCY, ...list])];
})();

// Coerce a requested gift currency to one we actually support (else the primary).
function normalizeGiftCurrency(c) {
  const cur = String(c || CURRENCY).toLowerCase();
  return GIFT_CURRENCIES.includes(cur) ? cur : CURRENCY;
}
// Platform fee in basis points (100 = 1%). Defaults to 1000 (10%) — fair for a
// creator-tipping product and enough to cover Stripe's processing fees on typical
// gifts. Override with PLATFORM_FEE_BPS (set to 0 for a no-fee, artist-keeps-all model).
const FEE_BPS = Math.max(
  0,
  Math.min(10000, Number(process.env.PLATFORM_FEE_BPS ?? 1000))
);

// Sensible gift bounds (in major currency units). Minimum defaults to 5 so
// Stripe's fixed processing fee (~20p) doesn't make small gifts loss-making;
// override with MIN_GIFT.
const MIN_AMOUNT = Math.max(1, Number(process.env.MIN_GIFT ?? 5));
const MAX_AMOUNT = 1000;   // guard-rail against fat-finger / abuse

// Minimum wallet withdrawal (major units). Keeps Stripe's fixed payout fee from
// eating tiny cash-outs — artists let the balance build to at least this much.
const MIN_WITHDRAWAL = Math.max(0, Number(process.env.MIN_WITHDRAWAL ?? 5));
const MIN_WITHDRAWAL_CENTS = Math.round(MIN_WITHDRAWAL * 100);

export function stripeEnabled() {
  return !!stripe;
}

function appBase() {
  return (process.env.APP_BASE_URL || "https://dabzaudio.netlify.app/lyric-book").replace(/\/$/, "");
}

function notConfigured(res) {
  return res.status(503).json({ error: "Gifting is not set up yet. Please try again later." });
}

// Turn a Stripe error into an actionable client message instead of a blank 500.
// Some Stripe failures (e.g. Connect not enabled in live mode) are configuration
// problems the caller can't fix, but the message tells the operator exactly what
// to do — so we surface it rather than hiding it behind a generic error.
function stripeError(res, err, fallback) {
  const msg = (err && err.raw && err.raw.message) || (err && err.message) || "";
  if (/signed up for Connect/i.test(msg)) {
    return res.status(503).json({
      error: "Payouts aren't enabled yet. The DabzAudio team needs to activate Stripe Connect in live mode."
    });
  }
  if (err && err.type === "StripeInvalidRequestError" && msg) {
    return res.status(400).json({ error: msg });
  }
  return res.status(500).json({ error: fallback });
}

// Round the platform fee from basis points of the gross amount.
function platformFeeCents(amountCents) {
  if (!FEE_BPS) return 0;
  return Math.floor((amountCents * FEE_BPS) / 10000);
}

// Upsert a user's connect status from a Stripe Account object.
async function saveAccountStatus(userId, acct) {
  await pool.query(
    `INSERT INTO lb_stripe_accounts
       (user_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, country, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       stripe_account_id = EXCLUDED.stripe_account_id,
       charges_enabled   = EXCLUDED.charges_enabled,
       payouts_enabled   = EXCLUDED.payouts_enabled,
       details_submitted = EXCLUDED.details_submitted,
       country           = EXCLUDED.country,
       updated_at        = NOW()`,
    [
      userId,
      acct.id,
      !!acct.charges_enabled,
      !!acct.payouts_enabled,
      !!acct.details_submitted,
      acct.country || null
    ]
  );
}

async function getAccountRow(userId) {
  const { rows } = await pool.query(
    "SELECT * FROM lb_stripe_accounts WHERE user_id = $1",
    [userId]
  );
  return rows[0] || null;
}

// Get the user's Stripe Express account id, creating the account if needed.
// Shared by hosted (accountLinks) and embedded (accountSessions) onboarding.
async function ensureAccountId(user) {
  const row = await getAccountRow(user.id);
  if (row && row.stripe_account_id) return row.stripe_account_id;
  const acct = await stripe.accounts.create({
    type: "express",
    country: CONNECT_COUNTRY,
    email: user.email,
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true }
    },
    business_type: "individual",
    // Manual payouts: gifts accumulate in the artist's Stripe balance (their
    // in-app "wallet") until they choose to withdraw to their bank.
    settings: { payouts: { schedule: { interval: "manual" } } },
    metadata: { lb_user_id: String(user.id) }
  });
  await saveAccountStatus(user.id, acct);
  return acct.id;
}

/**
 * Mount the raw-body Stripe webhook. Must be called BEFORE express.json() in
 * server.js, because signature verification needs the unparsed request body.
 */
export function stripeWebhookHandler(req, res) {
  if (!stripe || !WEBHOOK_SECRET) return res.status(200).json({ received: true });
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("stripe webhook signature error", err?.message);
    return res.status(400).send(`Webhook Error: ${err?.message}`);
  }

  handleEvent(event)
    .then(() => res.json({ received: true }))
    .catch((err) => {
      console.error("stripe webhook handler error", err);
      // Return 200 so Stripe doesn't retry forever on a bug we log ourselves.
      res.json({ received: true });
    });
}

async function handleEvent(event) {
  // Invoices share this webhook; a session with metadata.invoiceId is an invoice
  // payment (metadata.giftId will be absent, so the gift branch below skips it).
  await handleInvoiceEvent(event).catch((e) => console.error("invoice event error", e?.message));

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const giftId = session.metadata && session.metadata.giftId;
    if (giftId) {
      await pool.query(
        `UPDATE lb_gifts
            SET status = 'paid',
                stripe_payment_intent_id = $2,
                paid_at = NOW()
          WHERE id = $1 AND status <> 'paid'`,
        [giftId, session.payment_intent || null]
      );
    }
  } else if (
    event.type === "checkout.session.expired" ||
    event.type === "checkout.session.async_payment_failed"
  ) {
    // Sender abandoned or the payment failed — mark the gift Failed (not stuck
    // on Pending) so both parties see an accurate status.
    const session = event.data.object;
    const giftId = session.metadata && session.metadata.giftId;
    if (giftId) {
      await pool.query(
        "UPDATE lb_gifts SET status = 'failed' WHERE id = $1 AND status = 'pending'",
        [giftId]
      );
    }
  } else if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object;
    const giftId = pi.metadata && pi.metadata.giftId;
    if (giftId) {
      await pool.query(
        "UPDATE lb_gifts SET status = 'failed' WHERE id = $1 AND status = 'pending'",
        [giftId]
      );
    }
  } else if (event.type === "account.updated") {
    const acct = event.data.object;
    await pool.query(
      `UPDATE lb_stripe_accounts
          SET charges_enabled = $2, payouts_enabled = $3, details_submitted = $4,
              country = COALESCE($5, country), updated_at = NOW()
        WHERE stripe_account_id = $1`,
      [acct.id, !!acct.charges_enabled, !!acct.payouts_enabled, !!acct.details_submitted, acct.country || null]
    );
  }
}

/**
 * Register all authenticated Gift Me routes on the Express app.
 */
export function registerPaymentRoutes(app) {
  // Public config for the frontend (safe values only).
  app.get("/api/gifts/config", (req, res) => {
    res.json({
      enabled: stripeEnabled(),
      currency: CURRENCY,
      currencies: GIFT_CURRENCIES,
      minAmount: MIN_AMOUNT,
      maxAmount: MAX_AMOUNT,
      minWithdrawalCents: MIN_WITHDRAWAL_CENTS,
      feeBps: FEE_BPS,
      // When both keys are present the frontend uses on-page (embedded) Stripe
      // flows instead of redirecting to a Stripe-hosted page.
      embedded: embeddedEnabled(),
      publishableKey: PUBLISHABLE_KEY
    });
  });

  // Current user's payout (Connect) status. Live-syncs from Stripe if an
  // account exists so status is fresh right after onboarding.
  app.get("/api/payouts/account", requireAuth, async (req, res) => {
    if (!stripe) return res.json({ enabled: false, connected: false });
    try {
      let row = await getAccountRow(req.user.id);
      if (row) {
        try {
          const acct = await stripe.accounts.retrieve(row.stripe_account_id);
          await saveAccountStatus(req.user.id, acct);
          row = await getAccountRow(req.user.id);
        } catch (e) {
          console.error("account retrieve failed", e?.message);
        }
      }
      res.json({
        enabled: true,
        connected: !!row,
        chargesEnabled: !!(row && row.charges_enabled),
        payoutsEnabled: !!(row && row.payouts_enabled),
        detailsSubmitted: !!(row && row.details_submitted)
      });
    } catch (err) {
      console.error("payouts/account error", err);
      res.status(500).json({ error: "Could not load payout status." });
    }
  });

  // Start (or resume) Stripe Express onboarding. Returns a hosted onboarding URL.
  app.post("/api/payouts/connect", requireAuth, async (req, res) => {
    if (!stripe) return notConfigured(res);
    try {
      const accountId = await ensureAccountId(req.user);
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${appBase()}/app.html?payouts=refresh`,
        return_url: `${appBase()}/app.html?payouts=done`,
        type: "account_onboarding"
      });
      res.json({ url: link.url });
    } catch (err) {
      console.error("payouts/connect error", err);
      stripeError(res, err, "Could not start payout setup.");
    }
  });

  // Embedded onboarding: return an Account Session client secret so the artist
  // completes Stripe onboarding *inside DabzAudio* (no redirect to Stripe).
  app.post("/api/payouts/account-session", requireAuth, async (req, res) => {
    if (!embeddedEnabled()) return res.status(503).json({ error: "Embedded onboarding isn't configured." });
    try {
      const accountId = await ensureAccountId(req.user);
      const session = await stripe.accountSessions.create({
        account: accountId,
        components: {
          account_onboarding: { enabled: true },
          balances: { enabled: true },
          payouts: { enabled: true }
        }
      });
      res.json({ clientSecret: session.client_secret, publishableKey: PUBLISHABLE_KEY });
    } catch (err) {
      console.error("payouts/account-session error", err);
      stripeError(res, err, "Could not start payout setup.");
    }
  });

  // Express dashboard login link (view balance / cash out).
  app.post("/api/payouts/login-link", requireAuth, async (req, res) => {
    if (!stripe) return notConfigured(res);
    try {
      const row = await getAccountRow(req.user.id);
      if (!row) return res.status(400).json({ error: "Set up payouts first." });
      const link = await stripe.accounts.createLoginLink(row.stripe_account_id);
      res.json({ url: link.url });
    } catch (err) {
      console.error("payouts/login-link error", err);
      stripeError(res, err, "Could not open payout dashboard.");
    }
  });

  // Search for anyone on the platform to gift, by their unique @username.
  app.get("/api/gifts/search-users", requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim().replace(/^@/, "");
      if (q.length < 1) return res.json({ users: [] });
      const clean = q.replace(/[%_]/g, "");
      const prefix = clean + "%";
      const anywhere = "%" + clean + "%";
      const { rows } = await pool.query(
        `SELECT u.id AS user_id,
                COALESCE(NULLIF(p.artist_name,''), NULLIF(p.display_name,'')) AS name,
                p.username,
                p.avatar_url,
                COALESCE(sa.payouts_enabled, FALSE) AS payouts_enabled,
                COALESCE(pa.active, FALSE) AS ngn_active
           FROM lb_users u
           LEFT JOIN lb_profiles p ON p.user_id = u.id
           LEFT JOIN lb_stripe_accounts sa ON sa.user_id = u.id
           LEFT JOIN lb_paystack_accounts pa ON pa.user_id = u.id
          WHERE u.id <> $1
            AND p.username ILIKE $3
          ORDER BY (p.username ILIKE $2) DESC, payouts_enabled DESC, p.username ASC
          LIMIT 8`,
        [req.user.id, prefix, anywhere]
      );
      res.json({ users: rows.map(mapUser) });
    } catch (err) {
      console.error("gifts/search-users error", err);
      res.status(500).json({ error: "Could not search artists." });
    }
  });

  // Quick-pick suggestions: people I've written with (any lyric) or gifted before.
  app.get("/api/gifts/suggestions", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.id AS user_id,
                COALESCE(NULLIF(p.artist_name,''), NULLIF(p.display_name,'')) AS name,
                p.username,
                p.avatar_url,
                COALESCE(sa.payouts_enabled, FALSE) AS payouts_enabled,
                COALESCE(pa.active, FALSE) AS ngn_active
           FROM lb_users u
           LEFT JOIN lb_profiles p ON p.user_id = u.id
           LEFT JOIN lb_stripe_accounts sa ON sa.user_id = u.id
           LEFT JOIN lb_paystack_accounts pa ON pa.user_id = u.id
          WHERE u.id <> $1 AND u.id IN (
            SELECT c.user_id FROM lb_lyric_collaborators c
              JOIN lb_lyrics l ON l.id = c.lyric_id
             WHERE l.user_id = $1 AND c.status = 'accepted' AND c.user_id IS NOT NULL
            UNION
            SELECT l.user_id FROM lb_lyrics l
              JOIN lb_lyric_collaborators c ON c.lyric_id = l.id
             WHERE c.user_id = $1 AND c.status = 'accepted'
            UNION
            SELECT g.to_user_id FROM lb_gifts g WHERE g.from_user_id = $1
          )
          ORDER BY payouts_enabled DESC, name ASC
          LIMIT 12`,
        [req.user.id]
      );
      res.json({ users: rows.map(mapUser) });
    } catch (err) {
      console.error("gifts/suggestions error", err);
      res.status(500).json({ error: "Could not load suggestions." });
    }
  });

  // Wallet balance — the artist's own Stripe balance (gifts accumulate here).
  app.get("/api/wallet/balance", requireAuth, async (req, res) => {
    if (!stripe) return res.json({ enabled: false });
    try {
      const row = await getAccountRow(req.user.id);
      if (!row || !row.payouts_enabled) {
        return res.json({ enabled: true, payoutsEnabled: false, currency: CURRENCY, availableCents: 0, pendingCents: 0 });
      }
      const bal = await stripe.balance.retrieve({ stripeAccount: row.stripe_account_id });
      // Gifts can arrive in several currencies now, so report each balance the
      // account actually holds (not just the primary one) — otherwise non-primary
      // earnings would be invisible.
      const codes = [...new Set([
        CURRENCY,
        ...(bal.available || []).map((b) => b.currency),
        ...(bal.pending || []).map((b) => b.currency)
      ])];
      const balances = codes
        .map((cur) => ({
          currency: cur,
          availableCents: sumBalance(bal.available, cur),
          pendingCents: sumBalance(bal.pending, cur)
        }))
        .filter((b) => b.currency === CURRENCY || b.availableCents > 0 || b.pendingCents > 0);
      res.json({
        enabled: true,
        payoutsEnabled: true,
        currency: CURRENCY,
        availableCents: sumBalance(bal.available, CURRENCY),
        pendingCents: sumBalance(bal.pending, CURRENCY),
        balances
      });
    } catch (err) {
      console.error("wallet/balance error", err);
      res.status(500).json({ error: "Could not load your wallet." });
    }
  });

  // Withdraw the available wallet balance to the artist's bank (on-demand payout).
  app.post("/api/wallet/withdraw", requireAuth, async (req, res) => {
    if (!stripe) return notConfigured(res);
    try {
      const row = await getAccountRow(req.user.id);
      if (!row || !row.payouts_enabled) {
        return res.status(400).json({ error: "Set up payouts before withdrawing." });
      }
      const bal = await stripe.balance.retrieve({ stripeAccount: row.stripe_account_id });
      const totalAvailable = (bal.available || []).reduce((s, b) => s + (b.amount || 0), 0);
      if (totalAvailable <= 0) {
        return res.status(400).json({ error: "No funds available yet — gifts take a few days to settle, then you can cash out." });
      }
      // Cash out every currency the account holds (a gift may have been paid in
      // USD/EUR/etc.). Each currency pays out separately; per-currency failures
      // (e.g. no matching bank) are skipped so one bad currency can't block the rest.
      const payouts = [];
      let belowMin = false;
      for (const b of bal.available || []) {
        const amt = b.amount || 0;
        if (amt <= 0) continue;
        if (amt < MIN_WITHDRAWAL_CENTS) { belowMin = true; continue; }
        try {
          const payout = await stripe.payouts.create(
            { amount: amt, currency: b.currency, description: "DabzAudio wallet withdrawal" },
            { stripeAccount: row.stripe_account_id }
          );
          payouts.push({ currency: b.currency, amountCents: amt, payoutId: payout.id, arrivalDate: payout.arrival_date });
        } catch (e) {
          console.error("wallet/withdraw payout error", b.currency, e.message);
        }
      }
      if (!payouts.length) {
        if (belowMin) {
          return res.status(400).json({
            error: `You need at least ${formatMoney(MIN_WITHDRAWAL_CENTS)} available to withdraw (this keeps bank fees from eating small cash-outs).`
          });
        }
        return res.status(400).json({ error: "Couldn't withdraw right now — your funds may still be settling." });
      }
      const first = payouts[0];
      res.json({
        ok: true,
        payouts,
        amountCents: first.amountCents,
        currency: first.currency,
        payoutId: first.payoutId,
        arrivalDate: first.arrivalDate
      });
    } catch (err) {
      console.error("wallet/withdraw error", err);
      res.status(500).json({ error: err.message || "Could not withdraw right now." });
    }
  });

  // Who can I gift for this lyric? Owner + accepted collaborators (minus me).
  app.get("/api/gifts/recipients", requireAuth, async (req, res) => {
    try {
      const lyricId = Number(req.query.lyricId);
      if (!lyricId) return res.status(400).json({ error: "Missing lyricId." });
      const access = await getLyricAccess(lyricId, req.user.id);
      if (!access) return res.status(403).json({ error: "No access to this lyric." });

      const { rows } = await pool.query(
        `SELECT u.id AS user_id,
                COALESCE(NULLIF(p.artist_name,''), NULLIF(p.display_name,''), u.email) AS name,
                p.username,
                p.avatar_url,
                COALESCE(sa.payouts_enabled, FALSE) AS payouts_enabled,
                COALESCE(pa.active, FALSE) AS ngn_active
           FROM lb_lyrics l
           JOIN lb_users u
             ON u.id = l.user_id
             OR u.id IN (
               SELECT c.user_id FROM lb_lyric_collaborators c
                WHERE c.lyric_id = l.id AND c.status = 'accepted' AND c.user_id IS NOT NULL
             )
           LEFT JOIN lb_profiles p ON p.user_id = u.id
           LEFT JOIN lb_stripe_accounts sa ON sa.user_id = u.id
           LEFT JOIN lb_paystack_accounts pa ON pa.user_id = u.id
          WHERE l.id = $1 AND u.id <> $2
          ORDER BY name ASC`,
        [lyricId, req.user.id]
      );
      res.json({ recipients: rows.map(mapUser) });
    } catch (err) {
      console.error("gifts/recipients error", err);
      res.status(500).json({ error: "Could not load collaborators." });
    }
  });

  // Create a gift → returns a Stripe Checkout URL for the sender to pay.
  app.post("/api/gifts", requireAuth, async (req, res) => {
    if (!stripe) return notConfigured(res);
    try {
      const toUserId = Number(req.body.toUserId);
      const lyricId = req.body.lyricId ? Number(req.body.lyricId) : null;
      const amount = Number(req.body.amount);
      const message = String(req.body.message || "").slice(0, 280);
      const currency = normalizeGiftCurrency(req.body.currency);

      if (!toUserId || String(toUserId) === String(req.user.id)) {
        return res.status(400).json({ error: "Pick someone else to gift." });
      }
      if (!(amount >= MIN_AMOUNT && amount <= MAX_AMOUNT)) {
        return res.status(400).json({ error: `Enter an amount between ${MIN_AMOUNT} and ${MAX_AMOUNT}.` });
      }

      // If tied to a lyric, both parties must have access to it.
      if (lyricId) {
        const mine = await getLyricAccess(lyricId, req.user.id);
        const theirs = await getLyricAccess(lyricId, toUserId);
        if (!mine || !theirs) {
          return res.status(403).json({ error: "You can only gift a collaborator on this lyric." });
        }
      }

      const recipient = await getAccountRow(toUserId);
      if (!recipient || !recipient.payouts_enabled) {
        return res.status(400).json({ error: "This artist hasn't set up payouts yet, so they can't receive gifts." });
      }

      const amountCents = Math.round(amount * 100);
      const feeCents = platformFeeCents(amountCents);
      const to = await displayNameForUser(toUserId);
      let lyricTitle = "";
      if (lyricId) {
        const { rows } = await pool.query("SELECT title FROM lb_lyrics WHERE id = $1", [lyricId]);
        lyricTitle = (rows[0] && rows[0].title) || "";
      }

      // Record the pending gift first so we have an id for the session metadata.
      const ins = await pool.query(
        `INSERT INTO lb_gifts (from_user_id, to_user_id, lyric_id, amount_cents, fee_cents, currency, message, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING id`,
        [req.user.id, toUserId, lyricId, amountCents, feeCents, currency, message]
      );
      const giftId = ins.rows[0].id;

      // Embedded (on-page) Checkout when the client asks for it and the
      // publishable key is configured; otherwise fall back to hosted redirect.
      const useEmbedded = !!req.body.embedded && embeddedEnabled();
      try {
        const params = {
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency,
                unit_amount: amountCents,
                product_data: {
                  name: `Gift to ${to.name}`,
                  description: lyricTitle ? `For the lyric "${lyricTitle}"` : "DabzAudio Lyric Book gift"
                }
              },
              quantity: 1
            }
          ],
          payment_intent_data: {
            transfer_data: { destination: recipient.stripe_account_id },
            application_fee_amount: feeCents || undefined,
            description: `DabzAudio gift to ${to.name}`,
            metadata: { giftId: String(giftId) }
          },
          metadata: {
            giftId: String(giftId),
            fromUserId: String(req.user.id),
            toUserId: String(toUserId),
            lyricId: lyricId ? String(lyricId) : ""
          }
        };
        if (useEmbedded) {
          params.ui_mode = "embedded";
          params.return_url = `${appBase()}/app.html?gift=return&session_id={CHECKOUT_SESSION_ID}`;
        } else {
          params.success_url = `${appBase()}/app.html?gift=success`;
          params.cancel_url = `${appBase()}/app.html?gift=cancel&giftId=${giftId}`;
        }
        const session = await stripe.checkout.sessions.create(params);
        await pool.query(
          "UPDATE lb_gifts SET stripe_checkout_session_id = $2 WHERE id = $1",
          [giftId, session.id]
        );
        if (useEmbedded) res.json({ clientSecret: session.client_secret, publishableKey: PUBLISHABLE_KEY });
        else res.json({ url: session.url });
      } catch (err) {
        await pool.query("DELETE FROM lb_gifts WHERE id = $1 AND status = 'pending'", [giftId]);
        throw err;
      }
    } catch (err) {
      console.error("gifts create error", err);
      stripeError(res, err, "Could not start the gift. Please try again.");
    }
  });

  // Sender bailed out of Checkout — mark their own still-pending gift Failed.
  app.post("/api/gifts/:id/cancel", requireAuth, async (req, res) => {
    try {
      await pool.query(
        `UPDATE lb_gifts SET status = 'failed'
          WHERE id = $1 AND from_user_id = $2 AND status = 'pending'`,
        [Number(req.params.id), req.user.id]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error("gifts cancel error", err);
      res.status(500).json({ error: "Could not update the gift." });
    }
  });

  // Gift history for the current user (received + sent) with totals.
  app.get("/api/gifts/history", requireAuth, async (req, res) => {
    try {
      // Self-heal: any gift left Pending past the Checkout window (24h) never
      // completed, so flip it to Failed rather than leaving it hanging.
      await pool.query(
        `UPDATE lb_gifts SET status = 'failed'
          WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours'`
      );
      const received = await pool.query(
        `SELECT g.id, g.amount_cents, g.fee_cents, g.currency, g.message, g.status, g.created_at,
                COALESCE(NULLIF(p.artist_name,''), NULLIF(p.display_name,''), u.email, 'A fan') AS from_name,
                l.title AS lyric_title
           FROM lb_gifts g
           LEFT JOIN lb_users u ON u.id = g.from_user_id
           LEFT JOIN lb_profiles p ON p.user_id = g.from_user_id
           LEFT JOIN lb_lyrics l ON l.id = g.lyric_id
          WHERE g.to_user_id = $1
          ORDER BY g.created_at DESC
          LIMIT 100`,
        [req.user.id]
      );
      const sent = await pool.query(
        `SELECT g.id, g.amount_cents, g.currency, g.message, g.status, g.created_at,
                COALESCE(NULLIF(p.artist_name,''), NULLIF(p.display_name,''), u.email) AS to_name,
                l.title AS lyric_title
           FROM lb_gifts g
           LEFT JOIN lb_users u ON u.id = g.to_user_id
           LEFT JOIN lb_profiles p ON p.user_id = g.to_user_id
           LEFT JOIN lb_lyrics l ON l.id = g.lyric_id
          WHERE g.from_user_id = $1
          ORDER BY g.created_at DESC
          LIMIT 100`,
        [req.user.id]
      );
      const totalRow = await pool.query(
        `SELECT COALESCE(SUM(amount_cents - fee_cents),0) AS net, currency
           FROM lb_gifts WHERE to_user_id = $1 AND status = 'paid'
          GROUP BY currency ORDER BY net DESC LIMIT 1`,
        [req.user.id]
      );
      res.json({
        currency: CURRENCY,
        totalReceivedNetCents: Number((totalRow.rows[0] && totalRow.rows[0].net) || 0),
        received: received.rows.map(mapGift.bind(null, "from")),
        sent: sent.rows.map(mapGift.bind(null, "to"))
      });
    } catch (err) {
      console.error("gifts/history error", err);
      res.status(500).json({ error: "Could not load gift history." });
    }
  });
}

function mapUser(r) {
  return {
    userId: Number(r.user_id),
    name: r.name || ("Artist #" + r.user_id),
    username: r.username || "",
    avatarUrl: r.avatar_url || "",
    canReceive: !!r.payouts_enabled,          // Stripe (GBP/USD/EUR)
    canReceiveNgn: !!r.ngn_active             // Paystack (NGN)
  };
}

// Format an amount in cents as a localized currency string (e.g. £5.00).
function formatMoney(cents) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: CURRENCY.toUpperCase()
    }).format((cents || 0) / 100);
  } catch {
    return CURRENCY.toUpperCase() + " " + ((cents || 0) / 100).toFixed(2);
  }
}

// Sum a Stripe balance array (available/pending) for one currency, in cents.
function sumBalance(arr, currency) {
  return (arr || [])
    .filter((b) => b.currency === currency)
    .reduce((s, b) => s + (b.amount || 0), 0);
}

function mapGift(dir, r) {
  return {
    id: Number(r.id),
    amountCents: Number(r.amount_cents),
    feeCents: r.fee_cents != null ? Number(r.fee_cents) : 0,
    currency: r.currency,
    message: r.message || "",
    status: r.status,
    createdAt: r.created_at,
    lyricTitle: r.lyric_title || "",
    name: dir === "from" ? r.from_name : r.to_name
  };
}
