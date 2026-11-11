import test from "node:test";
import assert from "node:assert/strict";
import { proActive } from "../subscriptions.js";

test("unlimited account entitlement unlocks Pro feature gates without an active subscription", () => {
  assert.equal(proActive({ unlimited_access: true }), true);
  assert.equal(proActive({ unlimited_access: false, tier: "standard", status: "active" }), false);
  assert.equal(proActive({ unlimited_access: false, tier: "pro", status: "canceled" }), false);
});
