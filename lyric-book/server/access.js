/**
 * access.js
 * Shared lyric access-control helpers used by both the REST API (server.js) and
 * the real-time collaboration server (collab.js), so the same row-level security
 * rule is enforced everywhere: access to a lyric = owner OR an accepted
 * collaborator for THAT lyric only.
 */
import { pool } from "./db.js";

// Resolve a user's access to a lyric.
// Returns { role: 'owner'|'editor'|'viewer', canEdit, ownerId } or null if no access.
export async function getLyricAccess(lyricId, userId) {
  const { rows } = await pool.query(
    `SELECT l.user_id AS owner_id,
            c.role AS collab_role,
            c.status AS collab_status
       FROM lb_lyrics l
       LEFT JOIN lb_lyric_collaborators c
         ON c.lyric_id = l.id AND c.user_id = $2
      WHERE l.id = $1`,
    [lyricId, userId]
  );
  const row = rows[0];
  if (!row) return null; // lyric does not exist
  if (String(row.owner_id) === String(userId)) {
    return { role: "owner", canEdit: true, ownerId: row.owner_id };
  }
  if (row.collab_status === "accepted") {
    const role = row.collab_role === "viewer" ? "viewer" : "editor";
    return { role, canEdit: role === "editor", ownerId: row.owner_id };
  }
  return null; // no access (or invite still pending)
}

// Friendly display name for presence labels / invite emails.
export async function displayNameForUser(userId, fallbackEmail) {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(p.artist_name,''), NULLIF(p.display_name,''), u.email) AS name,
              p.avatar_url
         FROM lb_users u LEFT JOIN lb_profiles p ON p.user_id = u.id
        WHERE u.id = $1`,
      [userId]
    );
    return {
      name: (rows[0] && rows[0].name) || fallbackEmail || "A DabzAudio artist",
      avatarUrl: (rows[0] && rows[0].avatar_url) || ""
    };
  } catch {
    return { name: fallbackEmail || "A DabzAudio artist", avatarUrl: "" };
  }
}
