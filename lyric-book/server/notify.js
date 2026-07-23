/**
 * notify.js
 * Small shared notification helpers used by both payment rails (Stripe +
 * Paystack), kept out of payments.js/paystack.js to avoid import cycles.
 */
import { pool } from "./db.js";
import { displayNameForUser } from "./access.js";
import { sendGiftReceivedEmail } from "./email.js";

function appBase() {
  return (process.env.APP_BASE_URL || "https://dabzaudio.netlify.app/lyric-book").replace(/\/$/, "");
}

function formatMoney(cents, currency) {
  const cur = String(currency || "gbp").toUpperCase();
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur }).format((Number(cents) || 0) / 100);
  } catch {
    return cur + " " + ((Number(cents) || 0) / 100).toFixed(2);
  }
}

/**
 * Email the recipient that they've been gifted, clearly naming the sender.
 * Best-effort: never throws (a failed email must not fail the payment webhook).
 * Call this only when a gift actually transitions to paid so it fires once.
 */
export async function notifyGiftReceived(giftId) {
  try {
    const { rows } = await pool.query(
      `SELECT g.amount_cents, g.fee_cents, g.currency, g.message,
              g.from_user_id, ru.email AS to_email, l.title AS lyric_title
         FROM lb_gifts g
         LEFT JOIN lb_users ru ON ru.id = g.to_user_id
         LEFT JOIN lb_lyrics l ON l.id = g.lyric_id
        WHERE g.id = $1`,
      [giftId]
    );
    const g = rows[0];
    if (!g || !g.to_email) return;
    const sender = await displayNameForUser(g.from_user_id);
    const gross = Number(g.amount_cents) || 0;
    const net = gross - (Number(g.fee_cents) || 0);
    await sendGiftReceivedEmail(g.to_email, {
      fromName: sender.name,
      amount: formatMoney(gross, g.currency),
      net: net > 0 && net !== gross ? formatMoney(net, g.currency) : "",
      message: g.message || "",
      lyricTitle: g.lyric_title || "",
      openUrl: `${appBase()}/app.html`
    });
  } catch (e) {
    console.error("notifyGiftReceived error", e?.message);
  }
}
