-- DabzAudio Lyric Book schema (PostgreSQL)
-- Run with: npm run migrate   (or psql <DATABASE_URL> -f sql/schema.sql)
-- Tables are namespaced with the lb_ prefix so they never collide with the
-- Community Hub tables when sharing the same Postgres instance.

CREATE TABLE IF NOT EXISTS lb_users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One profile row per user (artist details captured at sign-up).
CREATE TABLE IF NOT EXISTS lb_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES lb_users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  artist_name TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  influences TEXT NOT NULL DEFAULT '',
  experience TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add avatar_url for profiles created before this column existed.
ALTER TABLE lb_profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';

-- Public @username handle (used to find artists in the gift picker). Globally
-- unique, case-insensitive. Backfilled for existing rows by migrate.js.
ALTER TABLE lb_profiles ADD COLUMN IF NOT EXISTS username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_profiles_username
  ON lb_profiles(LOWER(username)) WHERE username IS NOT NULL AND username <> '';

CREATE TABLE IF NOT EXISTS lb_lyrics (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES lb_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Password reset tokens (hashed). Single-use, short-lived.
CREATE TABLE IF NOT EXISTS lb_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES lb_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lb_lyrics_user_updated ON lb_lyrics(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lb_reset_tokens_user ON lb_reset_tokens(user_id);

-- Collaborators on a lyric (sharing). One row per invited email per lyric.
-- Handles both registered users (user_id set) and people who have no account
-- yet (user_id stays NULL until they sign up with the invited email).
-- Access to a lyric = owner OR a row here with status='accepted'.
CREATE TABLE IF NOT EXISTS lb_lyric_collaborators (
  id BIGSERIAL PRIMARY KEY,
  lyric_id BIGINT NOT NULL REFERENCES lb_lyrics(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES lb_users(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',      -- 'viewer' | 'editor'
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'accepted'
  token_hash TEXT,                          -- hashed accept-link token (cleared on accept)
  expires_at TIMESTAMPTZ,
  invited_by BIGINT REFERENCES lb_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);

-- One invite per (lyric, email), case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_collab_lyric_email
  ON lb_lyric_collaborators(lyric_id, LOWER(invited_email));
CREATE INDEX IF NOT EXISTS idx_lb_collab_user ON lb_lyric_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_lb_collab_email ON lb_lyric_collaborators(LOWER(invited_email));
CREATE INDEX IF NOT EXISTS idx_lb_collab_lyric ON lb_lyric_collaborators(lyric_id);

-- Real-time editing (Layer 2): the binary Yjs (CRDT) document state for a lyric.
-- This is the authoritative state for live collaboration. The plaintext mirror
-- in lb_lyrics.title/body is kept in sync on every debounced save so the REST
-- API, sidebar list, and rhyme/rhythm tools keep working unchanged.
CREATE TABLE IF NOT EXISTS lb_lyric_docs (
  lyric_id BIGINT PRIMARY KEY REFERENCES lb_lyrics(id) ON DELETE CASCADE,
  state BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Gift Me (Stripe Connect). Additive — the Community Hub and existing Lyric Book
-- flow are untouched. One connected Stripe Express account per user who wants to
-- RECEIVE gifts; Stripe handles KYC + bank payouts, so DabzAudio never holds funds.
CREATE TABLE IF NOT EXISTS lb_stripe_accounts (
  user_id BIGINT PRIMARY KEY REFERENCES lb_users(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL,
  charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  details_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_stripe_account_id
  ON lb_stripe_accounts(stripe_account_id);

-- A gift from one artist to another (typically a collaborator on a lyric).
-- amount_cents is the gross charged to the sender; fee_cents is the optional
-- DabzAudio platform fee; the remainder is transferred to the recipient's
-- connected account and paid out to their bank by Stripe.
CREATE TABLE IF NOT EXISTS lb_gifts (
  id BIGSERIAL PRIMARY KEY,
  from_user_id BIGINT REFERENCES lb_users(id) ON DELETE SET NULL,
  to_user_id BIGINT NOT NULL REFERENCES lb_users(id) ON DELETE CASCADE,
  lyric_id BIGINT REFERENCES lb_lyrics(id) ON DELETE SET NULL,
  amount_cents BIGINT NOT NULL,
  fee_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'paid' | 'failed'
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lb_gifts_to ON lb_gifts(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lb_gifts_from ON lb_gifts(from_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_gifts_checkout
  ON lb_gifts(stripe_checkout_session_id) WHERE stripe_checkout_session_id IS NOT NULL;
