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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
