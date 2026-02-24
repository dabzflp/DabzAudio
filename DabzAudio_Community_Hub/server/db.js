/**
 * db.js
 * PostgreSQL connection pool (Railway)
 *
 * Required env vars:
 * - DATABASE_URL
 * Optional:
 * - NODE_ENV=production (enables SSL for Railway)
 */

import dotenv from "dotenv";
dotenv.config();

import pg from "pg";
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL. Add it in Railway Variables (or a local .env file).");
}

const isProd = process.env.NODE_ENV === "production";
const connectionString = process.env.DATABASE_URL;

let shouldUseSsl = isProd;
try {
  const u = new URL(connectionString);
  // Railway private networking hosts typically do not need TLS from service->db.
  if (u.hostname.endsWith(".railway.internal")) {
    shouldUseSsl = false;
  }
} catch {
  // leave default
}

export const pool = new Pool({
  connectionString,
  ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
  keepAlive: true,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10
});

// Prevent process crash on background/idle client errors.
pool.on("error", (err) => {
  console.error("❌ PostgreSQL pool error", err);
});

export async function connectWithRetry(attempts = 10) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query("select 1");
      console.log("✅ DB connection ok");
      return true;
    } catch (err) {
      const code = err?.code || err?.message || "unknown";
      console.error(`❌ DB connect attempt ${i}/${attempts} failed:`, code);
      if (i < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * i));
      }
    }
  }
  return false;
}
