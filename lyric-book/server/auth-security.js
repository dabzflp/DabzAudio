import crypto from "crypto";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";
import { sendNewLoginAlert } from "./email.js";

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || "dev-only-insecure-secret-change-me";
const mfaKeyHex = process.env.MFA_ENCRYPTION_KEY || "";
if (mfaKeyHex && !/^[a-f0-9]{64}$/i.test(mfaKeyHex)) {
  throw new Error("MFA_ENCRYPTION_KEY must be 64 hexadecimal characters (32 random bytes).");
}
const MFA_KEY = mfaKeyHex ? Buffer.from(mfaKeyHex, "hex") : null;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MFA_ISSUER = "DabzAudio Lyric Book";

export function newTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function totpUri(email, secret) {
  const label = `${MFA_ISSUER}:${email}`;
  const query = new URLSearchParams({
    secret,
    issuer: MFA_ISSUER,
    algorithm: "SHA1",
    digits: "6",
    period: "30"
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query}`;
}

export function encryptTotpSecret(secret) {
  if (!MFA_KEY) throw new Error("MFA_ENCRYPTION_KEY is not configured.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", MFA_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { secret_ciphertext: ciphertext, secret_iv: iv, secret_tag: cipher.getAuthTag() };
}

export function decryptTotpSecret(row) {
  if (!MFA_KEY) throw new Error("MFA_ENCRYPTION_KEY is not configured.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", MFA_KEY, Buffer.from(row.secret_iv));
  decipher.setAuthTag(Buffer.from(row.secret_tag));
  return Buffer.concat([
    decipher.update(Buffer.from(row.secret_ciphertext)),
    decipher.final()
  ]).toString("utf8");
}

export function isMfaEncryptionConfigured() {
  return !!MFA_KEY;
}

export function matchingTotpStep(secret, input, now = Date.now()) {
  const code = String(input || "").trim();
  if (!/^\d{6}$/.test(code)) return null;
  const key = base32Decode(secret);
  const currentStep = Math.floor(now / 30000);
  for (let offset = -1; offset <= 1; offset += 1) {
    const counter = BigInt(currentStep + offset);
    const message = Buffer.alloc(8);
    message.writeBigUInt64BE(counter);
    const digest = crypto.createHmac("sha1", key).update(message).digest();
    const index = digest[digest.length - 1] & 0x0f;
    const value = (digest.readUInt32BE(index) & 0x7fffffff) % 1000000;
    const expected = String(value).padStart(6, "0");
    if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))) return currentStep + offset;
  }
  return null;
}

export function verifyTotp(secret, input, now = Date.now()) {
  return matchingTotpStep(secret, input, now) !== null;
}

export function newRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(10).toString("hex").toUpperCase().match(/.{1,5}/g).join("-")
  );
}

export function hashRecoveryCode(input) {
  const normalized = String(input || "").replace(/[^a-f0-9]/gi, "").toLowerCase();
  if (!/^[a-f0-9]{20}$/.test(normalized)) return "";
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function signMfaChallenge(user) {
  return jwt.sign({
    uid: user.id,
    email: user.email,
    av: Number(user.auth_version || 0),
    purpose: "mfa"
  }, JWT_SECRET, { expiresIn: "5m" });
}

export function verifyMfaChallenge(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  if (payload.purpose !== "mfa" || !payload.uid) throw new Error("Invalid MFA challenge.");
  return payload;
}

export async function registerLoginFingerprint(req, userId) {
  const ip = String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 64);
  const userAgent = String(req.get("user-agent") || "Unknown browser").slice(0, 300);
  const fingerprintHash = crypto.createHmac("sha256", JWT_SECRET)
    .update(`${ip}\0${userAgent}`)
    .digest("hex");
  await pool.query(
    "DELETE FROM lb_login_fingerprints WHERE user_id=$1 AND last_seen_at < NOW() - INTERVAL '1 year'",
    [userId]
  );
  const { rows } = await pool.query(
    `INSERT INTO lb_login_fingerprints (user_id, fingerprint_hash)
     VALUES ($1, $2)
     ON CONFLICT (user_id, fingerprint_hash) DO NOTHING
     RETURNING user_id`,
    [userId, fingerprintHash]
  );
  if (!rows.length) {
    await pool.query(
      `UPDATE lb_login_fingerprints SET last_seen_at=NOW()
       WHERE user_id=$1 AND fingerprint_hash=$2`,
      [userId, fingerprintHash]
    );
  }
  return { isNew: rows.length > 0, ip, userAgent };
}

export async function recordSuccessfulLogin(req, user, notify) {
  const fingerprint = await registerLoginFingerprint(req, user.id);
  if (notify && fingerprint.isNew) {
    await sendNewLoginAlert(user.email, {
      ip: fingerprint.ip,
      userAgent: fingerprint.userAgent,
      happenedAt: new Date().toISOString()
    });
  }
}

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value) {
  let bits = 0;
  let buffer = 0;
  const output = [];
  for (const char of String(value).replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid authenticator secret.");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
