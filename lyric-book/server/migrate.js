/**
 * migrate.js
 * Applies sql/schema.sql to the configured PostgreSQL database.
 * Usage: npm run migrate
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool, connectWithRetry } from "./db.js";
import { ensureUniqueUsername } from "./username.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const ok = await connectWithRetry();
  if (!ok) {
    console.error("❌ Could not connect to DB. Aborting migration.");
    process.exit(1);
  }
  const sql = fs.readFileSync(path.join(__dirname, "sql", "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("✅ Migration applied (lyric book tables ready).");
  await backfillUsernames();
  await pool.end();
}

// Give every existing profile a unique @username handle (idempotent).
async function backfillUsernames() {
  const { rows } = await pool.query(
    `SELECT p.user_id, p.artist_name, p.display_name, u.email
       FROM lb_profiles p
       JOIN lb_users u ON u.id = p.user_id
      WHERE p.username IS NULL OR p.username = ''
      ORDER BY p.user_id`
  );
  if (!rows.length) return;
  let assigned = 0;
  for (const r of rows) {
    const base = String(r.email || "").split("@")[0] || r.artist_name || r.display_name;
    const handle = await ensureUniqueUsername(pool, base, r.user_id);
    await pool.query("UPDATE lb_profiles SET username = $2 WHERE user_id = $1", [r.user_id, handle]);
    assigned++;
  }
  console.log(`✅ Backfilled ${assigned} username(s).`);
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
