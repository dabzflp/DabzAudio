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

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});
