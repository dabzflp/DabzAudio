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
