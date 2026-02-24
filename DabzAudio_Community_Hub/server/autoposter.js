import { pool } from "./db.js";

// Simple autoposter that can seed forum/blog content with generic, helpful posts.
// Enable by setting AUTPOSTER_ENABLED=true. Configure cadence via AUTPOSTER_INTERVAL_MINUTES
// and minimum spacing via AUTPOSTER_MIN_GAP_MINUTES.

const CATEGORIES = [
  "General",
  "Mixing",
  "Mastering",
  "DAWs",
  "Errors",
  "Plugins",
  "Hardware",
  "Recording",
  "Business"
];

const AUTHOR = "Nicole";

const forumTopics = [
  "crackles on playback after adding a limiter",
  "vocals phasey after parallel comp",
  "muddy low end fighting the kick",
  "CPU spikes from heavy synth stacks",
  "tracking latency with live monitoring",
  "render sounds different than the mix",
  "hi-hats too sharp or brittle",
  "kicks clipping the 2-bus",
  "stereo widening collapsing in mono",
  "DC offset or sub rumble",
  "sidechain pump not audible",
  "reverb tails drowning the vocal",
  "808s disappearing on phones"
];

const daws = [
  "Ableton Live",
  "FL Studio",
  "Logic Pro",
  "Pro Tools",
  "Reaper",
  "Studio One",
  "Bitwig",
  "Cubase",
  "Reason",
  "Cakewalk"
];

const plugins = [
  "FabFilter Pro-Q",
  "Ozone",
  "SSL Bus Comp",
  "CLA-76",
  "Valhalla VintageVerb",
  "Soothe",
  "Decapitator",
  "Pro-L",
  "OTT",
  "Saturn"
];

const blogAngles = [
  "Mix bus checks before release",
  "Headroom habits for streaming platforms",
  "How to prep stems for collaboration",
  "Building a fast vocal chain",
  "Gain staging myths vs reality",
  "Reference tracks that actually help",
  "Low-end translation on earbuds",
  "Fast fixes for harshness",
  "When to use mid-side EQ",
  "Making room for the vocal",
  "Session templates for faster starts",
  "Printing instrument tracks for CPU relief",
  "Quick loudness sanity checks before upload"
];

function choice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function makeForumPost() {
  const topic = choice(forumTopics);
  const daw = choice(daws);
  const plugin = choice(plugins);
  const category = choice(CATEGORIES);
  const title = `Fix: ${topic} in ${daw}`;
  const content = [
    `Running into ${topic} while using ${plugin} in ${daw}? Quick things to try:`,
    "1) Bypass heavy FX and freeze/flatten hungry tracks.",
    "2) High-pass anything that does not need sub content.",
    "3) Add 10-20 ms attack on the compressor to let transients through.",
    "4) Check oversampling on the limiter; sometimes 2x is cleaner than 8x.",
    "5) Print a quick reference and A/B at -14 LUFS to avoid chasing loudness.",
    "Drop your own tweaks if you found a better fix."
  ].join("\n");

  return { type: "forum", category, title, content, author: AUTHOR, image_url: null };
}

function makeBlogPost() {
  const angle = choice(blogAngles);
  const category = "General";
  const title = `${angle}`;
  const content = [
    `${angle} in three moves:`,
    "- Start with a -6 dB headroom target; leave ceiling at -1 dB true peak.",
    "- Sweep for harshness at 2-5 kHz with narrow cuts before any exciters.",
    "- Reference on earbuds and a mono check before you call it done.",
    "Bonus: print a -14 LUFS version for streaming checks and a -10 LUFS for clubs; pick the one that translates best.",
    "Have a better shortcut? Add it in the comments."
  ].join("\n");

  return { type: "blog", category, title, content, author: AUTHOR, image_url: null };
}

function pickPost() {
  // Slightly favor forum posts for utility; blog for broader reads.
  return Math.random() < 0.6 ? makeForumPost() : makeBlogPost();
}

async function hasRecentAutopost(minGapMinutes) {
  const minutes = Number.isFinite(minGapMinutes) ? minGapMinutes : 180;
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count FROM posts WHERE author = $1 AND created_at > NOW() - INTERVAL '${minutes} minutes'`,
    [AUTHOR]
  );
  return Number(rows?.[0]?.count || 0) > 0;
}

async function getDailyCounts() {
  const { rows } = await pool.query(
    `SELECT type, COUNT(*)::int AS count
     FROM posts
     WHERE author = $1 AND created_at > NOW() - INTERVAL '24 hours'
     GROUP BY type`,
    [AUTHOR]
  );
  const counts = { forum: 0, blog: 0 };
  for (const r of rows) {
    if (r.type === "forum" || r.type === "blog") counts[r.type] = r.count;
  }
  counts.total = counts.forum + counts.blog;
  return counts;
}

async function insertPost(post) {
  const q = `
    INSERT INTO posts (type, category, title, content, author, image_url)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, created_at
  `;
  const { rows } = await pool.query(q, [post.type, post.category, post.title, post.content, post.author, post.image_url]);
  return rows[0];
}

async function runAutopost({
  minGapMinutes,
  force = false,
  forumDailyMax = 5,
  blogDailyMax = 5
} = {}) {
  if (!force) {
    const tooRecent = await hasRecentAutopost(minGapMinutes);
    if (tooRecent) return null;
  }

  const counts = await getDailyCounts();
  const remainingForum = Math.max(0, forumDailyMax - counts.forum);
  const remainingBlog = Math.max(0, blogDailyMax - counts.blog);

  if (!force && remainingForum === 0 && remainingBlog === 0) return null;

  let post;
  if (!force) {
    if (remainingForum === 0 && remainingBlog > 0) {
      post = makeBlogPost();
    } else if (remainingBlog === 0 && remainingForum > 0) {
      post = makeForumPost();
    } else {
      // Both have room; pick evenly
      post = Math.random() < 0.5 ? makeForumPost() : makeBlogPost();
    }
  } else {
    // force: keep original bias toward forum
    post = pickPost();
  }

  const saved = await insertPost(post);
  return { id: saved.id, created_at: saved.created_at, ...post };
}

export async function startAutoposter() {
  const intervalMinutes = parseInt(process.env.AUTPOSTER_INTERVAL_MINUTES || "360", 10); // default 6h
  const minGapMinutes = parseInt(process.env.AUTPOSTER_MIN_GAP_MINUTES || "180", 10); // default 3h
  const forumDailyMax = parseInt(process.env.AUTPOSTER_FORUM_DAILY_MAX || "5", 10); // default 5 forum/day
  const blogDailyMax = parseInt(process.env.AUTPOSTER_BLOG_DAILY_MAX || "5", 10); // default 5 blog/day
  const intervalMs = Number.isFinite(intervalMinutes) ? intervalMinutes * 60 * 1000 : 360 * 60 * 1000;

  const run = async () => {
    try {
      const result = await runAutopost({ minGapMinutes, forumDailyMax, blogDailyMax });
      if (!result) {
        console.log("🤖 Autoposter: skipped (recent or daily cap)");
        return;
      }
      console.log(`🤖 Autoposter: posted ${result.type} #${result.id} at ${result.created_at}`);
    } catch (err) {
      console.error("🤖 Autoposter: error while posting", err);
    }
  };

  // Stagger first run to avoid hitting immediately on boot.
  setTimeout(run, 15_000);
  setInterval(run, intervalMs);
  console.log(
    `🤖 Autoposter enabled. Interval ~${intervalMinutes || 360} minutes; min gap ${minGapMinutes || 180} minutes; forum/day ${forumDailyMax}; blog/day ${blogDailyMax}.`
  );
}

// Manual trigger for admin use (force bypasses min-gap checks)
export async function runAutopostNow({ force = false } = {}) {
  const minGapMinutes = parseInt(process.env.AUTPOSTER_MIN_GAP_MINUTES || "180", 10);
  const forumDailyMax = parseInt(process.env.AUTPOSTER_FORUM_DAILY_MAX || "5", 10);
  const blogDailyMax = parseInt(process.env.AUTPOSTER_BLOG_DAILY_MAX || "5", 10);
  return runAutopost({ minGapMinutes, forumDailyMax, blogDailyMax, force });
}
