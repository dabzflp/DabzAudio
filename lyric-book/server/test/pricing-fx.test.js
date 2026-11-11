import test from "node:test";
import assert from "node:assert/strict";
import { buildTierPrices } from "../pricing.js";

test("Stripe prices preserve GBP value after FX conversion and round upward", () => {
  const rates = { USD: 1.3307, EUR: 1.1959, CAD: 1.8942, AUD: 1.94 };
  const prices = buildTierPrices(rates);

  assert.equal(prices.standard.gbp.monthly, 500);
  assert.equal(prices.pro.gbp.monthly, 899);
  assert.equal(prices.pro.usd.monthly, 1197);
  assert.equal(prices.pro.usd.annual, prices.pro.usd.monthly * 11);

  for (const [currency, rate] of Object.entries(rates)) {
    assert.ok(prices.standard[currency.toLowerCase()].monthly / rate >= prices.standard.gbp.monthly);
    assert.ok(prices.pro[currency.toLowerCase()].monthly / rate >= prices.pro.gbp.monthly);
  }
});

test("fixed Nigerian prices remain available without FX rates", () => {
  const prices = buildTierPrices();
  assert.equal(prices.standard.ngn.monthly, 200000);
  assert.equal(prices.pro.ngn.monthly, 320000);
  assert.equal(prices.pro.gbp.annual, prices.pro.gbp.monthly * 11);
  assert.equal(prices.pro.usd, undefined);
});
