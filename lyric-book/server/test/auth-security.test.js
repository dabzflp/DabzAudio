import assert from "node:assert/strict";
import test from "node:test";

process.env.JWT_SECRET = "auth-security-test-key-that-is-long-enough";
process.env.MFA_ENCRYPTION_KEY = "a".repeat(64);
const security = await import("../auth-security.js");
const auth = await import("../auth.js");

test("validates RFC 6238 TOTP codes within the configured clock window", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(security.matchingTotpStep(secret, "287082", 59000), 1);
  assert.equal(security.matchingTotpStep(secret, "000000", 59000), null);
});

test("encrypts TOTP secrets and recovery codes are normalized before hashing", () => {
  const secret = security.newTotpSecret();
  const encrypted = security.encryptTotpSecret(secret);
  assert.notEqual(encrypted.secret_ciphertext.toString("utf8"), secret);
  assert.equal(security.decryptTotpSecret(encrypted), secret);

  const [code] = security.newRecoveryCodes();
  assert.equal(security.hashRecoveryCode(code), security.hashRecoveryCode(code.toLowerCase()));
  assert.equal(security.hashRecoveryCode("not a recovery code"), "");
});

test("signed sessions carry an auth version for password-reset revocation", () => {
  const token = auth.signToken({ id: 7, email: "artist@example.com", auth_version: 3 });
  assert.equal(auth.verifyToken(token).av, 3);
});
