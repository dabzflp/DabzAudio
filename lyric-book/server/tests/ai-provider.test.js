import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { getAIProvider } from "../ai-provider.js";
import { createModel, runHelpAssistant } from "../ai-workflow.js";
import { creditCost } from "../pricing.js";
import { pricingCatalog } from "../credits.js";
import { registerDropPilotRoutes } from "../droppilot.js";

test("provider selection is shared and restricted by environment", async () => {
  const saved = { ...process.env };
  try {
    delete process.env.LLM_PROVIDER;
    process.env.NODE_ENV = "development";
    assert.equal(getAIProvider(), "ollama");
    process.env.NODE_ENV = "production";
    assert.equal(getAIProvider(), "groq");
    process.env.LLM_PROVIDER = "ollama";
    assert.throws(getAIProvider, /Unsupported LLM_PROVIDER/);
    assert.equal(createModel("ollama"), null);
    process.env.LLM_PROVIDER = "google";
    assert.throws(getAIProvider, /Unsupported LLM_PROVIDER/);
    assert.equal(createModel("google"), null);
    process.env.LLM_PROVIDER = "groq";
    delete process.env.GROQ_API_KEY;
    assert.equal(createModel("groq"), null);
    await assert.rejects(runHelpAssistant({ question: "How do I use Lyric Book?" }), { status: 503 });
    process.env.GROQ_API_KEY = "test-key";
    assert.ok(createModel(getAIProvider()));
    process.env.NODE_ENV = "development";
    process.env.LLM_PROVIDER = "ollama";
    assert.ok(createModel(getAIProvider()));
  } finally {
    process.env = saved;
  }
});

test("only standard credits are offered and premium requests are rejected", async () => {
  const catalog = pricingCatalog();
  assert.deepEqual(Object.keys(catalog.models), ["standard"]);
  assert.deepEqual(catalog.costs.campaign_generate, { standard: 10 });
  assert.equal(creditCost("campaign_generate", "premium"), null);
  assert.equal(creditCost("toString", "standard"), null);

  const previous = process.env.DROPPILOT_SERVICE_KEY;
  process.env.DROPPILOT_SERVICE_KEY = "test-service-key";
  const app = express();
  app.use(express.json());
  registerDropPilotRoutes(app, { isProUser: async () => true });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/internal/droppilot/ai`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-key": "test-service-key" },
      body: JSON.stringify({ uid: 1, action: "campaign_generate", modelTier: "premium", prompt: "test" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "BAD_REQUEST");
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    if (previous === undefined) delete process.env.DROPPILOT_SERVICE_KEY;
    else process.env.DROPPILOT_SERVICE_KEY = previous;
  }
});
