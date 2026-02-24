/**
 * Simple migration runner for DabzAudio Community Hub
 * Usage: set DATABASE_URL in env (or in server/.env) and run `node migrate.js`
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const sqlPath = path.join(process.cwd(), 'sql', 'schema.sql');
if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL. Set it in server/.env or environment.');
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

(async () => {
  try {
    console.log('Running migrations from', sqlPath);
    await pool.query(sql);
    console.log('Migrations applied successfully.');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    await pool.end();
    process.exit(2);
  }
})();
