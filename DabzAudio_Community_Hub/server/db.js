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

const isProd = process.env.NODE_ENV === "production";
const hasPgParts =
  !!process.env.PGHOST &&
  !!process.env.PGPORT &&
  !!process.env.PGUSER &&
  !!process.env.PGPASSWORD &&
  !!process.env.PGDATABASE;

if (!process.env.DATABASE_URL && !hasPgParts) {
  throw new Error(
    "Missing DB config. Set DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE in Railway Variables."
  );
}

const connectionString = process.env.DATABASE_URL || "";

let shouldUseSsl = isProd;
try {
  const u = hasPgParts ? new URL(`postgresql://${process.env.PGHOST}`) : new URL(connectionString);
  // Railway private networking hosts typically do not need TLS from service->db.
  if (u.hostname.endsWith(".railway.internal")) {
    shouldUseSsl = false;
  }
} catch {
  // leave default
}

const poolConfig = hasPgParts
  ? {
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
      keepAlive: true,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10
    }
  : {
      connectionString,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
      keepAlive: true,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10
    };

export const pool = new Pool(poolConfig);

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
