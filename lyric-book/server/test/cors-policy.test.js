import test from "node:test";
import assert from "node:assert/strict";
import { createCorsOriginPolicy } from "../cors-policy.js";

test("production CORS requires an explicit exact HTTPS origin allowlist", () => {
  assert.throws(
    () => createCorsOriginPolicy({ nodeEnv: "production", configuredOrigins: "" }),
    /CORS_ORIGIN must list trusted HTTPS frontend origins/
  );
  assert.throws(
    () => createCorsOriginPolicy({ nodeEnv: "production", configuredOrigins: "*" }),
    /invalid origin/
  );
  assert.throws(
    () => createCorsOriginPolicy({ nodeEnv: "production", configuredOrigins: "https://trusted.example/path" }),
    /exact HTTPS origins/
  );
});

test("production CORS allows only explicitly configured origins", () => {
  const isAllowedOrigin = createCorsOriginPolicy({
    nodeEnv: "production",
    configuredOrigins: "https://dabzaudio.example,https://www.dabzaudio.example"
  });

  assert.equal(isAllowedOrigin("https://dabzaudio.example"), true);
  assert.equal(isAllowedOrigin("https://attacker.example"), false);
  assert.equal(isAllowedOrigin("https://deploy-preview-123--dabzaudio.netlify.app"), false);
  assert.equal(isAllowedOrigin(undefined), true);
});

test("unconfigured local development preserves cross-origin testing", () => {
  const isAllowedOrigin = createCorsOriginPolicy({ nodeEnv: "development", configuredOrigins: "" });
  assert.equal(isAllowedOrigin("http://localhost:3000"), true);
});
