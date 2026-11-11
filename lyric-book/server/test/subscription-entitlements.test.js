import test from "node:test";
import assert from "node:assert/strict";
import { proActive } from "../subscriptions.js";

test("grandfathered and unlimited accounts unlock Pro without active subscriptions", () => {
  assert.equal(proActive({ billing_exempt: true, tier: "standard", status: "canceled" }), true);
  assert.equal(proActive({ unlimited_access: true }), true);
  assert.equal(proActive({ billing_exempt: false, unlimited_access: false, tier: "standard", status: "active" }), false);
  assert.equal(proActive({ unlimited_access: false, tier: "pro", status: "canceled" }), false);
});
