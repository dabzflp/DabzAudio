// Dev helper: gives an account a real Pro subscription row so it follows the
// same code path as a paying user. Refuses to run in production.
// Usage: node grant-pro.js you@example.com [days]   |   node grant-pro.js you@example.com revoke
import "dotenv/config";
import { pool } from "./db.js";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run in production.");
  process.exit(1);
}
const [email, arg] = process.argv.slice(2);
if (!email) { console.error("Usage: node grant-pro.js <email> [days|revoke]"); process.exit(1); }

const { rows } = await pool.query("SELECT id FROM lb_users WHERE lower(email) = lower($1)", [email]);
if (!rows.length) { console.error("No such account."); process.exit(1); }
const id = rows[0].id;

if (arg === "revoke") {
  await pool.query("UPDATE lb_subscriptions SET tier = 'standard', status = 'canceled', current_period_end = NOW(), updated_at = NOW() WHERE user_id = $1", [id]);
  console.log("Pro revoked for", email);
} else {
  const days = Number(arg) > 0 ? Number(arg) : 30;
  await pool.query(
    `INSERT INTO lb_subscriptions (user_id, plan, tier, status, provider, currency, current_period_end, cancel_at_period_end)
     VALUES ($1, 'monthly', 'pro', 'active', 'stripe', 'usd', NOW() + ($2 || ' days')::interval, FALSE)
     ON CONFLICT (user_id) DO UPDATE SET plan = 'monthly', tier = 'pro', status = 'active', provider = 'stripe',
       currency = 'usd', current_period_end = NOW() + ($2 || ' days')::interval, cancel_at_period_end = FALSE, updated_at = NOW()`,
    [id, String(days)]
  );
  console.log(`Pro granted to ${email} for ${days} days`);
}
await pool.end();
