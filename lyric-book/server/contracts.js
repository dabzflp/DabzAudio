import crypto from "crypto";
import { v2 as cloudinary } from "cloudinary";
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import {
  emailEnabled,
  sendContractInvite,
  sendContractCompleted
} from "./email.js";

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

function clampPercent(n) {
  const num = Number(n) || 0;
  return Math.max(0, Math.min(100, num));
}

function signingUrl(_req, token) {
  const configured = (process.env.APP_BASE_URL || "https://dabzaudio.com").replace(/\/$/, "");
  const base = /\/lyric-book$/i.test(configured) ? configured : `${configured}/lyric-book`;
  return `${base}/sign.html?token=${encodeURIComponent(token)}`;
}

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(d) {
  if (!d) return "(not specified)";
  try {
    return new Date(d).toLocaleDateString("en-GB");
  } catch {
    return String(d);
  }
}

async function storeSignature(signature) {
  if (!signature || !String(signature).startsWith("data:image")) {
    return signature || null;
  }
  const hasCloudinary =
    !!process.env.CLOUDINARY_CLOUD_NAME &&
    !!process.env.CLOUDINARY_API_KEY &&
    !!process.env.CLOUDINARY_API_SECRET;
  if (!hasCloudinary) return signature;

  try {
    const result = await cloudinary.uploader.upload(signature, {
      folder: "contract-signatures",
      resource_type: "image"
    });
    return result.secure_url || signature;
  } catch (err) {
    console.error("Cloudinary signature upload failed:", err.message);
    return signature;
  }
}

function formatContractHtml(contract, signers) {
  const masterTotal = signers.reduce(
    (a, s) => a + (Number(s.master_share_percent) || 0),
    0
  );
  const pubTotal = signers.reduce(
    (a, s) => a + (Number(s.publishing_share_percent) || 0),
    0
  );
  const signerText = signers
    .map(
      (s, i) =>
        `${i + 1}. ${escHtml(s.name)} (${escHtml(s.email)}) – ${escHtml(
          s.role
        )}\n   Master share: ${s.master_share_percent}%\n   Publishing share: ${s.publishing_share_percent}%`
    )
    .join("\n");

  const signaturesHtml = signers
    .filter((s) => s.signed_at)
    .map(
      (s) =>
        `<p style="margin-bottom:8px"><b>${escHtml(s.name)}</b> — ${escHtml(
          s.role
        )}<br>${formatDate(s.signed_at)}</p>${
          s.signature_url
            ? `<img src="${escHtml(s.signature_url)}" alt="signature" style="max-height:80px;background:#0f0f0f;border:1px solid #272727;border-radius:6px;padding:6px;margin-bottom:18px">`
            : ""
        }`
    )
    .join("");

  const text = `MUSIC RIGHTS AGREEMENT

Song: ${escHtml(contract.song_title)}
Primary artist: ${escHtml(contract.artist_name)}

1. PARTIES AND CAPACITY
This agreement is entered into on ${formatDate(
    contract.effective_date
  )} between the undersigned parties in connection with the musical work described below.

2. DESCRIPTION OF THE MUSICAL WORK
${escHtml(contract.description)}

3. TERRITORY AND LAW
Territory: ${escHtml(contract.territory)}
Governing law / jurisdiction: ${escHtml(contract.governing_law)}

4. OWNERSHIP AND REVENUE SPLITS
The parties agree the following ownership of the master sound recording and the underlying musical composition, subject to any rights that cannot legally be assigned:

${signerText}

Master shares total: ${masterTotal.toFixed(2)}%
Publishing shares total: ${pubTotal.toFixed(2)}%

5. GRANT OF RIGHTS AND USE
Each party grants the rights reasonably required to create, reproduce, distribute, communicate to the public, perform, synchronise, promote and otherwise exploit the musical work and recordings within the Territory, subject to the ownership splits above. Any exclusive grant, label deal, administration deal, advance, fee, royalty, recoupment or other commercial term must be agreed in a separate written instrument or stated expressly in this agreement.

6. CREDITS AND MORAL RIGHTS
The parties will use reasonable endeavours to provide accurate songwriter, producer, performer and production credits. To the extent permitted by the Copyright, Designs and Patents Act 1988, each party consents to reasonable editing, adaptation and exploitation of the work and waives or agrees not to assert moral rights only to the extent expressly permitted by law.

7. ACCOUNTING AND PAYMENT
Unless a separate written schedule states otherwise, this agreement records ownership percentages only and does not itself create a promise to pay an advance, fee or royalty. Each party is responsible for registering and collecting its own income with the relevant collection society or administrator and for keeping accurate records of amounts received.

8. WARRANTIES AND INDEMNITY
Each party warrants that, to the best of its knowledge, it has the authority to enter this agreement and that its contribution does not knowingly infringe another person’s copyright, performer’s rights, trade mark or other rights. A party that breaches this warranty will be responsible for losses directly caused by that breach, subject to applicable law.

9. CONFIDENTIALITY
The parties will keep non-public commercial terms and unreleased materials confidential, except where disclosure is required by law, a collection society, professional adviser, insurer, funder or distributor who is bound to keep the information confidential.

10. TERM AND TERMINATION
This agreement starts on the effective date and continues for the life of the rights granted unless the parties agree otherwise in writing. A material breach that is not remedied within a reasonable written notice period may be grounds for termination, without affecting rights and payment obligations that accrued before termination.

11. GOVERNING LAW AND DISPUTES
This agreement is governed by the law of the jurisdiction stated above. The parties will first try in good faith to resolve a dispute through discussion or mediation before starting court proceedings, unless urgent injunctive relief or another legal exception applies.

12. SIGNING AND COUNTERPARTS
This agreement becomes binding on the parties once all listed signers have signed an electronic or physical counterpart. A fully signed copy will be distributed to all parties after the last signer has signed.

13. GENERAL
This agreement and any written schedules contain the parties’ understanding concerning the musical work. Amendments must be in writing and signed by all affected parties. If a provision is unenforceable, the remaining provisions continue to apply.

14. SIGNATURES AND PARTY DETAILS
${signaturesHtml || "Pending — not all signers have signed yet."}

This is a UK-oriented contract template generated by DabzAudio, not legal advice. The parties should obtain advice from a qualified UK music solicitor before signing or relying on it.
`;
  return text.replace(/\n/g, "<br>");
}

export function registerContractRoutes(app) {
  app.post("/api/contracts", requireAuth, async (req, res) => {
    const {
      songTitle,
      artistName,
      description,
      territory,
      governingLaw,
      effectiveDate,
      signers
    } = req.body || {};

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [contract] } = await client.query(
        `INSERT INTO lb_contracts (user_id, song_title, artist_name, description, territory, governing_law, effective_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          req.user.id,
          String(songTitle || "").trim(),
          String(artistName || "").trim(),
          String(description || "").trim(),
          String(territory || "Worldwide").trim(),
          String(governingLaw || "").trim(),
          effectiveDate || null
        ]
      );

      const signerRows = [];
      for (const s of signers || []) {
        const token = generateToken();
        const { rows: [signer] } = await client.query(
          `INSERT INTO lb_contract_signers
            (contract_id, name, email, role, master_share_percent, publishing_share_percent, signing_token)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, contract_id, name, email, role, master_share_percent, publishing_share_percent, signed_at, signature_url, created_at`,
          [
            contract.id,
            String(s.name || "").trim(),
            String(s.email || "").trim().toLowerCase(),
            String(s.role || "").trim(),
            clampPercent(s.masterShare),
            clampPercent(s.publishingShare),
            token
          ]
        );
        signerRows.push(signer);
      }

      await client.query("COMMIT");
      res.status(201).json({ contract, signers: signerRows });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Create contract error:", err);
      res.status(500).json({ error: "Could not create contract." });
    } finally {
      client.release();
    }
  });

  app.get("/api/contracts", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT c.*,
                COALESCE(json_agg(s ORDER BY s.id) FILTER (WHERE s.id IS NOT NULL), '[]') AS signers
           FROM lb_contracts c
           LEFT JOIN lb_contract_signers s ON s.contract_id = c.id
          WHERE c.user_id = $1
          GROUP BY c.id
          ORDER BY c.updated_at DESC`,
        [req.user.id]
      );
      res.json(rows);
    } catch (err) {
      console.error("List contracts error:", err);
      res.status(500).json({ error: "Could not list contracts." });
    }
  });

  app.get("/api/contracts/:id", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT c.*,
                COALESCE(json_agg(s ORDER BY s.id) FILTER (WHERE s.id IS NOT NULL), '[]') AS signers
           FROM lb_contracts c
           LEFT JOIN lb_contract_signers s ON s.contract_id = c.id
          WHERE c.id = $1 AND c.user_id = $2
          GROUP BY c.id`,
        [req.params.id, req.user.id]
      );
      if (!rows.length) {
        return res.status(404).json({ error: "Contract not found." });
      }
      res.json(rows[0]);
    } catch (err) {
      console.error("Get contract error:", err);
      res.status(500).json({ error: "Could not load contract." });
    }
  });

  app.delete("/api/contracts/:id", requireAuth, async (req, res) => {
    try {
      const { rowCount } = await pool.query(
        `DELETE FROM lb_contracts WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!rowCount) {
        return res.status(404).json({ error: "Contract not found." });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("Delete contract error:", err);
      res.status(500).json({ error: "Could not delete contract." });
    }
  });

  // Send signing-request emails to all unsigned signers.
  app.post("/api/contracts/:id/send", requireAuth, async (req, res) => {
    if (!emailEnabled()) {
      return res
        .status(400)
        .json({
          error:
            "Resend is not configured. Set RESEND_API_KEY to send emails."
        });
    }
    const contractId = req.params.id;
    const client = await pool.connect();
    try {
      const { rows: contractRows } = await client.query(
        `SELECT * FROM lb_contracts WHERE id = $1 AND user_id = $2`,
        [contractId, req.user.id]
      );
      if (!contractRows.length) {
        return res.status(404).json({ error: "Contract not found." });
      }
      const contract = contractRows[0];

      const { rows: signerRows } = await client.query(
        `SELECT * FROM lb_contract_signers
          WHERE contract_id = $1 AND signed_at IS NULL`,
        [contractId]
      );
      if (!signerRows.length) {
        return res.status(400).json({ error: "All signers have already signed." });
      }

      let sent = 0;
      const links = [];
      for (const signer of signerRows) {
        const signUrl = signingUrl(req, signer.signing_token);
        links.push({ email: signer.email, signUrl });
        const result = await sendContractInvite(signer.email, {
          songTitle: contract.song_title,
          artistName: contract.artist_name,
          signUrl
        });
        if (result.sent) sent += 1;
      }
      res.json({ sent, total: signerRows.length, links });
    } catch (err) {
      console.error("Send contract emails error:", err);
      res.status(500).json({ error: "Could not send signing requests." });
    } finally {
      client.release();
    }
  });

  // Public: look up a contract by signer token (no auth needed).
  app.get("/api/contract-sign", async (req, res) => {
    const token = String(req.query.token || "").trim();
    if (!token) return res.status(400).json({ error: "Missing signing token." });

    try {
      const { rows: signerContractRows } = await pool.query(
        `SELECT c.*, s.id AS signer_id, s.name AS signer_name, s.email AS signer_email,
                s.role AS signer_role, s.master_share_percent, s.publishing_share_percent,
                s.signed_at, s.signature_url
           FROM lb_contracts c
           JOIN lb_contract_signers s ON s.contract_id = c.id
          WHERE s.signing_token = $1`,
        [token]
      );
      if (!signerContractRows.length) {
        return res.status(404).json({ error: "Signing link is not valid." });
      }

      const sc = signerContractRows[0];
      const { rows: allSigners } = await pool.query(
        `SELECT id, name, email, role, master_share_percent, publishing_share_percent, signed_at, signature_url
           FROM lb_contract_signers
          WHERE contract_id = $1
          ORDER BY id`,
        [sc.id]
      );

      res.json({
        contract: sc,
        me: {
          id: sc.signer_id,
          name: sc.signer_name,
          email: sc.signer_email,
          role: sc.signer_role,
          masterSharePercent: sc.master_share_percent,
          publishingSharePercent: sc.publishing_share_percent,
          signedAt: sc.signed_at,
          signatureUrl: sc.signature_url
        },
        signers: allSigners
      });
    } catch (err) {
      console.error("Get contract by sign token error:", err);
      res.status(500).json({ error: "Could not load the contract." });
    }
  });

  // Public: record a signature (no auth needed).
  app.post("/api/contract-sign", async (req, res) => {
    const { token, name, signature } = req.body || {};
    if (!token) return res.status(400).json({ error: "Missing signing token." });
    if (signature) {
      const sig = String(signature);
      if (!sig.startsWith("data:image/png;base64,")) {
        return res.status(400).json({ error: "Only PNG signature images are accepted." });
      }
      if (sig.length > 250000) {
        return res.status(400).json({ error: "Signature image is too large." });
      }
    }
    if (name && String(name).length > 200) {
      return res.status(400).json({ error: "Name is too long." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: signerRows } = await client.query(
        `SELECT s.*, c.song_title, c.artist_name, c.description, c.territory,
                c.governing_law, c.effective_date, c.user_id
           FROM lb_contract_signers s
           JOIN lb_contracts c ON c.id = s.contract_id
          WHERE s.signing_token = $1
          FOR UPDATE`,
        [token]
      );
      if (!signerRows.length) {
        return res.status(404).json({ error: "Signing link is not valid." });
      }
      const signer = signerRows[0];
      if (signer.signed_at) {
        return res.status(409).json({ error: "You have already signed this contract." });
      }

      const signatureUrl = await storeSignature(signature);
      await client.query(
        `UPDATE lb_contract_signers
            SET signed_at = NOW(), name = COALESCE($1, name), signature_url = $2
          WHERE id = $3`,
        [name ? String(name).trim() : null, signatureUrl, signer.id]
      );

      const { rows: allSigners } = await client.query(
        `SELECT id, name, email, role, master_share_percent, publishing_share_percent, signed_at, signature_url
           FROM lb_contract_signers
          WHERE contract_id = $1
          ORDER BY id`,
        [signer.contract_id]
      );

      const completed = allSigners.every((s) => s.signed_at);
      if (completed) {
        await client.query(
          "UPDATE lb_contracts SET completed_at = COALESCE(completed_at, NOW()), updated_at = NOW() WHERE id = $1",
          [signer.contract_id]
        );
        const { rows: contractRows } = await client.query(
          `SELECT * FROM lb_contracts WHERE id = $1`,
          [signer.contract_id]
        );
        const contract = contractRows[0];
        const contractHtml = formatContractHtml(contract, allSigners);
        const { rows: signerTokens } = await client.query(
          "SELECT id, signing_token FROM lb_contract_signers WHERE contract_id = $1",
          [signer.contract_id]
        );
        for (const s of allSigners) {
          const signerToken = signerTokens.find((row) => row.id === s.id)?.signing_token;
          await sendContractCompleted(s.email, {
            songTitle: contract.song_title,
            artistName: contract.artist_name,
            contractHtml,
            downloadUrl: `${signingUrl(null, signerToken)}&download=1`
          });
        }
      }

      await client.query("COMMIT");
      res.json({
        signed: true,
        completed,
        me: allSigners.find((s) => s.id === signer.id),
        signers: allSigners,
        contract: { id: signer.contract_id }
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Sign contract error:", err);
      res.status(500).json({ error: "Could not record your signature." });
    } finally {
      client.release();
    }
  });
}
