# DabzAudio Lyric Book

Artist accounts + lyric storage + songwriting (rhyme/rhythm) suggestions.

This is a **separate Railway service** from the Community Hub. It shares the same
PostgreSQL instance but uses `lb_*` tables, so the Community Hub is never touched.

## Architecture

```
Browser (landing-page/lyric-book, on Netlify)
   |  fetch /api/...  (Authorization: Bearer <jwt>  OR  proxied same-origin cookie)
   v
Lyric Book API (this server, on Railway)  --->  PostgreSQL (Railway)
                                          --->  Resend (password-reset emails)
```

- **Auth**: email + password, hashed with bcrypt, session via JWT (httpOnly cookie
  and/or `Authorization: Bearer`).
- **Profiles**: artist questions captured at sign-up (name, genre, influences, etc.).
- **Lyrics**: per-user create / list / read / update / delete.
- **Playback**: owner-only release library for singles and albums, cover art,
  PostgreSQL-backed audio delivery, drag reordering, and public share links.
- **Suggestions**: rhymes / near-rhymes / syllable counts via the free
  [Datamuse API](https://www.datamuse.com/api/) — a real dictionary, not an AI bot.

## Tables (`server/sql/schema.sql`)

- `lb_users` — email, password_hash
- `lb_profiles` — display_name, artist_name, genre, influences, experience
- `lb_lyrics` — title, body, owner, timestamps
- `lb_reset_tokens` — hashed, single-use, 1-hour password-reset tokens
- `lb_playback_releases` / `lb_playback_tracks` — release metadata, ownership,
  ordering, share tokens, and Cloudinary asset references

## Run locally

```bash
cd lyric-book/server
npm install
cp .env.example .env   # set DATABASE_URL + JWT_SECRET
npm run migrate        # create tables
npm start              # API + static frontend on http://localhost:4000
```

## Deploy to Railway

1. Create a **new service** from this repo with root `lyric-book/` (Procfile: `web: node server/server.js`).
2. Set Variables: `DATABASE_URL`, `JWT_SECRET`, `APP_BASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `CORS_ORIGIN`, `NODE_ENV=production`.
3. Run the migration once (Railway shell `npm run migrate`, or `psql $DATABASE_URL -f server/sql/schema.sql`).
4. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`
  for Playback cover art. Audio bytes are stored in PostgreSQL. Each track is
  limited to 25 MB, cover art to 5 MB, and each artist library to 500 MB.
5. Point the frontend at the service URL via `landing-page/lyric-book/js/config.js`
   (or add a Netlify `_redirects` proxy for `/api/*`).

## API

| Method | Path | Auth | Body |
| --- | --- | --- | --- |
| POST | /api/auth/signup | - | email, password, displayName, artistName, genre, influences, experience |
| POST | /api/auth/login | - | email, password |
| POST | /api/auth/logout | - | - |
| GET | /api/auth/me | yes | - |
| PUT | /api/profile | yes | displayName, artistName, genre, influences, experience |
| POST | /api/auth/forgot | - | email |
| POST | /api/auth/reset | - | token, password |
| GET | /api/lyrics | yes | - |
| POST | /api/lyrics | yes | title, body |
| GET | /api/lyrics/:id | yes | - |
| PUT | /api/lyrics/:id | yes | title, body |
| DELETE | /api/lyrics/:id | yes | - |
| GET | /api/playback | yes | - |
| POST | /api/playback/releases | yes | title, description, releaseType |
| PUT | /api/playback/releases/:id/cover | yes | multipart cover |
| POST | /api/playback/releases/:id/tracks | yes | multipart audio, title |
| DELETE | /api/playback/releases/:releaseId/tracks/:trackId | yes | - |
| PUT | /api/playback/releases/:id/tracks/order | yes | trackIds |
| DELETE | /api/playback/releases/:id | yes | - |
| GET | /api/playback/share/:shareToken | - | - |
| POST | /api/playback/tracks/:id/play?token=... | - | - |
