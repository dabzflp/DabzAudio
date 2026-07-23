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

-- When the handle was last changed, to rate-limit renames (once / 30 days).
ALTER TABLE lb_profiles ADD COLUMN IF NOT EXISTS username_updated_at TIMESTAMPTZ;

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

-- Invoicing. A Lyric Book user (from_user_id) bills anyone by email — the
-- recipient does NOT need a DabzAudio account. The recipient can "honor" the
-- invoice by paying online (funds route to the sender's connected account minus
-- the DabzAudio platform fee), by uploading proof of an offline payment, or the
-- sender can manually mark it honored. Tax is the sender's own liability; we
-- compute and display it (none / VAT-exclusive / VAT-inclusive) but DabzAudio is
-- a tool, not the merchant of record.
CREATE TABLE IF NOT EXISTS lb_invoices (
  id BIGSERIAL PRIMARY KEY,
  from_user_id BIGINT NOT NULL REFERENCES lb_users(id) ON DELETE CASCADE,
  to_user_id BIGINT REFERENCES lb_users(id) ON DELETE SET NULL,  -- set if the payer has an account
  to_email TEXT NOT NULL,
  to_name TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'gbp',
  note TEXT NOT NULL DEFAULT '',
  tax_mode TEXT NOT NULL DEFAULT 'none',      -- 'none' | 'exclusive' | 'inclusive'
  tax_rate_bps INTEGER NOT NULL DEFAULT 0,    -- e.g. 2000 = 20%
  tax_label TEXT NOT NULL DEFAULT 'VAT',
  subtotal_cents BIGINT NOT NULL DEFAULT 0,   -- sum of line items (goods/services)
  tax_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL DEFAULT 0,      -- amount the payer owes
  fee_cents BIGINT NOT NULL DEFAULT 0,        -- DabzAudio platform fee if paid online
  status TEXT NOT NULL DEFAULT 'draft',       -- draft|sent|viewed|awaiting_confirmation|honored|cancelled
  honored_method TEXT,                        -- 'online' | 'manual' | 'proof'
  honored_seen BOOLEAN NOT NULL DEFAULT FALSE,-- sender has seen the "honored" notification
  public_token TEXT,                          -- unguessable token for the public pay/honor link
  due_date DATE,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  honored_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lb_invoices_from ON lb_invoices(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lb_invoices_to_email ON lb_invoices(LOWER(to_email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_invoices_token
  ON lb_invoices(public_token) WHERE public_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS lb_invoice_items (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES lb_invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_cents BIGINT NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lb_invoice_items_invoice ON lb_invoice_items(invoice_id, position);

-- Proof-of-payment uploads for an invoice (e.g. a bank-transfer receipt image).
CREATE TABLE IF NOT EXISTS lb_invoice_proofs (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES lb_invoices(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  uploaded_by_email TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lb_invoice_proofs_invoice ON lb_invoice_proofs(invoice_id, created_at DESC);

-- =============================== Paystack (Naira) ============================
-- Second payment rail for African (NGN) users, chosen by currency: NGN routes
-- to Paystack, GBP/USD/EUR stay on Stripe. Like Stripe Connect, Paystack is the
-- regulated fund-holder — an artist links their Nigerian bank via a Paystack
-- *subaccount* and Paystack settles their share straight to that bank. DabzAudio
-- never holds the money; the platform fee is the subaccount's percentage_charge.
CREATE TABLE IF NOT EXISTS lb_paystack_accounts (
  user_id BIGINT PRIMARY KEY REFERENCES lb_users(id) ON DELETE CASCADE,
  subaccount_code TEXT NOT NULL,
  business_name TEXT NOT NULL DEFAULT '',
  bank_code TEXT NOT NULL DEFAULT '',
  bank_name TEXT NOT NULL DEFAULT '',
  account_number TEXT NOT NULL DEFAULT '',
  account_name TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'ngn',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_paystack_subaccount
  ON lb_paystack_accounts(subaccount_code);

-- Which rail each gift/invoice used, plus the Paystack transaction reference so
-- the webhook can reconcile a NGN payment back to its row.
ALTER TABLE lb_gifts ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE lb_gifts ADD COLUMN IF NOT EXISTS paystack_reference TEXT;
CREATE INDEX IF NOT EXISTS idx_lb_gifts_paystack_ref ON lb_gifts(paystack_reference) WHERE paystack_reference IS NOT NULL;

ALTER TABLE lb_invoices ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE lb_invoices ADD COLUMN IF NOT EXISTS paystack_reference TEXT;
CREATE INDEX IF NOT EXISTS idx_lb_invoices_paystack_ref ON lb_invoices(paystack_reference) WHERE paystack_reference IS NOT NULL;
