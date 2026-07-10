/**
 * username.js — generate and validate unique @usernames for artists.
 *
 * Usernames are the public handle used to find someone in the gift picker.
 * They are stored on lb_profiles.username and kept globally unique via a
 * case-insensitive unique index; this module guarantees uniqueness when
 * generating (sign-up / backfill) or when a user renames their handle.
 */

// Allowed handle: 3–20 chars, lowercase letters, digits and underscores.
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

// Turn any free text (artist name, email, …) into a valid handle root.
export function slugifyUsername(base) {
  let s = String(base || "").toLowerCase().trim();
  s = s.replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (s.length < 3) s = (s + "artist").replace(/_+/g, "_");
  return s.slice(0, 20);
}

// Validate a user-chosen handle. Returns null if ok, else an error message.
export function validateUsername(name) {
  const s = String(name || "").trim().toLowerCase();
  if (!s) return "Enter a username.";
  if (!USERNAME_RE.test(s)) {
    return "Usernames are 3–20 characters: lowercase letters, numbers and underscores only.";
  }
  return null;
}

// Return a unique handle for `base`, appending numbers on collision.
// `db` is any object with a .query() method (pool or a client).
export async function ensureUniqueUsername(db, base, excludeUserId = null) {
  const root = slugifyUsername(base) || "artist";
  let candidate = root;
  for (let n = 0; n < 10000; n++) {
    const { rows } = await db.query(
      `SELECT 1 FROM lb_profiles
        WHERE LOWER(username) = LOWER($1)
          AND ($2::bigint IS NULL OR user_id <> $2)
        LIMIT 1`,
      [candidate, excludeUserId]
    );
    if (!rows.length) return candidate;
    const suffix = String(n + 2); // start at 2: name, name2, name3, …
    candidate = root.slice(0, 20 - suffix.length) + suffix;
  }
  // Fallback — practically unreachable.
  return root.slice(0, 12) + Date.now().toString().slice(-8);
}
