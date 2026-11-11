import crypto from "crypto";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { rateLimit } from "./rate-limit.js";
import { stripe, giftCurrencies } from "./payments.js";
import { paystackEnabled, paystackInitPlanTransaction, paystackDisableSubscription, paystackVerify } from "./paystack.js";
import { paymentProviderForCountry } from "./country-routing.js";
import { getTierPrices, TIERS } from "./pricing.js";

const TIER_LABEL = { standard: "DabzAudio Lyric Book", pro: "DabzAudio Lyric Book Pro" };

function stripePrice(tier, currency, plan, prices) {
  if (currency === "ngn") return null;
  return prices[tier]?.[currency]?.[plan] ?? null;
}

function paystackPlanCode(tier, plan) {
  const suffix = plan === "annual" ? "ANNUAL" : "MONTHLY";
  return tier === "pro"
    ? process.env[`PAYSTACK_LYRIC_PRO_${suffix}_PLAN_CODE`]
    : process.env[`PAYSTACK_LYRIC_${suffix}_PLAN_CODE`];
}

function majorUnits(prices) {
  return Object.fromEntries(Object.entries(prices).map(([cur, p]) => [cur, { monthly: p.monthly / 100, annual: p.annual / 100 }]));
}

// Pro includes active subscriptions and the explicit unlimited-access grant.
export function proActive(row) {
  return row?.unlimited_access === true || (
    row?.tier === "pro" && ["active", "past_due"].includes(row.status) &&
    (!row.current_period_end || new Date(row.current_period_end).getTime() > Date.now())
  );
}

export async function isProUser(userId) {
  const { rows } = await pool.query(
    `SELECT u.unlimited_access, s.tier, s.status, s.current_period_end
       FROM lb_users u LEFT JOIN lb_subscriptions s ON s.user_id = u.id WHERE u.id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return false;
  return proActive(row);
}

function appBase() {
  const configured = (process.env.APP_BASE_URL || "https://dabzaudio.com").replace(/\/$/, "");
  return /\/lyric-book$/i.test(configured) ? configured : `${configured}/lyric-book`;
}

function trialActive(row) {
  return row?.status === "trialing" && row.trial_ends_at && new Date(row.trial_ends_at).getTime() > Date.now();
}

function hasAccess(row) {
  if (row?.unlimited_access || row?.billing_exempt) return true;
  if (trialActive(row)) return true;
  return ["active", "past_due"].includes(row?.status) &&
    (!row.current_period_end || new Date(row.current_period_end).getTime() > Date.now());
}

async function billingRow(userId) {
  const { rows } = await pool.query(
    `SELECT u.email, u.country_code, u.billing_exempt, u.unlimited_access, s.status, s.plan, s.tier, s.currency, s.provider,
            s.trial_started_at, s.trial_ends_at, s.current_period_end,
            s.cancel_at_period_end
       FROM lb_users u
       LEFT JOIN lb_subscriptions s ON s.user_id = u.id
      WHERE u.id = $1`,
    [userId]
  );
  return rows[0] || null;
}

export function registerSubscriptionRoutes(app) {
  app.get("/api/subscription", requireAuth, async (req, res) => {
    try {
      const row = await billingRow(req.user.id);
      if (!row) return res.status(404).json({ error: "Account not found." });
      const tierPrices = await getTierPrices();
      const stripeEnabled = !!stripe;
      const stripeCurrencies = giftCurrencies().filter((currency) => tierPrices.prices.standard[currency] && currency !== "ngn");
      const paystackReady = (tier) => !!(paystackPlanCode(tier, "monthly") && paystackPlanCode(tier, "annual"));
      const paymentProvider = paymentProviderForCountry(row.country_code);
      res.json({
        billingExempt: !!row.billing_exempt,
        unlimitedAccess: !!row.unlimited_access,
        hasAccess: hasAccess(row),
        countryCode: row.country_code,
        paymentProvider,
        status: row.unlimited_access ? "unlimited" : row.billing_exempt ? "grandfathered" : row.status || "trialing",
        plan: row.plan || null,
        tier: row.tier || "standard",
        proActive: await isProUser(req.user.id),
        currency: row.currency || null,
        provider: row.provider || null,
        trialStartedAt: row.trial_started_at || null,
        trialEndsAt: row.trial_ends_at || null,
        currentPeriodEnd: row.current_period_end || null,
        cancelAtPeriodEnd: !!row.cancel_at_period_end,
        prices: majorUnits(tierPrices.prices.standard),
        proPrices: majorUnits(tierPrices.prices.pro),
        fxAvailable: tierPrices.fxAvailable,
        fxRateDate: tierPrices.fxRateDate,
        currencies: {
          stripe: paymentProvider === "stripe" ? stripeCurrencies : [],
          paystack: paymentProvider === "paystack" ? ["ngn"] : []
        },
        providers: {
          stripe: paymentProvider === "stripe" && stripeEnabled && stripeCurrencies.length > 0,
          paystack: paymentProvider === "paystack" && paystackEnabled() && paystackReady("standard"),
          paystackPro: paymentProvider === "paystack" && paystackEnabled() && paystackReady("pro")
        }
      });
    } catch (err) {
      console.error("Subscription status error:", err);
      res.status(500).json({ error: "Could not load subscription status." });
    }
  });

  app.post("/api/subscription/checkout", requireAuth, rateLimit({ windowMs: 15 * 60 * 1000, max: 8 }), async (req, res) => {
    const plan = req.body?.plan;
    const tier = req.body?.tier === undefined ? "standard" : String(req.body.tier);
    const currency = String(req.body?.currency || "").toLowerCase();
    if (!(["monthly", "annual"].includes(plan))) return res.status(400).json({ error: "Choose a monthly or annual plan." });
    if (!TIERS.includes(tier)) return res.status(400).json({ error: "Choose a valid plan." });
    try {
      const row = await billingRow(req.user.id);
      if (!row) return res.status(404).json({ error: "Account not found." });
      if (row.unlimited_access) {
        return res.status(409).json({ error: "This account already has unlimited feature access." });
      }
      if (row.billing_exempt && tier !== "pro") return res.status(409).json({ error: "This account already has grandfathered access." });
      const upgrading = tier === "pro" && hasAccess(row) && row.status !== "trialing" && row.tier !== "pro";
      if (tier === "pro" && proActive(row)) return res.status(409).json({ error: "You already have Pro." });
      if (!upgrading && hasAccess(row) && row.status !== "trialing") return res.status(409).json({ error: "Your subscription already has access." });

      const paymentProvider = paymentProviderForCountry(row.country_code);
      if (paymentProvider === "paystack") {
        if (currency !== "ngn") return res.status(400).json({ error: "Nigerian accounts use Paystack and NGN pricing." });
        if (!paystackEnabled()) return res.status(503).json({ error: "Naira subscriptions are not configured yet." });
        const planCode = paystackPlanCode(tier, plan);
        if (!planCode) return res.status(503).json({ error: "Paystack subscription plan codes are not configured." });
        const reference = `lbsub_${req.user.id}_${crypto.randomBytes(12).toString("hex")}`;
        const transaction = await paystackInitPlanTransaction({
          email: row.email,
          planCode,
          reference,
          callbackUrl: `${appBase()}/subscription.html?checkout=paystack&reference=${encodeURIComponent(reference)}`,
          metadata: { subscriptionUserId: String(req.user.id), subscriptionPlan: plan, subscriptionTier: tier, subscriptionCurrency: "ngn" }
        });
        await pool.query(
          `UPDATE lb_subscriptions
              SET status = CASE WHEN status = 'active' OR (status = 'trialing' AND trial_ends_at > NOW()) THEN status ELSE 'pending' END,
                  paystack_reference = $2, updated_at = NOW()
            WHERE user_id = $1`,
          [req.user.id, reference]
        );
        return res.json({ provider: "paystack", url: transaction.authorization_url, reference });
      }

      if (currency === "ngn") return res.status(400).json({ error: "NGN subscriptions are available only to Nigerian accounts." });
      const tierPrices = await getTierPrices();
      if (currency !== "gbp" && !tierPrices.fxAvailable) {
        return res.status(503).json({ error: "Currency conversion rates are temporarily unavailable. Choose GBP or try again later." });
      }
      if (stripePrice(tier, currency, plan, tierPrices.prices) === null || !giftCurrencies().includes(currency)) {
        return res.status(400).json({ error: "Choose a currency supported for Lyric Book subscriptions." });
      }
      if (!stripe) return res.status(503).json({ error: "Card subscriptions are not configured yet." });
      const amount = stripePrice(tier, currency, plan, tierPrices.prices);
      const metadata = { billingUserId: String(req.user.id), plan, tier, currency };
      // Reuse the Stripe customer on upgrades so unused time credited from the
      // old subscription is applied to the first Pro invoice.
      const { rows: existing } = await pool.query("SELECT stripe_customer_id FROM lb_subscriptions WHERE user_id = $1", [req.user.id]);
      const customerRef = upgrading && existing[0]?.stripe_customer_id
        ? { customer: existing[0].stripe_customer_id }
        : { customer_email: row.email };
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_collection: "always",
        ...customerRef,
        client_reference_id: String(req.user.id),
        line_items: [{
          quantity: 1,
          price_data: {
            currency,
            unit_amount: amount,
            recurring: { interval: plan === "annual" ? "year" : "month" },
            product_data: { name: TIER_LABEL[tier] }
          }
        }],
        metadata,
        subscription_data: { metadata },
        success_url: `${appBase()}/subscription.html?checkout=success`,
        cancel_url: `${appBase()}/subscription.html?checkout=cancelled`
      });
      await pool.query(
        `UPDATE lb_subscriptions
            SET status = CASE WHEN status = 'active' OR (status = 'trialing' AND trial_ends_at > NOW()) THEN status ELSE 'pending' END,
                stripe_checkout_session_id = $2, updated_at = NOW()
          WHERE user_id = $1`,
        [req.user.id, session.id]
      );
      res.json({ provider: "stripe", url: session.url });
    } catch (err) {
      console.error("Subscription checkout error:", err);
      res.status(500).json({ error: "Could not start subscription checkout. Please try again." });
    }
  });

  app.post("/api/subscription/paystack/verify", requireAuth, async (req, res) => {
    const reference = String(req.body?.reference || "");
    if (!reference) return res.status(400).json({ error: "Missing payment reference." });
    try {
      const { rows } = await pool.query(
        "SELECT plan, paystack_reference FROM lb_subscriptions WHERE user_id = $1",
        [req.user.id]
      );
      if (!rows.length || rows[0].paystack_reference !== reference) {
        return res.status(404).json({ error: "Subscription payment not found." });
      }
      const transaction = await paystackVerify(reference);
      const metadata = transaction.metadata || {};
      if (transaction.status !== "success" || String(metadata.subscriptionUserId) !== String(req.user.id)) {
        return res.status(409).json({ error: "Payment is not confirmed yet." });
      }
      const plan = metadata.subscriptionPlan || rows[0].plan || "monthly";
      const tier = TIERS.includes(metadata.subscriptionTier) ? metadata.subscriptionTier : "standard";
      const periodInterval = plan === "annual" ? "1 year" : "1 month";
      await pool.query(
        `UPDATE lb_subscriptions
            SET status = 'active', provider = 'paystack', currency = 'ngn', plan = $2, tier = $5,
                paystack_customer_code = COALESCE($3, paystack_customer_code),
                current_period_end = NOW() + $4::interval, updated_at = NOW()
          WHERE user_id = $1`,
        [req.user.id, plan, transaction.customer?.customer_code || null, periodInterval, tier]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error("Paystack subscription verify error:", err);
      res.status(500).json({ error: "Could not verify subscription payment." });
    }
  });

  app.post("/api/subscription/cancel", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM lb_subscriptions WHERE user_id = $1", [req.user.id]);
      const sub = rows[0];
      if (!sub || sub.status !== "active") return res.status(409).json({ error: "There is no active paid subscription to cancel." });
      if (sub.provider === "stripe" && stripe && sub.stripe_subscription_id) {
        const updated = await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
        await pool.query(
          "UPDATE lb_subscriptions SET cancel_at_period_end = TRUE, current_period_end = to_timestamp($2), updated_at = NOW() WHERE user_id = $1",
          [req.user.id, updated.current_period_end]
        );
        return res.json({ ok: true, accessUntil: new Date(updated.current_period_end * 1000).toISOString() });
      }
      if (sub.provider === "paystack" && sub.paystack_subscription_code && sub.paystack_email_token) {
        await paystackDisableSubscription(sub.paystack_subscription_code, sub.paystack_email_token);
        await pool.query(
          "UPDATE lb_subscriptions SET cancel_at_period_end = TRUE, updated_at = NOW() WHERE user_id = $1",
          [req.user.id]
        );
        return res.json({ ok: true, accessUntil: sub.current_period_end || null });
      }
      return res.status(503).json({ error: "This subscription cannot be canceled from the app yet. Contact support." });
    } catch (err) {
      console.error("Subscription cancellation error:", err);
      res.status(500).json({ error: "Could not cancel the subscription." });
    }
  });
}

export async function applyStripeSubscriptionEvent(subscription, checkoutSession = null) {
  const metadata = subscription.metadata || checkoutSession?.metadata || {};
  const userId = Number(metadata.billingUserId || checkoutSession?.client_reference_id);
  if (!userId) return;
  const status = subscription.status === "active" ? "active" :
    subscription.status === "past_due" || subscription.status === "unpaid" ? "past_due" :
    subscription.status === "canceled" ? "canceled" : "incomplete";
  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  const tier = TIERS.includes(metadata.tier) ? metadata.tier : "standard";
  // A new subscription replaces the old one: end the previous Stripe subscription
  // with proration so the unused time is credited to the customer's balance.
  const { rows: previous } = await pool.query("SELECT stripe_subscription_id FROM lb_subscriptions WHERE user_id = $1", [userId]);
  const oldId = previous[0]?.stripe_subscription_id;
  // Events from a replaced subscription (e.g. its cancellation) must not overwrite the new one.
  if (oldId && oldId !== subscription.id && status !== "active") return;
  if (oldId && oldId !== subscription.id && status === "active" && stripe) {
    try {
      await stripe.subscriptions.cancel(oldId, { prorate: true, invoice_now: true });
    } catch (err) {
      console.error("Could not end the replaced subscription:", err.message);
    }
  }
  await pool.query(
    `INSERT INTO lb_subscriptions
       (user_id, status, plan, tier, currency, provider, current_period_end, stripe_customer_id, stripe_subscription_id, cancel_at_period_end, updated_at)
     VALUES ($1,$2,$3,$9,$4,'stripe',$5,$6,$7,$8,NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       status = EXCLUDED.status, plan = EXCLUDED.plan, tier = EXCLUDED.tier, currency = EXCLUDED.currency,
       provider = 'stripe', current_period_end = EXCLUDED.current_period_end,
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end, updated_at = NOW()`,
    [userId, status, metadata.plan || null, (metadata.currency || "usd").toLowerCase(), currentPeriodEnd, customerId || null, subscription.id, !!subscription.cancel_at_period_end, tier]
  );
}

export async function applyStripeCheckoutSession(session) {
  const userId = Number(session.metadata?.billingUserId || session.client_reference_id);
  if (!userId || !session.subscription || !stripe) return;
  const subscription = await stripe.subscriptions.retrieve(session.subscription);
  await applyStripeSubscriptionEvent(subscription, session);
}
