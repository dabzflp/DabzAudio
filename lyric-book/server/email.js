/**
 * email.js
 * Sends transactional email via Resend.
 *
 * Env vars:
 *  - RESEND_API_KEY  (if missing, email is logged to console instead of sent,
 *                     so local dev / first deploy still works)
 *  - EMAIL_FROM      (e.g. "DabzAudio <no-reply@dabzaudio.com>")
 */
import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY || "";
const FROM = process.env.EMAIL_FROM || "DabzAudio <onboarding@resend.dev>";
const resend = apiKey ? new Resend(apiKey) : null;

export function emailEnabled() {
  return !!resend;
}

export async function sendPasswordReset(to, resetUrl) {
  const subject = "Reset your DabzAudio Lyric Book password";
  const html = `
  <div style="background:#111111;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#eaeaea">
    <div style="max-width:520px;margin:0 auto;background:#161616;border-radius:14px;padding:28px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
        <div style="width:40px;height:40px;border-radius:10px;background:#2b2b2b;color:#ff7a00;font-weight:700;display:flex;align-items:center;justify-content:center">DA</div>
        <div style="font-size:18px;font-weight:700;color:#fff">DabzAudio</div>
      </div>
      <h2 style="color:#fff;margin:0 0 12px">Reset your password</h2>
      <p style="color:#9b9b9b;line-height:1.5">We received a request to reset your Lyric Book password. This link expires in 1 hour and can only be used once.</p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="background:#ff7a00;color:#1f1f1f;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px;display:inline-block">Reset password</a>
      </p>
      <p style="color:#6f6f6f;font-size:12px;word-break:break-all">If the button doesn't work, paste this link into your browser:<br>${resetUrl}</p>
      <p style="color:#6f6f6f;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </div>`;

  if (!resend) {
    console.log(`[email disabled] Password reset for ${to}: ${resetUrl}`);
    return { sent: false };
  }
  await resend.emails.send({ from: FROM, to, subject, html });
  return { sent: true };
}

export async function sendShareInvite(to, { inviterName, lyricTitle, acceptUrl, hasAccount }) {
  const safeName = (inviterName || "A DabzAudio artist").toString();
  const safeTitle = (lyricTitle || "a lyric").toString();
  const subject = `${safeName} invited you to collaborate on "${safeTitle}"`;
  const cta = hasAccount ? "Open the lyric" : "Sign up & start writing";
  const lead = hasAccount
    ? `${safeName} wants to collaborate with you on the lyric “${safeTitle}” in the DabzAudio Lyric Book.`
    : `${safeName} wants to collaborate with you on the lyric “${safeTitle}” in the DabzAudio Lyric Book. Create a free account to start — you'll only be able to see this one shared lyric, nothing else.`;
  const html = `
  <div style="background:#111111;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#eaeaea">
    <div style="max-width:520px;margin:0 auto;background:#161616;border-radius:14px;padding:28px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
        <div style="width:40px;height:40px;border-radius:10px;background:#2b2b2b;color:#ff7a00;font-weight:700;display:flex;align-items:center;justify-content:center">DA</div>
        <div style="font-size:18px;font-weight:700;color:#fff">DabzAudio</div>
      </div>
      <h2 style="color:#fff;margin:0 0 12px">You've been invited to collaborate</h2>
      <p style="color:#9b9b9b;line-height:1.5">${lead}</p>
      <p style="margin:24px 0">
        <a href="${acceptUrl}" style="background:#ff7a00;color:#1f1f1f;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px;display:inline-block">${cta}</a>
      </p>
      <p style="color:#6f6f6f;font-size:12px;word-break:break-all">If the button doesn't work, paste this link into your browser:<br>${acceptUrl}</p>
      <p style="color:#6f6f6f;font-size:12px">If you didn't expect this invite, you can safely ignore this email.</p>
    </div>
  </div>`;

  if (!resend) {
    console.log(`[email disabled] Share invite for ${to}: ${acceptUrl}`);
    return { sent: false };
  }
  await resend.emails.send({ from: FROM, to, subject, html });
  return { sent: true };
}

// Shared email chrome (dark card with the DabzAudio badge).
function shell(inner) {
  return `
  <div style="background:#111111;padding:32px;font-family:Arial,Helvetica,sans-serif;color:#eaeaea">
    <div style="max-width:520px;margin:0 auto;background:#161616;border-radius:14px;padding:28px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
        <div style="width:40px;height:40px;border-radius:10px;background:#2b2b2b;color:#ff7a00;font-weight:700;display:flex;align-items:center;justify-content:center">DA</div>
        <div style="font-size:18px;font-weight:700;color:#fff">DabzAudio</div>
      </div>
      ${inner}
    </div>
  </div>`;
}
function ctaButton(url, label) {
  return `<p style="margin:24px 0"><a href="${url}" style="background:#ff7a00;color:#1f1f1f;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:8px;display:inline-block">${label}</a></p>
  <p style="color:#6f6f6f;font-size:12px;word-break:break-all">If the button doesn't work, paste this link into your browser:<br>${url}</p>`;
}

// An invoice sent to the recipient (registered or not).
export async function sendInvoiceEmail(to, { senderName, number, amount, note, dueDate, viewUrl, hasAccount }) {
  const safeSender = (senderName || "A DabzAudio artist").toString();
  const subject = `${safeSender} sent you an invoice (${number}) — ${amount}`;
  const due = dueDate ? `<p style="color:#9b9b9b;line-height:1.5">Due by <b style="color:#fff">${dueDate}</b>.</p>` : "";
  const noteHtml = note ? `<p style="color:#9b9b9b;line-height:1.5">“${note}”</p>` : "";
  const join = hasAccount
    ? ""
    : `<p style="color:#6f6f6f;font-size:12px;border-top:1px solid #272727;padding-top:14px;margin-top:18px">Invoicing powered by DabzAudio — the songwriting studio where artists write, collaborate and get paid. <a href="https://dabzaudio.netlify.app/lyric-book/" style="color:#ff7a00">Create a free account</a>.</p>`;
  const html = shell(`
    <h2 style="color:#fff;margin:0 0 12px">You've received an invoice</h2>
    <p style="color:#9b9b9b;line-height:1.5">${safeSender} sent you invoice <b style="color:#fff">${number}</b> for <b style="color:#fff">${amount}</b> via DabzAudio.</p>
    ${due}
    ${noteHtml}
    <p style="color:#9b9b9b;line-height:1.5">Open it to pay securely by card, or upload proof if you've paid another way.</p>
    ${ctaButton(viewUrl, "View & pay invoice")}
    ${join}`);
  if (!resend) {
    console.log(`[email disabled] Invoice ${number} for ${to}: ${viewUrl}`);
    return { sent: false };
  }
  await resend.emails.send({ from: FROM, to, subject, html });
  return { sent: true };
}

// Notify an artist they've received a gift — clearly naming who sent it.
export async function sendGiftReceivedEmail(to, { fromName, amount, net, message, lyricTitle, openUrl }) {
  if (!to) return { sent: false };
  const who = (fromName || "Someone").toString();
  const subject = `${who} sent you a gift — ${amount}`;
  const forLyric = lyricTitle ? ` for your lyric “${lyricTitle}”` : "";
  const noteHtml = message ? `<p style="color:#9b9b9b;line-height:1.5">“${message}”</p>` : "";
  const netHtml = net
    ? `<p style="color:#9b9b9b;line-height:1.5">You'll receive <b style="color:#fff">${net}</b> after the DabzAudio fee — it settles to your linked bank via the payment provider.</p>`
    : "";
  const html = shell(`
    <h2 style="color:#fff;margin:0 0 12px">You got gifted 🎁</h2>
    <p style="color:#9b9b9b;line-height:1.5"><b style="color:#fff">${who}</b> sent you a gift of <b style="color:#fff">${amount}</b>${forLyric} on DabzAudio.</p>
    ${noteHtml}
    ${netHtml}
    ${openUrl ? ctaButton(openUrl, "Open your Lyric Book") : ""}`);
  if (!resend) {
    console.log(`[email disabled] Gift received for ${to}: ${amount} from ${who}`);
    return { sent: false };
  }
  await resend.emails.send({ from: FROM, to, subject, html });
  return { sent: true };
}

// Send the payer a receipt once their invoice is honored, with a PDF download
// link (works even if they don't have a DabzAudio account).
export async function sendInvoiceReceiptEmail(to, { number, fromName, amount, downloadUrl, hasAccount }) {
  if (!to) return { sent: false };
  const safeSender = (fromName || "A DabzAudio artist").toString();
  const subject = `Receipt for invoice ${number} — ${amount}`;
  const join = hasAccount
    ? ""
    : `<p style="color:#6f6f6f;font-size:12px;border-top:1px solid #272727;padding-top:14px;margin-top:18px">Invoicing powered by DabzAudio. <a href="https://dabzaudio.netlify.app/lyric-book/" style="color:#ff7a00">Create a free account</a> to keep all your invoices in one place.</p>`;
  const html = shell(`
    <h2 style="color:#fff;margin:0 0 12px">Payment confirmed — here's your receipt</h2>
    <p style="color:#9b9b9b;line-height:1.5">Invoice <b style="color:#fff">${number}</b> from ${safeSender} for <b style="color:#fff">${amount}</b> has been marked as paid.</p>
    <p style="color:#9b9b9b;line-height:1.5">Download a PDF copy for your records:</p>
    ${ctaButton(downloadUrl, "Download PDF receipt")}
    ${join}`);
  if (!resend) {
    console.log(`[email disabled] Invoice receipt ${number} for ${to}: ${downloadUrl}`);
    return { sent: false };
  }
  await resend.emails.send({ from: FROM, to, subject, html });
  return { sent: true };
}

// Notify the sender their invoice was honored (paid online).
export async function sendInvoiceHonoredEmail(to, { senderName, number, payer, amount, method }) {
  if (!to) return { sent: false };
  const subject = `Invoice ${number} was paid — ${amount}`;
  const html = shell(`
    <h2 style="color:#fff;margin:0 0 12px">Your invoice was honored 🎉</h2>
    <p style="color:#9b9b9b;line-height:1.5">Hi ${senderName || "there"}, ${payer} honored invoice <b style="color:#fff">${number}</b> for <b style="color:#fff">${amount}</b> (${method}).</p>
    <p style="color:#9b9b9b;line-height:1.5">The funds are on their way to your connected account and will settle to your bank via Stripe.</p>`);
  if (!resend) {
    console.log(`[email disabled] Invoice honored ${number} for ${to}`);
    return { sent: false };
  }
  await resend.emails.send({ from: FROM, to, subject, html });
  return { sent: true };
}

// Notify the sender that the recipient uploaded proof of payment (needs review).
export async function sendInvoiceProofEmail(to, { senderName, number, payer, amount, openUrl }) {
  if (!to) return { sent: false };
  const subject = `Proof of payment uploaded for invoice ${number}`;
  const html = shell(`
    <h2 style="color:#fff;margin:0 0 12px">Proof of payment received</h2>
    <p style="color:#9b9b9b;line-height:1.5">Hi ${senderName || "there"}, ${payer} uploaded proof they've paid invoice <b style="color:#fff">${number}</b> (${amount}).</p>
    <p style="color:#9b9b9b;line-height:1.5">Review the proof in your Invoices panel and confirm to mark it honored.</p>
    ${ctaButton(openUrl, "Review & confirm")}`);
  if (!resend) {
    console.log(`[email disabled] Invoice proof ${number} for ${to}: ${openUrl}`);
    return { sent: false };
  }
  await resend.emails.send({ from: FROM, to, subject, html });
  return { sent: true };
}
