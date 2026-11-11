/**
 * ai.js
 * Real-auth wrapper around ai-workflow.js for the Lyric Book "AI Assistant".
 *
 * Security model (this is the part the LLM must never be trusted with):
 *  - requireAuth confirms who the caller is.
 *  - getLyricAccess confirms the caller may see THIS lyric (owner or an
 *    accepted collaborator) before any of its text is sent to the model.
 *  - The client can never choose the provider — that is fixed by the server's
 *    LLM_PROVIDER env var, so a compromised/curious client can't force paid
 *    API usage the operator didn't configure.
 *  - Only a short audit row (who/what/when) is stored, never the request text
 *    or the model's reply, since the lyric itself already lives in lb_lyrics.
 */
import { pool } from "./db.js";
import { requireAuth } from "./auth.js";
import { getLyricAccess } from "./access.js";
import { rateLimit } from "./rate-limit.js";
import { runLyricAssistant, runHelpAssistant, runLyricSearch, isSupportedAction } from "./ai-workflow.js";
import { getAIProvider } from "./ai-provider.js";

const MAX_REQUEST_CHARS = 2000;
const MAX_CONTEXT_CHARS = 4000;
const MAX_SPEECH_BYTES = 4500;
const SPEECH_LANGUAGES = new Set([
  "es-ES", "fr-FR", "pt-PT", "de-DE", "yo-NG", "ja-JP", "en-US",
  "ar-SA", "it-IT", "zh-CN", "ko-KR", "hi-IN", "ru-RU", "nl-NL",
  "tr-TR", "ha-NG", "ig-NG", "sw-KE", "bn-BD", "pl-PL", "vi-VN"
]);
const ttsVoiceCache = new Map();
const speechRequests = new Map();

function limitSpeechByUser(req, res, next) {
  const now = Date.now();
  for (const [userId, bucket] of speechRequests) {
    if (bucket.resetAt <= now) speechRequests.delete(userId);
  }
  const userId = String(req.user.id);
  const bucket = speechRequests.get(userId);
  if (!bucket || bucket.resetAt <= now) {
    speechRequests.set(userId, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return next();
  }
  if (bucket.count >= 20) {
    return res.status(429).json({ error: "Speech limit reached. Please wait a few minutes and try again." });
  }
  bucket.count += 1;
  next();
}

async function googleTtsVoice(language) {
  const cached = ttsVoiceCache.get(language);
  if (cached && cached.expiresAt > Date.now()) return cached.voice;

  const key = process.env.GOOGLE_TTS_API_KEY;
  const url = new URL("https://texttospeech.googleapis.com/v1/voices");
  url.searchParams.set("languageCode", language);
  url.searchParams.set("key", key);
  const response = await fetch(url);
  if (!response.ok) throw Object.assign(new Error("Could not load speech voices."), { status: response.status });
  const data = await response.json();
  const voices = (data.voices || []).filter((voice) => voice.languageCodes?.includes(language));
  const tiers = ["Wavenet", "Standard"];
  const voice = tiers.map((tier) => voices.find((item) => item.name.toLowerCase().includes(tier.toLowerCase()))).find(Boolean);
  if (!voice) return null;
  ttsVoiceCache.set(language, { voice, expiresAt: Date.now() + 60 * 60 * 1000 });
  return voice;
}

export function registerAIRoutes(app) {
  app.post(
    "/api/lyrics/:id/assistant",
    requireAuth,
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
    async (req, res) => {
      const { request, action = "ask", selectedText = "" } = req.body || {};

      if (!request || typeof request !== "string" || request.length > MAX_REQUEST_CHARS) {
        return res.status(400).json({
          error: `Request is required and must be under ${MAX_REQUEST_CHARS} characters.`
        });
      }
      if (!isSupportedAction(action)) {
        return res.status(400).json({ error: "Unsupported assistant action." });
      }
      if (typeof selectedText !== "string" || selectedText.length > MAX_CONTEXT_CHARS) {
        return res.status(400).json({ error: "Selected text is too long." });
      }

      try {
        // The application decides access BEFORE any lyric text reaches the model.
        const access = await getLyricAccess(req.params.id, req.user.id);
        if (!access) {
          return res.status(403).json({ error: "You do not have access to this lyric." });
        }

        const { rows } = await pool.query(
          "SELECT title, body FROM lb_lyrics WHERE id = $1",
          [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: "Lyric not found." });
        const lyric = rows[0];

        const songContext = {
          title: lyric.title || "Untitled",
          selectedLyrics: (selectedText || lyric.body || "").slice(0, MAX_CONTEXT_CHARS)
        };

        // Provider is server-controlled, never client-supplied.
        const provider = getAIProvider();
        const result = await runLyricAssistant({
          userRequest: request,
          action,
          songContext,
          provider
        });

        pool
          .query(
            `INSERT INTO lb_ai_requests (user_id, lyric_id, action, provider)
             VALUES ($1, $2, $3, $4)`,
            [req.user.id, req.params.id, action, provider]
          )
          .catch((err) => console.error("AI request audit log failed:", err.message));

        res.json(result);
      } catch (err) {
        console.error("AI workflow error:", err);
        // Never expose provider errors, API keys or internal stack traces —
        // but a quota/overload hit is common enough to explain plainly.
        if (err.status === 429 || /quota|rate.?limit/i.test(err.message || "")) {
          return res.status(429).json({
            error: "The AI assistant has hit its usage limit for now. Please try again in a minute."
          });
        }
        if (err.status === 503 || /overloaded|high demand|unavailable/i.test(err.message || "")) {
          return res.status(503).json({
            error: "The AI provider is temporarily busy. Please try again shortly."
          });
        }
        res.status(500).json({ error: "The AI assistant could not complete this request." });
      }
    }
  );

  app.post(
    "/api/lyrics/:id/speech",
    requireAuth,
    limitSpeechByUser,
    async (req, res) => {
      const { text, language } = req.body || {};
      if (!process.env.GOOGLE_TTS_API_KEY) {
        return res.status(503).json({ error: "Natural speech is not configured yet." });
      }
      if (typeof text !== "string" || !text.trim() || Buffer.byteLength(text, "utf8") > MAX_SPEECH_BYTES) {
        return res.status(400).json({ error: "Text must be non-empty and no longer than 4,500 UTF-8 bytes." });
      }
      if (typeof language !== "string" || !SPEECH_LANGUAGES.has(language)) {
        return res.status(400).json({ error: "Choose a supported speech language." });
      }

      try {
        const access = await getLyricAccess(req.params.id, req.user.id);
        if (!access) return res.status(403).json({ error: "You do not have access to this lyric." });

        const voice = await googleTtsVoice(language);
        if (!voice) return res.status(422).json({ error: "No Google speech voice is available for this language." });

        const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + encodeURIComponent(process.env.GOOGLE_TTS_API_KEY), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { text: text.trim() },
            voice: { languageCode: language, name: voice.name },
            audioConfig: { audioEncoding: "MP3", speakingRate: 0.96 }
          })
        });
        if (!response.ok) {
          const status = response.status === 429 ? 429 : 503;
          return res.status(status).json({ error: status === 429 ? "Speech is busy right now. Try again shortly." : "Could not generate natural speech." });
        }
        const result = await response.json();
        if (!result.audioContent) return res.status(502).json({ error: "The speech service returned no audio." });
        res.json({ audioContent: result.audioContent, contentType: "audio/mpeg" });
      } catch (err) {
        console.error("Speech synthesis error:", err.message);
        res.status(503).json({ error: "Natural speech is temporarily unavailable." });
      }
    }
  );

  // Onboarding/help assistant — answers "how do I..." questions about the
  // product itself. Never touches lyric or other user data.
  app.post(
    "/api/help-assistant",
    requireAuth,
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
    async (req, res) => {
      const { question } = req.body || {};
      if (!question || typeof question !== "string" || question.length > MAX_REQUEST_CHARS) {
        return res.status(400).json({
          error: `Question is required and must be under ${MAX_REQUEST_CHARS} characters.`
        });
      }
      try {
        const provider = getAIProvider();
        const result = await runHelpAssistant({ question, provider });
        res.json(result);
      } catch (err) {
        console.error("Help assistant error:", err);
        if (err.status === 429 || /quota|rate.?limit/i.test(err.message || "")) {
          return res.status(429).json({ error: "The help assistant has hit its usage limit for now. Please try again in a minute." });
        }
        if (err.status === 503 || /overloaded|high demand|unavailable/i.test(err.message || "")) {
          return res.status(503).json({ error: "The AI provider is temporarily busy. Please try again shortly." });
        }
        res.status(500).json({ error: "The help assistant could not complete this request." });
      }
    }
  );

  // Semantic-ish lyric search: ranks the caller's OWN owned/collaborated
  // lyrics by meaning. No pgvector/embeddings — the app only ever sends
  // lyrics this user is already authorized to see.
  app.post(
    "/api/lyrics/search",
    requireAuth,
    rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }),
    async (req, res) => {
      const { query } = req.body || {};
      if (!query || typeof query !== "string" || query.length > 500) {
        return res.status(400).json({ error: "A search query (under 500 characters) is required." });
      }
      try {
        const { rows } = await pool.query(
          `SELECT l.id, l.title, LEFT(l.body, 220) AS excerpt
             FROM lb_lyrics l
            WHERE l.user_id = $1
            UNION ALL
           SELECT l.id, l.title, LEFT(l.body, 220) AS excerpt
             FROM lb_lyrics l
             JOIN lb_lyric_collaborators c ON c.lyric_id = l.id
            WHERE c.user_id = $1 AND c.status = 'accepted'`,
          [req.user.id]
        );
        const lyrics = rows.map((r) => ({ id: String(r.id), title: r.title, excerpt: r.excerpt }));
        const provider = getAIProvider();
        const result = await runLyricSearch({ query, lyrics, provider });
        const validIds = new Set(lyrics.map((l) => l.id));
        res.json({ matches: (result.matches || []).filter((m) => validIds.has(m.id)) });
      } catch (err) {
        console.error("Lyric search error:", err);
        if (err.status === 429 || /quota|rate.?limit/i.test(err.message || "")) {
          return res.status(429).json({ error: "Search has hit its usage limit for now. Please try again in a minute." });
        }
        if (err.status === 503 || /overloaded|high demand|unavailable/i.test(err.message || "")) {
          return res.status(503).json({ error: "The AI provider is temporarily busy. Please try again shortly." });
        }
        res.status(500).json({ error: "Could not search your lyrics right now." });
      }
    }
  );
}
