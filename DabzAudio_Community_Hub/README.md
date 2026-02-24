# DabzAudio Community Hub

Production-ready Forum & Blog platform for DabzAudio.

This repository contains a small Node.js + Express API (`server/`) and a client single-page frontend (`public/`). The system uses PostgreSQL for persistence (Railway recommended).

Features
- Forum threads (user-created)
- Threaded comments and replies
- Like system on comments (client-side UI ready)
- Blog (admin-only publishing; users can read and comment)
- PostgreSQL schema provided in `server/sql/schema.sql`

Quick start (local)

1. Install dependencies (from repo root):

```bash
cd DabzAudio_Community_Hub/server
npm install
```

2. Create a PostgreSQL database (local or Railway). Set `DATABASE_URL` in a `.env` file at `server/.env` using the format below.

3. Run the schema SQL to create tables:

```bash
# from repo root
psql <your_database_url> -f server/sql/schema.sql
# or use Railway's Query tool to run server/sql/schema.sql
```

4. Start the server:

```bash
cd server
npm start
# Server serves the static frontend at http://localhost:3000
```

5. Optional: run the built-in migration script (preferred if you don't have `psql` locally):

```bash
# from server folder
# ensure server/.env contains DATABASE_URL
npm run migrate
```

Environment variables
- `DATABASE_URL` (required) — Postgres connection string
- `ADMIN_TOKEN` (recommended) — secret token for blog publishing (set on Railway or local .env)
- `NODE_ENV` (optional) — set to `production` to enable SSL config for Postgres
- `PORT` (optional)

`.env.example` (provided)

Deployment (Railway)

1. Push this repo to GitHub.
2. Create a new Railway project and link the GitHub repo.
3. Add environment variables in Railway: `DATABASE_URL`, `ADMIN_TOKEN`, and optionally `NODE_ENV=production`.
4. Add a `Procfile` with `web: node server/server.js` (included).
5. Use Railway's Query tool to run `server/sql/schema.sql` once to create tables.

Security notes
- Blog publishing requires the `x-admin-token` header matching `ADMIN_TOKEN`.
- Comments and forum posts are public (no auth) — consider adding captcha or rate-limiting for spam mitigation.

Files of interest
- `server/server.js` — Express API
- `server/db.js` — Postgres connection (reads `DATABASE_URL`)
- `server/sql/schema.sql` — DB schema
- `public/` — Frontend SPA (HTML/CSS/JS)

If you want, I can wire a simple migration script, add admin UI enhancements, or configure a Railway template for one-click deploy.
# DabzAudio Community Hub (Forum + Blog)
**Change requested:** Blog is **read + comment only** for normal users.

## What users can do
- ✅ Create forum posts (threads/questions)
- ✅ Reply/comment on forum posts
- ✅ Read blog posts
- ✅ Comment on blog posts (timestamps saved)
- ❌ Publish blog posts (admin-only)

## Admin-only blog publishing
Set an env var on Railway (or local .env):
- `ADMIN_TOKEN=your-long-secret-token`

When publishing a blog post, the request must include this header:
- `x-admin-token: your-long-secret-token`

This repo includes an admin page:
- `/admin.html` (not linked from the UI)

## Hosting options
### Option A) Railway Web Service + Railway Postgres (recommended)
1) Create Railway project
2) Add PostgreSQL plugin
3) Deploy this repo as a Web Service (point to `server/` or set start command)
4) Add env vars:
   - `DATABASE_URL` (Railway provides from Postgres)
   - `NODE_ENV=production`
   - `ADMIN_TOKEN=...`
5) Run schema: `server/sql/schema.sql` in Railway Postgres Query tool

### Option B) Your existing DabzAudio server
- Copy the `/api/*` routes from `server/server.js` into your existing Express app
- Serve the `public/` folder under `/community`
- Still use Railway Postgres for database

## Local run (quick)
```bash
cd server
npm install
# create server/.env with DATABASE_URL and ADMIN_TOKEN
npm start
# open http://localhost:3000
```

---
If you want: next upgrade is real user accounts + login + moderation.
