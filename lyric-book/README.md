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
- **Transfer a file**: send download links by email or copy a link to share
  directly. Both use the same seven-day expiration, starting when the upload is
  ready; download notifications go to the sender.
- **AI Assistant**: LangChain-powered lyric suggestions (improve line, rhyme
  analysis, ideas, ask), gated by the same lyric ownership/collaborator check
  as the REST API. Groq is the production provider; Ollama is available for
  local testing. Drop Pilot uses the same server-selected provider.
- **Membership**: new accounts receive 30 days of full Lyric Book access with
  no payment method required. Existing accounts are grandfathered. After the
  trial, monthly/annual subscriptions are paid through Stripe (USD/EUR) or
  Paystack (NGN).
- **Suggestions**: rhymes / near-rhymes / syllable counts via the free
  [Datamuse API](https://www.datamuse.com/api/) — a real dictionary, not an AI bot.

## Account security

- Login, signup, password-reset, and MFA verification limits are shared through
  PostgreSQL, so they apply across server instances. They use the Express client
  IP; production trusts one reverse-proxy hop by default. Set `TRUST_PROXY_HOPS`
  to the actual trusted proxy count for your deployment.
- Password resets invalidate existing Lyric Book sessions and unused reset
  links; active collaboration sockets are revalidated every 30 seconds.
  First-seen device/IP combinations trigger an email alert when Resend is
  configured.
- Users can enable optional authenticator-app MFA from **More → Security & MFA**.
  Recovery codes are shown once and stored as hashes. TOTP secrets are encrypted
  with AES-256-GCM; configure `MFA_ENCRYPTION_KEY` as 64 random hex characters, for
  example with `openssl rand -hex 32`. Keep this key private and stable: changing
  it makes existing MFA secrets unreadable.
- Run `npm run migrate` after deploying these security changes.

## Tables (`server/sql/schema.sql`)

- `lb_users` — email, password_hash
- `lb_profiles` — display_name, artist_name, genre, influences, experience
- `lb_lyrics` — title, body, owner, timestamps
- `lb_reset_tokens` — hashed, single-use, 1-hour password-reset tokens
- `lb_playback_releases` / `lb_playback_tracks` — release metadata, ownership,
  ordering, share tokens, and Cloudinary asset references
- `lb_contracts` / `lb_contract_signers` — saved contracts, signer status,
  signatures, and completion timestamps
- `lb_ai_requests` — minimal audit log (user, lyric, action, provider, time)
  for the AI Assistant; never stores request text or model replies
- `lb_subscriptions` — trial, provider, plan, renewal and access state;
  existing `lb_users` are grandfathered by `billing_exempt`
- `lb_user_mfa`, `lb_mfa_recovery_codes`, and `lb_login_fingerprints` —
  encrypted TOTP setup, one-use recovery codes, and privacy-preserving login
  fingerprints
- `lb_rate_limits` — shared hashed keys and counters for authentication limits

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
   `CORS_ORIGIN` must be a comma-separated list of exact HTTPS frontend origins
   (scheme and host, no paths); production refuses to start without it. Only
   explicitly listed origins are trusted; deploy previews are not automatically allowed.
   Set a private, stable `MFA_ENCRYPTION_KEY` before users enable MFA; changing
   it makes enrolled authenticator secrets unreadable.
3. Run the migration once (Railway shell `npm run migrate`, or `psql $DATABASE_URL -f server/sql/schema.sql`).
4. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`
  for Playback cover art. Audio bytes are stored in PostgreSQL. Each track is
  limited to 100 MB per track and cover art to 5 MB. No per-artist library cap
  is enforced by the app; total storage remains subject to database capacity and
  hosting-plan limits.
5. Point the frontend at the service URL via `landing-page/lyric-book/js/config.js`
   (or add a Netlify `_redirects` proxy for `/api/*`).
6. The Lyric Book service is the metered AI gateway for both Lyric Book and
   Drop Pilot. Set `NODE_ENV=production`, `LLM_PROVIDER=groq`, and
   `GROQ_API_KEY` on the Lyric Book service; optionally set `GROQ_MODEL`
   (defaults to `openai/gpt-oss-120b`). Verify model availability, limits and
   pricing before launch. The separate Drop Pilot service does not call Groq
   directly. Set `LYRICBOOK_API_URL` to the Lyric Book API base URL and
   `LYRICBOOK_APP_URL` to the frontend URL there. Set `DROPPILOT_SERVICE_KEY`
   and `DROPPILOT_SHARED_SECRET` to matching values on both services, and set
   a separate private `DROPPILOT_SECRET_KEY` on Drop Pilot. On the Lyric Book
   service, set `DROPPILOT_URL` to the Drop Pilot public URL. Keep all secrets
   stable and private. An unset `LLM_PROVIDER` defaults to Groq in production;
   unsupported providers and Ollama in production are rejected. There is no
   mock fallback.
7. For local testing without calling Groq, set `LLM_PROVIDER=ollama` and run a local model:
   `brew install ollama && ollama pull llama3.2`. No API key, no rate limit,
   no network dependency — quality is a notch below the hosted providers, but
   it's ideal for iterating on prompts/UI. Optional `OLLAMA_MODEL` /
   `OLLAMA_BASE_URL` override the defaults (`llama3.2` / `http://localhost:11434`).
   An unset `LLM_PROVIDER` defaults to Ollama outside production. The old
   `DROPPILOT_STANDARD_PROVIDER` setting no longer selects a separate provider;
   remove it from deployment configuration. AI is unavailable if the configured
   provider or its credentials are unavailable.
8. For memberships, configure Stripe recurring checkout with `STRIPE_SECRET_KEY`
  and a verified `STRIPE_WEBHOOK_SECRET`. For Paystack NGN subscriptions, set
  `PAYSTACK_SECRET_KEY`, create monthly and annual plans in Paystack with
  amounts ₦2,000 and ₦22,000, then set `PAYSTACK_LYRIC_MONTHLY_PLAN_CODE` and
  `PAYSTACK_LYRIC_ANNUAL_PLAN_CODE` in the Lyric Book server environment.
  New accounts get a 30-day app-managed trial without entering a card; checkout
  collects payment only when they subscribe after trial. Existing accounts are
  grandfathered by the migration's `billing_exempt` default.
  Configure Stripe webhooks for Checkout completion, subscription updates, and
  invoice payment failures; the existing `/api/stripe/webhook` endpoint handles
  them. Paystack subscription events use the existing `/api/paystack/webhook`.
9. For natural speech playback on translated AI results, enable the Google Cloud
   Text-to-Speech API and set a dedicated, API-restricted `GOOGLE_TTS_API_KEY`
   in the Lyric Book server environment (local `server/.env` and Railway
  Variables). The key stays server-side. Google WaveNet voices are preferred,
  with Standard as the only Google voice fallback; higher-priced voice families
  are not selected. The browser voice is a fallback if Google TTS is unavailable.
  Text is sent to Google only when the user presses Listen, and requests are
  limited per account.
  10. Country-based payments: new accounts select their country during signup;
    existing accounts without a country are prompted once before using protected
    Lyric Book features. Nigerian accounts use Paystack/NGN for new subscriptions,
    gifts, invoices, and payout setup. Other countries use Stripe and do not see
    Paystack options. Country is stored as an ISO-3166 alpha-2 code and cannot be
    changed in-app after selection. Existing subscriptions and connected payout
    accounts are not migrated automatically. Stripe Connect onboarding remains
    subject to Stripe's country eligibility.
  11. Gifts have a 0% DabzAudio platform fee. Stripe gifts are direct charges on
    the artist's connected account; Paystack gift processing fees are assigned
    to the artist's Nigerian subaccount. The artist's payout can therefore be
  lower than the displayed gift amount due to processor fees. Invoice fees
  are unchanged. Invoices can optionally CC a manager on invoice and status
  emails; this address is visible to the invoice recipient. Run
  `npm run migrate` after deploying to add the field to existing databases.
  Configure `/api/stripe/webhook` to receive connected-account Checkout events
  as well as platform events so direct-charge gifts update.

## API

| Method | Path | Auth | Body |
| --- | --- | --- | --- |
| POST | /api/auth/signup | - | email, password, displayName, artistName, genre, influences, experience |
| POST | /api/auth/login | - | email, password |
| POST | /api/auth/mfa/verify | - | challengeToken, code |
| GET | /api/auth/mfa/status | yes | - |
| POST | /api/auth/mfa/setup | yes | password |
| POST | /api/auth/mfa/enable | yes | code |
| POST | /api/auth/mfa/disable | yes | password, code |
| POST | /api/lyrics/:id/speech | yes | text, language |
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
| PUT | /api/playback/releases/:id | yes | title, description |
| PUT | /api/playback/releases/:id/cover | yes | multipart cover |
| POST | /api/playback/releases/:id/tracks | yes | multipart audio, title |
| PUT | /api/playback/releases/:releaseId/tracks/:trackId/audio | yes | multipart audio |
| PUT | /api/playback/releases/:releaseId/tracks/:trackId | yes | title |
| DELETE | /api/playback/releases/:releaseId/tracks/:trackId | yes | - |
| PUT | /api/playback/releases/:id/tracks/order | yes | trackIds |
| DELETE | /api/playback/releases/:id | yes | - |
| GET | /api/playback/share/:shareToken | - | - |
| POST | /api/playback/tracks/:id/play?token=... | - | - |
| POST | /api/lyrics/:id/assistant | yes | request, action, selectedText |
