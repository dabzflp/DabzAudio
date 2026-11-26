import test from "node:test";
import assert from "node:assert/strict";
import { pricingCatalog } from "../credits.js";
import { runMeteredLyricAI } from "../ai.js";

test("pricing catalog includes Lyric Book AI actions on the shared standard credit plan", () => {
  const catalog = pricingCatalog();
  assert.deepEqual(catalog.costs.lyric_assistant, { standard: 1 });
  assert.deepEqual(catalog.costs.lyric_search, { standard: 1 });
  assert.deepEqual(catalog.costs.help_assistant, { standard: 1 });
  assert.deepEqual(catalog.costs.campaign_generate, { standard: 10 });
  assert.equal(catalog.lowThreshold, 20);
});

test("runMeteredLyricAI deducts credits from global pool and logs usage on success", async () => {
  const calls = [];
  const spentBalance = { monthly: 119, purchased: 0, total: 119, allowance: 120 };
  const outcome = await runMeteredLyricAI({
    userId: 42,
    isProUser: async () => true,
    action: "lyric_assistant",
    provider: "groq",
    inputChars: 80,
    run: async (onUsage) => {
      onUsage({ input_tokens: 50, output_tokens: 100 });
      return { suggestions: [{ text: "Line", reason: "Fit" }] };
    },
    spendFn: async (uid, pro, cost, ref) => {
      calls.push({ kind: "spend", uid, pro, cost, ref });
      return { parts: { monthly: 1, purchased: 0 }, balance: spentBalance };
    },
    refundFn: async () => {
      throw new Error("should not refund");
    },
    queryFn: async (sql, params) => {
      calls.push({ kind: "query", sql, params });
      return { rows: [] };
    }
  });

  assert.equal(outcome.insufficient, false);
  assert.equal(outcome.credits, 1);
  assert.deepEqual(outcome.balance, spentBalance);
  assert.equal(calls[0].kind, "spend");
  assert.equal(calls[0].cost, 1);
  assert.equal(calls[1].kind, "query");
  assert.equal(calls[1].params[1], "lyric_assistant");
  assert.equal(calls[1].params[6], 1);
});

test("runMeteredLyricAI returns 402 PRO_REQUIRED for non-Pro users without purchased credits", async () => {
  const res = await runMeteredLyricAI({
    userId: 7,
    isProUser: async () => false,
    action: "lyric_search",
    provider: "groq",
    run: async () => {
      throw new Error("model should not run when credits are insufficient");
    },
    spendFn: async () => {
      const err = new Error("Not enough credits.");
      err.code = "INSUFFICIENT";
      err.balance = { monthly: 0, purchased: 0, total: 0, allowance: 120 };
      throw err;
    }
  });

  assert.equal(res.insufficient, true);
  assert.equal(res.status, 402);
  assert.equal(res.body.code, "PRO_REQUIRED");
  assert.equal(res.body.needed, 1);
});

test("runMeteredLyricAI returns 402 INSUFFICIENT_CREDITS for Pro users at zero balance", async () => {
  const res = await runMeteredLyricAI({
    userId: 8,
    isProUser: async () => true,
    action: "lyric_assistant",
    provider: "groq",
    run: async () => ({}),
    spendFn: async () => {
      const err = new Error("Not enough credits.");
      err.code = "INSUFFICIENT";
      err.balance = { monthly: 0, purchased: 0, total: 0, allowance: 120 };
      throw err;
    }
  });

  assert.equal(res.insufficient, true);
  assert.equal(res.status, 402);
  assert.equal(res.body.code, "INSUFFICIENT_CREDITS");
});

test("runMeteredLyricAI refunds credits and marks failure when the model call throws", async () => {
  const refunded = [];
  const logged = [];
  await assert.rejects(
    runMeteredLyricAI({
      userId: 9,
      isProUser: async () => true,
      action: "lyric_assistant",
      provider: "groq",
      run: async () => {
        throw Object.assign(new Error("Service unavailable"), { status: 503 });
      },
      spendFn: async () => ({
        parts: { monthly: 1, purchased: 0 },
        balance: { monthly: 119, purchased: 0, total: 119, allowance: 120 }
      }),
      refundFn: async (uid, pro, parts, ref) => {
        refunded.push({ uid, pro, parts, ref });
        return { monthly: 120, purchased: 0, total: 120, allowance: 120 };
      },
      queryFn: async (sql, params) => {
        logged.push({ sql, params });
        return { rows: [] };
      }
    }),
    (err) => err.status === 503 && err.refunded === true && err.balance.total === 120
  );

  assert.equal(refunded.length, 1);
  assert.deepEqual(refunded[0].parts, { monthly: 1, purchased: 0 });
  assert.equal(logged.length, 1);
  assert.match(logged[0].sql, /FALSE/);
});
