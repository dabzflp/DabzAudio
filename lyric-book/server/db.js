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

function normalizeEnvValue(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("${{") && trimmed.includes("}}")) return "";
  return trimmed;
}

const isProd = process.env.NODE_ENV === "production";
const pgHost = normalizeEnvValue(process.env.PGHOST || "/tmp");
const pgPort = normalizeEnvValue(process.env.PGPORT || "5432");
const pgUser = normalizeEnvValue(process.env.PGUSER || process.env.USER || process.env.USERNAME || "postgres");
const pgPassword = normalizeEnvValue(process.env.PGPASSWORD);
const pgDatabase = normalizeEnvValue(process.env.PGDATABASE || process.env.POSTGRES_DB || process.env.USER || process.env.USERNAME || "postgres");
const hasPgParts =
  !!process.env.PGHOST &&
  !!process.env.PGPORT &&
  !!process.env.PGUSER &&
  !!process.env.PGPASSWORD &&
  !!process.env.PGDATABASE;

const connectionString = normalizeEnvValue(process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL) || (isProd ? "" : `postgresql://${pgUser}@/${pgDatabase}?host=${encodeURIComponent(pgHost)}`);

if (!connectionString && !hasPgParts) {
  if (isProd) {
    throw new Error(
      "Missing DB config. Set DATABASE_URL or PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE in Railway Variables."
    );
  }
  console.warn("⚠️ No database config found; using local PostgreSQL socket connection for development.");
}

let shouldUseSsl = isProd;
try {
  const u = hasPgParts ? new URL(`postgresql://${pgHost}`) : new URL(connectionString);
  // Railway private networking hosts typically do not need TLS from service->db.
  if (u.hostname.endsWith(".railway.internal")) {
    shouldUseSsl = false;
  }
} catch {
  // leave default
}

const poolConfig = hasPgParts
  ? {
      host: pgHost,
      port: Number(pgPort || 5432),
      user: pgUser,
      password: pgPassword,
      database: pgDatabase,
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
