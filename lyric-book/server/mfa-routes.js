import bcrypt from "bcryptjs";
import { pool } from "./db.js";
import { COOKIE_NAME, cookieOptions, requireAuth, signToken } from "./auth.js";
import {
  decryptTotpSecret,
  encryptTotpSecret,
  hashRecoveryCode,
  isMfaEncryptionConfigured,
  matchingTotpStep,
  newRecoveryCodes,
  newTotpSecret,
  recordSuccessfulLogin,
  signMfaChallenge,
  totpUri,
  verifyMfaChallenge
} from "./auth-security.js";
import { sharedRateLimit } from "./rate-limit.js";

const setupLimit = sharedRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  key: (req) => `mfa:setup:${req.user.id}`
});
const enableLimit = sharedRateLimit({
  max: 10,
  key: (req) => `mfa:enable:${req.user.id}`
});
const disableLimit = sharedRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  key: (req) => `mfa:disable:${req.user.id}`
});
const verifyIpLimit = sharedRateLimit({
  max: 10,
  key: (req) => `mfa:verify:ip:${req.ip || "unknown"}`
});
const verifyChallengeLimit = sharedRateLimit({
  max: 10,
  key: (req) => req.body?.challengeToken ? `mfa:verify:challenge:${req.body.challengeToken}` : null
});

export async function accountHasMfa(userId) {
  const { rows } = await pool.query(
    "SELECT 1 FROM lb_user_mfa WHERE user_id=$1 AND enabled_at IS NOT NULL",
    [userId]
  );
  return rows.length > 0;
}

export function registerMfaRoutes(app) {
  app.get("/api/auth/mfa/status", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT m.enabled_at,
                (SELECT COUNT(*)::integer FROM lb_mfa_recovery_codes r
                 WHERE r.user_id=m.user_id AND r.used_at IS NULL) AS recovery_codes_remaining
           FROM lb_user_mfa m WHERE m.user_id=$1`,
        [req.user.id]
      );
      res.json({
        available: isMfaEncryptionConfigured(),
        enabled: !!rows[0]?.enabled_at,
        pending: !!rows[0] && !rows[0].enabled_at,
        recoveryCodesRemaining: Number(rows[0]?.recovery_codes_remaining || 0)
      });
    } catch (err) {
      console.error("MFA status error:", err.message);
      res.status(500).json({ error: "Could not load security settings." });
    }
  });

  app.post("/api/auth/mfa/setup", requireAuth, setupLimit, async (req, res) => {
    if (!isMfaEncryptionConfigured()) {
      return res.status(503).json({ error: "Authenticator MFA is not configured on this server yet." });
    }
    try {
      const { rows: accounts } = await pool.query(
        "SELECT password_hash FROM lb_users WHERE id=$1",
        [req.user.id]
      );
      if (!accounts.length || !(await bcrypt.compare(String(req.body?.password || ""), accounts[0].password_hash))) {
        return res.status(403).json({ error: "Enter your current password to set up authenticator MFA." });
      }
      const secret = newTotpSecret();
      const encrypted = encryptTotpSecret(secret);
      const { rows } = await pool.query(
        `INSERT INTO lb_user_mfa (user_id, secret_ciphertext, secret_iv, secret_tag)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET
           secret_ciphertext=EXCLUDED.secret_ciphertext,
           secret_iv=EXCLUDED.secret_iv,
           secret_tag=EXCLUDED.secret_tag,
           enabled_at=NULL,
           last_totp_step=NULL,
           updated_at=NOW()
         WHERE lb_user_mfa.enabled_at IS NULL
         RETURNING user_id`,
        [req.user.id, encrypted.secret_ciphertext, encrypted.secret_iv, encrypted.secret_tag]
      );
      if (!rows.length) return res.status(409).json({ error: "Authenticator MFA is already enabled." });
      res.json({ secret, otpauthUri: totpUri(req.user.email, secret) });
    } catch (err) {
      console.error("MFA setup error:", err.message);
      res.status(500).json({ error: "Could not start authenticator setup." });
    }
  });

  app.post("/api/auth/mfa/enable", requireAuth, enableLimit, async (req, res) => {
    let pending;
    try {
      pending = await verifyPendingCode(req.user.id, req.body?.code);
    } catch (err) {
      console.error("MFA setup verification error:", err.message);
      return res.status(500).json({ error: "Could not verify the authenticator code." });
    }
    if (!pending || pending.step === null) return res.status(400).json({ error: "Enter the current 6-digit authenticator code." });
    const recoveryCodes = newRecoveryCodes();
    let client;
    let transactionStarted = false;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      transactionStarted = true;
      const enabled = await client.query(
        `UPDATE lb_user_mfa SET enabled_at=NOW(), last_totp_step=$2, updated_at=NOW()
         WHERE user_id=$1 AND enabled_at IS NULL AND secret_ciphertext=$3 RETURNING user_id`,
        [req.user.id, pending.step, pending.secretCiphertext]
      );
      if (!enabled.rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return res.status(409).json({ error: "Authenticator setup expired. Start setup again." });
      }
      await client.query("DELETE FROM lb_mfa_recovery_codes WHERE user_id=$1", [req.user.id]);
      for (const code of recoveryCodes) {
        await client.query(
          "INSERT INTO lb_mfa_recovery_codes (user_id, code_hash) VALUES ($1,$2)",
          [req.user.id, hashRecoveryCode(code)]
        );
      }
      await client.query("COMMIT");
      transactionStarted = false;
      res.json({ enabled: true, recoveryCodes });
    } catch (err) {
      if (client && transactionStarted) {
        await client.query("ROLLBACK").catch((rollbackErr) => console.error("MFA enable rollback failed:", rollbackErr.message));
      }
      console.error("MFA enable error:", err.message);
      res.status(500).json({ error: "Could not enable authenticator MFA." });
    } finally {
      client?.release();
    }
  });

  app.post("/api/auth/mfa/disable", requireAuth, disableLimit, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.password_hash, m.secret_ciphertext, m.secret_iv, m.secret_tag, m.enabled_at
           FROM lb_users u LEFT JOIN lb_user_mfa m ON m.user_id=u.id
          WHERE u.id=$1`,
        [req.user.id]
      );
      const account = rows[0];
      if (!account?.enabled_at) return res.status(400).json({ error: "Authenticator MFA is not enabled." });
      if (!(await bcrypt.compare(String(req.body?.password || ""), account.password_hash))) {
        return res.status(403).json({ error: "Password or authenticator code is incorrect." });
      }

      const secret = decryptTotpSecret(account);
      const step = matchingTotpStep(secret, req.body?.code);
      const recoveryHash = hashRecoveryCode(req.body?.code);
      const client = await pool.connect();
      let transactionStarted = false;
      try {
        await client.query("BEGIN");
        transactionStarted = true;
        let valid = step !== null;
        if (valid) {
          const used = await client.query(
            `UPDATE lb_user_mfa SET last_totp_step=$2, updated_at=NOW()
             WHERE user_id=$1 AND enabled_at IS NOT NULL
               AND (last_totp_step IS NULL OR last_totp_step < $2)
             RETURNING user_id`,
            [req.user.id, step]
          );
          valid = used.rows.length > 0;
        }
        if (!valid && recoveryHash) {
          const used = await client.query(
            `UPDATE lb_mfa_recovery_codes SET used_at=NOW()
             WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING id`,
            [req.user.id, recoveryHash]
          );
          valid = used.rows.length > 0;
        }
        if (!valid) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return res.status(403).json({ error: "Password or authenticator code is incorrect." });
        }
        await client.query("DELETE FROM lb_mfa_recovery_codes WHERE user_id=$1", [req.user.id]);
        await client.query("DELETE FROM lb_user_mfa WHERE user_id=$1", [req.user.id]);
        await client.query("COMMIT");
        transactionStarted = false;
        res.json({ enabled: false });
      } catch (err) {
        if (transactionStarted) {
          await client.query("ROLLBACK").catch((rollbackErr) => console.error("MFA disable rollback failed:", rollbackErr.message));
        }
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("MFA disable error:", err.message);
      res.status(500).json({ error: "Could not disable authenticator MFA." });
    }
  });

  app.post("/api/auth/mfa/verify", verifyIpLimit, verifyChallengeLimit, async (req, res) => {
    let challenge;
    try {
      challenge = verifyMfaChallenge(req.body?.challengeToken);
    } catch {
      return res.status(401).json({ error: "This sign-in challenge has expired. Sign in again." });
    }

    try {
      const { rows } = await pool.query(
        `SELECT u.id, u.email, u.auth_version, m.secret_ciphertext, m.secret_iv, m.secret_tag, m.last_totp_step
           FROM lb_users u JOIN lb_user_mfa m ON m.user_id=u.id
          WHERE u.id=$1 AND m.enabled_at IS NOT NULL`,
        [challenge.uid]
      );
      const account = rows[0];
      if (!account || Number(challenge.av ?? 0) !== Number(account.auth_version || 0)) {
        return res.status(401).json({ error: "This sign-in challenge has expired. Sign in again." });
      }

      const secret = decryptTotpSecret(account);
      const step = matchingTotpStep(secret, req.body?.code);
      let verified = false;
      if (step !== null) {
        const { rows: used } = await pool.query(
          `UPDATE lb_user_mfa SET last_totp_step=$2, updated_at=NOW()
           WHERE user_id=$1 AND enabled_at IS NOT NULL
             AND (last_totp_step IS NULL OR last_totp_step < $2)
           RETURNING user_id`,
          [account.id, step]
        );
        verified = used.length > 0;
      }
      if (!verified) {
        const recoveryHash = hashRecoveryCode(req.body?.code);
        if (recoveryHash) {
          const { rows: used } = await pool.query(
            `UPDATE lb_mfa_recovery_codes SET used_at=NOW()
             WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING id`,
            [account.id, recoveryHash]
          );
          verified = used.length > 0;
        }
      }
      if (!verified) return res.status(401).json({ error: "Authenticator or recovery code is incorrect." });

      const token = signToken(account);
      res.cookie(COOKIE_NAME, token, cookieOptions());
      res.json({ token, user: { id: account.id, email: account.email } });
      recordSuccessfulLogin(req, account, true)
        .catch((err) => console.error("New-login tracking failed:", err.message));
    } catch (err) {
      console.error("MFA verification error:", err.message);
      res.status(500).json({ error: "Could not verify the authenticator code." });
    }
  });
}

async function verifyPendingCode(userId, input) {
  const { rows } = await pool.query(
    `SELECT secret_ciphertext, secret_iv, secret_tag
       FROM lb_user_mfa WHERE user_id=$1 AND enabled_at IS NULL`,
    [userId]
  );
  if (!rows.length) return null;
  const secret = decryptTotpSecret(rows[0]);
  return {
    step: matchingTotpStep(secret, input),
    secretCiphertext: rows[0].secret_ciphertext
  };
}
