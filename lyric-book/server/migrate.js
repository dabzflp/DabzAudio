/**
 * migrate.js
 * Applies sql/schema.sql to the configured PostgreSQL database.
 * Usage: npm run migrate
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool, connectWithRetry } from "./db.js";

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
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
