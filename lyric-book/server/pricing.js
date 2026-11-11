/**
 * pricing.js — single source of truth for tiers, credit costs and packs.
 *
 * Credit prices are FIXED per action so users always know what something
 * costs. The real token usage is measured separately (lb_ai_usage) so these
 * numbers can be tuned against actual provider cost.
 *
 * Provider token prices are ESTIMATES in USD per million tokens. Check them
 * against the provider pricing pages before launch and override with env vars
 * (e.g. PRICE_STANDARD_IN / PRICE_STANDARD_OUT).
 */

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const GBP_MONTHLY_PRICES = { standard: 500, pro: 899 };
const NGN_MONTHLY_PRICES = { standard: 200000, pro: 320000 };
const FX_CURRENCIES = ["USD", "EUR", "CAD", "AUD"];
const FX_RATES_URL = "https://api.frankfurter.dev/v1/latest?base=GBP&symbols=USD,EUR,CAD,AUD";
const FX_CACHE_MS = 24 * 60 * 60 * 1000;
const FX_RETRY_MS = 5 * 60 * 1000;
let cachedFx = null;
let fxRefresh = null;
let fxRetryAfter = 0;

export function buildTierPrices(rates = null) {
  const prices = {};
  for (const tier of ["standard", "pro"]) {
    const gbpMonthly = GBP_MONTHLY_PRICES[tier];
    const ngnMonthly = NGN_MONTHLY_PRICES[tier];
    prices[tier] = {
      gbp: { monthly: gbpMonthly, annual: gbpMonthly * 11 },
      ngn: { monthly: ngnMonthly, annual: ngnMonthly * 11 }
    };
    for (const currency of FX_CURRENCIES) {
      if (!rates) continue;
      const rate = Number(rates[currency]);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(`Missing or invalid GBP exchange rate for ${currency}.`);
      }
      const monthly = Math.ceil(gbpMonthly * rate);
      prices[tier][currency.toLowerCase()] = { monthly, annual: monthly * 11 };
    }
  }
  return prices;
}

async function refreshFxRates() {
  const response = await fetch(FX_RATES_URL, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`FX service returned HTTP ${response.status}.`);
  const data = await response.json();
  if (!data.date || !data.rates || typeof data.rates !== "object") {
    throw new Error("FX service returned an invalid response.");
  }
  buildTierPrices(data.rates);
  cachedFx = { rates: data.rates, date: data.date, fetchedAt: Date.now() };
  fxRetryAfter = 0;
  return cachedFx;
}

export async function getTierPrices() {
  const fallback = () => ({ prices: buildTierPrices(), fxAvailable: false, fxRateDate: null });
  if (cachedFx && Date.now() - cachedFx.fetchedAt < FX_CACHE_MS) {
    return {
      prices: buildTierPrices(cachedFx.rates),
      fxAvailable: true,
      fxRateDate: cachedFx.date
    };
  }
  if (Date.now() < fxRetryAfter) return fallback();

  try {
    if (!fxRefresh) fxRefresh = refreshFxRates();
    const fx = await fxRefresh;
    return { prices: buildTierPrices(fx.rates), fxAvailable: true, fxRateDate: fx.date };
  } catch (err) {
    console.error("Subscription FX rate refresh failed:", err.message);
    fxRetryAfter = Date.now() + FX_RETRY_MS;
    return fallback();
  } finally {
    fxRefresh = null;
  }
}

export const TIERS = ["standard", "pro"];

// Monthly credit allowance included with Pro (resets each calendar month).
export const PRO_MONTHLY_ALLOWANCE = num("PRO_MONTHLY_CREDITS", 120);

// Credits charged per action.
export const CREDIT_COSTS = {
  campaign_generate: 10,
  pitch_draft: 1,
  item_rewrite: 1,
  epk_bio: 1
};

// Output-token ceiling per action, so one request can't run away.
export const MAX_OUTPUT_TOKENS = {
  campaign_generate: 14000,
  pitch_draft: 1200,
  item_rewrite: 800,
  epk_bio: 800
};

// Keep the standard tier identifier for existing clients and usage history.
export const MODEL_TIERS = {
  standard: {
    label: "Standard",
    multiplier: 1,
    inPerM: num("PRICE_STANDARD_IN", 0.27),
    outPerM: num("PRICE_STANDARD_OUT", 1.34)
  }
};

export function creditCost(action, modelTier) {
  const base = Object.hasOwn(CREDIT_COSTS, action) ? CREDIT_COSTS[action] : null;
  const tier = Object.hasOwn(MODEL_TIERS, modelTier) ? MODEL_TIERS[modelTier] : null;
  if (!base || !tier) return null;
  return Math.max(1, Math.ceil(base * tier.multiplier));
}

export function estimateCostMicroUsd(modelTier, inputTokens, outputTokens) {
  const t = MODEL_TIERS[modelTier];
  if (!t) return 0;
  return Math.round(inputTokens * t.inPerM + outputTokens * t.outPerM); // $/M tokens == micro-$/token
}

// Top-up packs. Purchased credits never expire.
export const CREDIT_PACKS = {
  small: { credits: 100, usd: 199, ngn: 80000 },
  medium: { credits: 300, usd: 499, ngn: 200000 },
  large: { credits: 800, usd: 999, ngn: 400000 }
};

// Safety caps (abuse protection), independent of credits.
export const DAILY_CAPS = {
  campaign_generate: num("DROPPILOT_DAILY_CAMPAIGNS", 8),
  total_calls: num("DROPPILOT_DAILY_CALLS", 80)
};
