/* =====================================================================
   DabzAudio — "Ask Dabz" assistant
   A self-contained, zero-backend product guide. It injects its own DOM
   and answers questions about what DabzAudio is and how to use each tool
   by matching the visitor's message against a small intent knowledge base.
   ===================================================================== */
(function () {
  "use strict";

  // ---- Knowledge base -------------------------------------------------
  // Each intent has keywords (matched against the message) and an answer.
  // Answers may contain a small, safe subset of HTML (links, <strong>, lists).
  var KB = [
    {
      id: "what",
      keywords: ["about", "dabzaudio", "dabz audio", "who are you", "what do you do", "explain", "overview", "product"],
      answer:
        "<strong>DabzAudio</strong> is a suite of next-gen, browser-based tools for musicians, producers and DJs — no downloads needed. You get:" +
        "<ul>" +
        "<li><strong>Key &amp; BPM Analysis</strong> — find the key and tempo of any track</li>" +
        "<li><strong>Reverb &amp; Delay Calculator</strong> — tempo-synced FX times</li>" +
        "<li><strong>Lyric Book</strong> — write, store &amp; co-write lyrics with rhyme/rhythm help and AI Smart search</li>" +
        "<li><strong>Playback</strong> — share unreleased tracks privately for feedback</li>" +
        "<li><strong>Transfer a file</strong> — send big files, folders and stems to other creatives</li>" +
        "<li><strong>Drop Pilot</strong> (Pro) — a 21-day release campaign planner with pitches and a press kit</li>" +
        "<li><strong>Invoices</strong> &amp; <strong>Split Sheets</strong> — get paid and agree credits</li>" +
        "<li><strong>Gift an artist</strong> — send money to any artist by @username via Stripe</li>" +
        "<li><strong>Community Hub</strong> &amp; <strong>Studio Creative Assets</strong></li>" +
        "</ul>Which one would you like to know more about?"
    },
    {
      id: "start",
      keywords: ["get started", "getting started", "how do i start", "begin", "sign up", "signup", "register", "create account", "how to use", "first"],
      answer:
        "Getting started is easy:" +
        "<ul>" +
        "<li>Pick a tool from the homepage tiles (Key &amp; BPM, Reverb/Delay, Lyric Book).</li>" +
        "<li>For the <strong>Lyric Book</strong>, create an artist account (it starts with a free trial) to save your work.</li>" +
        "<li>Everything runs in your browser — nothing to install.</li>" +
        "</ul>Want the direct link to any tool?"
    },
    {
      id: "keybpm",
      keywords: ["key", "bpm", "tempo", "pitch", "analyze", "analysis", "detect", "scale"],
      answer:
        "The <strong>Key &amp; BPM Analysis</strong> tool detects the musical key and tempo of any audio file. " +
        "Just upload a track and it returns the key/scale and BPM so you can match samples, build harmonies and beat-match. " +
        "<a href='/key-bpm-tool/index.html'>Open Key &amp; BPM Analysis →</a>"
    },
    {
      id: "reverb",
      keywords: ["reverb", "delay", "echo", "fx", "effect", "pre-delay", "predelay", "ms", "millisecond", "sync"],
      answer:
        "The <strong>Reverb &amp; Delay Calculator</strong> gives you tempo-synced effect times. " +
        "Enter your song's BPM and it returns delay/reverb times in milliseconds for each note value (1/4, 1/8, dotted, triplet…), so your FX lock perfectly to the groove. " +
        "<a href='/reverb-delay-calculator/index.html'>Open Reverb &amp; Delay →</a>"
    },
    {
      id: "lyric",
      keywords: ["lyric", "lyrics", "write", "writing", "song", "songwriting", "rhyme", "rhythm", "syllable", "notebook", "book"],
      answer:
        "The <strong>Lyric Book</strong> is your songwriting home:" +
        "<ul>" +
        "<li>Write &amp; auto-save lyrics to your free account</li>" +
        "<li>Real <strong>rhyme suggestions</strong> and <strong>syllable/rhythm</strong> counts per line</li>" +
        "<li><strong>Share &amp; co-write</strong> — invite others to collaborate in real time (Google-Docs style)</li>" +
        "<li>Add a profile picture and manage your artist profile</li>" +
        "</ul><a href='/lyric-book/index.html'>Open Lyric Book →</a>"
    },
    {
      id: "collab",
      keywords: ["collaborate", "collaboration", "share", "sharing", "invite", "co-write", "cowrite", "together", "real time", "realtime", "team"],
      answer:
        "In the <strong>Lyric Book</strong> you can share a single lyric with another artist by email and set them as <em>viewer</em> or <em>editor</em>. " +
        "Editors can type <strong>live, at the same time as you</strong>, with presence avatars showing who's online. " +
        "You only ever share the one lyric you choose — your other lyrics stay private — and you can stop sharing anytime."
    },
    {
      id: "gift",
      keywords: ["gift", "gifting", "tip", "tipping", "donate", "donation", "send money", "pay artist", "support artist", "payout", "payouts", "wallet", "withdraw", "stripe", "username", "@", "handle", "receive money", "get paid"],
      answer:
        "<strong>Gift an artist</strong> lets you send money straight to another DabzAudio artist — securely through Stripe:" +
        "<ul>" +
        "<li><strong>Find them by @username.</strong> Every artist has one unique handle across the whole platform (e.g. <em>@dabzflp</em>), so you always gift the right person — no mix-ups or duplicates.</li>" +
        "<li><strong>Send the gift.</strong> In the Lyric Book tap <em>Gift an artist</em>, search their @username, choose an amount and add a message, then pay securely via Stripe Checkout (card/Apple&nbsp;Pay/Google&nbsp;Pay). No account details are shared.</li>" +
        "<li><strong>They get paid.</strong> The artist sees the gift land in their in-app <em>wallet</em>, then withdraws to their bank on demand once they've completed a quick one-time Stripe payout setup.</li>" +
        "<li><strong>Set your own handle.</strong> Open <em>Gifts &amp; payouts</em> → <em>Your gift handle</em> to claim your @username so fans can gift you.</li>" +
        "</ul>The gift popup shows exactly what the artist receives and DabzAudio's small platform fee before you pay. Open the <a href='/lyric-book/index.html'>Lyric Book</a> to try it."
    },
    {
      id: "transfer",
      keywords: ["transfer", "send file", "send files", "send a file", "large file", "big file", "stems", "zip", "folder", "wetransfer", "share file", "download link", "10gb"],
      answer:
        "<strong>Transfer a file</strong> (inside the Lyric Book) lets you send work to other creatives:" +
        "<ul>" +
        "<li>Send <strong>any file type</strong> — single files, <strong>zips, stems and whole folders</strong>, up to <strong>10&nbsp;GB</strong> per transfer.</li>" +
        "<li>Enter the recipient's <strong>email</strong> and we send them the download link, or <strong>copy the link</strong> and share it yourself.</li>" +
        "<li>Transfers <strong>expire automatically after 7 days</strong> and are then deleted. You can also delete one early to switch its link off.</li>" +
        "</ul><a href='/lyric-book/index.html'>Open the Lyric Book →</a>"
    },
    {
      id: "droppilot",
      keywords: ["drop pilot", "droppilot", "lyric book pro", "campaign", "release plan", "rollout", "epk", "press kit", "pitch", "pitches", "ai credits", "top up", "8.99", "promo plan"],
      answer:
        "<strong>Drop Pilot</strong> is part of <strong>Lyric Book Pro</strong>. It turns one release into a <strong>21-day content plan</strong>, with pitch drafts for playlists and press, a content calendar and a shareable press kit (EPK)." +
        "<ul>" +
        "<li><strong>Pro</strong> is <strong>£8.99/month</strong> or <strong>£98.89/year in GBP</strong> and includes a monthly pool of <strong>AI credits</strong>. Other currencies use the GBP equivalent shown at checkout.</li>" +
        "<li>Need more? You can buy <strong>credit packs</strong> that never expire.</li>" +
        "<li>It plans your rollout only. It <strong>doesn't analyse your audio or distribute your music</strong>, and it can't promise results.</li>" +
        "<li>If Pro ends, your campaigns stay viewable (read-only) and Lyric Book carries on as a normal plan.</li>" +
        "</ul><a href='/lyric-book/subscription.html'>See the Pro plan →</a>"
    },
    {
      id: "playback",
      keywords: ["playback", "unreleased", "private link", "listen", "release", "track eq", "eq", "cover art", "demo", "preview track", "feedback on track"],
      answer:
        "<strong>Playback</strong> lets you share unreleased music privately. Create a release, add tracks and cover art, then send a private listening link. " +
        "Listeners can play the tracks and shape their own listen with a simple <strong>low / mid / high track EQ</strong>, without needing an account. " +
        "<a href='/lyric-book/index.html'>Open the Lyric Book →</a>"
    },
    {
      id: "invoice",
      keywords: ["invoice", "invoices", "bill", "billing a client", "get paid", "client payment", "honored", "awaiting"],
      answer:
        "<strong>Invoices</strong> let you bill anyone by email — they don't need a DabzAudio account. " +
        "Invoices move through <em>Drafts, Sent, Awaiting</em> and <em>Honored</em> so you can see what's been paid. " +
        "<a href='/lyric-book/index.html'>Open the Lyric Book →</a>"
    },
    {
      id: "split",
      keywords: ["split sheet", "splits", "contract", "credits", "royalty", "royalties", "ownership", "agreement", "publishing"],
      answer:
        "The <strong>Split Sheet / Contract</strong> tool helps you and your collaborators agree who owns what on a song and record it clearly. " +
        "It opens in the same tab from the Lyric Book. This is a helpful record, not legal advice — for important deals, speak to a qualified professional."
    },
    {
      id: "ai",
      keywords: ["ai", "smart search", "search", "assistant", "artificial intelligence", "suggest", "suggestions", "find a lyric", "idea"],
      answer:
        "<strong>Smart search</strong> in the Lyric Book uses AI to help you find lyrics and ideas by meaning, not just exact words — " +
        "and you also get rhyme suggestions and syllable counts as you write. Only the text you search with is sent to the AI provider; see our <a href='/privacy.html'>Privacy &amp; Cookie Policy</a>."
    },
    {
      id: "theme",
      keywords: ["dark mode", "light mode", "theme", "dark", "light", "appearance", "colour", "color"],
      answer:
        "Every DabzAudio page supports <strong>dark and light mode</strong>. Use the theme toggle in the header — your choice is remembered on this device."
    },
    {
      id: "privacy",
      keywords: ["privacy", "cookie", "cookies", "data", "gdpr", "consent", "ads", "advertising", "adsense", "delete my data", "safe", "secure", "security"],
      answer:
        "Essential cookies (sign-in, theme, your cookie choice) are always on. Advertising cookies only load if you choose <strong>Accept all</strong> — " +
        "<strong>Reject non-essential</strong> keeps them off, and you can change your mind any time via <em>Cookie settings</em> in the footer. " +
        "Full details: <a href='/privacy.html'>Privacy &amp; Cookie Policy</a>."
    },
    {
      id: "hub",
      keywords: ["community", "hub", "forum", "connect", "network", "other artists", "social"],
      answer:
        "The <strong>Community Hub</strong> is where DabzAudio artists connect: a <strong>forum</strong> to ask production questions (mixing, mastering, DAWs, plugins…) and a <strong>blog</strong> with tips and updates. " +
        "<a href='https://dabzflp.com/community-hub' target='_blank' rel='noopener'>Visit the Community Hub →</a>"
    },
    {
      id: "assets",
      keywords: ["asset", "assets", "beat", "beats", "sample", "samples", "beatstars", "download", "creative", "studio"],
      answer:
        "<strong>Studio Creative Assets</strong> are beats and production resources available on our BeatStars store. " +
        "<a href='https://www.beatstars.com/dabzflp' target='_blank' rel='noopener'>Browse assets on BeatStars →</a>"
    },
    {
      id: "price",
      keywords: ["price", "pricing", "cost", "free", "pay", "subscription", "how much", "money", "trial"],
      answer:
        "<strong>Key &amp; BPM</strong> and the <strong>Reverb &amp; Delay Calculator</strong> are free to use in your browser. " +
        "The <strong>Lyric Book</strong> starts with a <strong>free trial</strong> when you create an account; after that you choose a plan from the <em>Subscription</em> page, where you can also cancel renewal any time and keep access until the paid period ends. " +
        "Studio assets on BeatStars may be paid."
    },
    {
      id: "account",
      keywords: ["password", "reset", "forgot", "login", "log in", "account", "profile", "picture", "avatar", "email"],
      answer:
        "For your <strong>Lyric Book</strong> account: use <em>Forgot password</em> on the login page to get a secure reset email. " +
        "You can also set a profile picture by clicking your initials/photo badge in the header after signing in."
    },
    {
      id: "contact",
      keywords: ["contact", "support", "help", "feedback", "email us", "reach", "phone", "get in touch"],
      answer:
        "Happy to help! You can reach the team via the <a href='/#contact'>Feedback form</a> on this page, or email " +
        "<strong>dabzaudio@dabzflp.com</strong>. What are you trying to do?"
    },
    {
      id: "thanks",
      keywords: ["thank", "thanks", "cheers", "appreciate", "great", "awesome", "cool"],
      answer: "Anytime! 🎧 Ask me anything else about DabzAudio's tools whenever you like."
    },
    {
      id: "hi",
      keywords: ["hi", "hey", "hello", "yo", "sup", "good morning", "good evening", "howdy"],
      answer: "Hey! I'm Dabz, your product guide. Ask me what DabzAudio is, or how to use any tool — Key &amp; BPM, Reverb/Delay, Lyric Book, Playback or Transfer a file."
    }
  ];

  var GREETING =
    "Hi, I'm <strong>Dabz</strong> 👋 your DabzAudio guide. I can explain what the product is and how to use each tool. What would you like to know?";

  var CHIPS = [
    { label: "What is DabzAudio?", q: "What is DabzAudio?" },
    { label: "How do I get started?", q: "How do I get started?" },
    { label: "Key & BPM tool", q: "Tell me about the Key and BPM tool" },
    { label: "Lyric Book", q: "What is the Lyric Book?" },
    { label: "Transfer a file", q: "How does Transfer a file work?" },
    { label: "Playback", q: "What is Playback?" },
    { label: "Collaborate on lyrics", q: "How does collaboration work?" },
    { label: "Pricing", q: "How much does it cost?" },
    { label: "Privacy & cookies", q: "How do cookies and privacy work?" }
  ];

  var FALLBACK =
    "I'm not fully sure about that one. I can tell you about <strong>DabzAudio</strong> and how to use the " +
    "<strong>Key &amp; BPM</strong> tool, <strong>Reverb &amp; Delay</strong> calculator, and the <strong>Lyric Book</strong> " +
    "(writing, rhymes, collaboration, Playback, Transfer a file, invoices, split sheets). Try asking about one of those, or use the <a href='/#contact'>Feedback form</a> to reach a human.";

  // ---- Matching -------------------------------------------------------
  function findAnswer(raw) {
    var text = " " + raw.toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ") + " ";
    var best = null, bestScore = 0;
    for (var i = 0; i < KB.length; i++) {
      var score = 0;
      for (var k = 0; k < KB[i].keywords.length; k++) {
        var kw = KB[i].keywords[k];
        var whole = text.indexOf(" " + kw + " ") !== -1;
        if (whole || (kw.length > 3 && text.indexOf(kw) !== -1)) {
          // longer keywords are more specific -> weight higher
          score += kw.indexOf(" ") !== -1 ? 3 : (kw.length > 4 ? 2 : 1);
        }
      }
      if (score > bestScore) { bestScore = score; best = KB[i]; }
    }
    return best && bestScore > 0 ? best.answer : FALLBACK;
  }

  // ---- Icons ----------------------------------------------------------
  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.4 8.5 8.5 0 0 1-3.6-.8L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.5-8.4 8.38 8.38 0 0 1 8.5 8.2z"/></svg>';
  var ICON_SPARK = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.3L19 9l-5.2 1.7L12 16l-1.8-5.3L5 9l5.2-1.7z"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>';
  var ICON_X = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  // ---- Build DOM ------------------------------------------------------
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function init() {
    var root = el("div", "dz-agent");
    root.setAttribute("data-open", "false");
    root.setAttribute("aria-live", "polite");

    // Launcher
    var launcher = el("button", "dz-agent-launcher", ICON_CHAT);
    launcher.setAttribute("aria-label", "Ask Dabz — product assistant");
    var tip = el("div", "dz-agent-tip", "Ask Dabz 👋");

    // Panel
    var panel = el("div", "dz-agent-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Ask Dabz assistant");

    var head = el("div", "dz-agent-head",
      '<div class="dz-orb">' + ICON_SPARK + '</div>' +
      '<div><h4>Ask Dabz</h4><p><span class="dz-status"></span>Product guide · always here</p></div>');
    var closeBtn = el("button", "dz-agent-close", ICON_X);
    closeBtn.setAttribute("aria-label", "Close assistant");
    head.appendChild(closeBtn);

    var body = el("div", "dz-agent-body");
    var chips = el("div", "dz-agent-chips");
    var foot = el("form", "dz-agent-foot");
    var input = el("input");
    input.type = "text";
    input.placeholder = "Ask about DabzAudio…";
    input.setAttribute("aria-label", "Type your question");
    var send = el("button", "dz-agent-send", ICON_SEND);
    send.type = "submit";
    send.setAttribute("aria-label", "Send");
    foot.appendChild(input);
    foot.appendChild(send);

    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(chips);
    panel.appendChild(foot);

    root.appendChild(panel);
    root.appendChild(launcher);
    root.appendChild(tip);
    document.body.appendChild(root);

    // ---- Behaviour ----
    var greeted = false;

    function scrollDown() { body.scrollTop = body.scrollHeight; }

    function addMsg(html, who) {
      var m = el("div", "dz-msg " + who, html);
      body.appendChild(m);
      scrollDown();
      return m;
    }

    function botReply(html) {
      var typing = el("div", "dz-msg bot", '<div class="dz-typing"><span></span><span></span><span></span></div>');
      body.appendChild(typing);
      scrollDown();
      var delay = 450 + Math.min(900, html.length * 4);
      setTimeout(function () {
        typing.innerHTML = html;
        scrollDown();
      }, delay);
    }

    function renderChips() {
      chips.innerHTML = "";
      CHIPS.forEach(function (c) {
        var chip = el("button", "dz-chip", c.label);
        chip.type = "button";
        chip.addEventListener("click", function () { ask(c.q); });
        chips.appendChild(chip);
      });
    }

    function ask(q) {
      var text = (q != null ? q : input.value).trim();
      if (!text) return;
      addMsg(text.replace(/</g, "&lt;"), "user");
      input.value = "";
      botReply(findAnswer(text));
    }

    function open() {
      root.setAttribute("data-open", "true");
      launcher.innerHTML = ICON_X;
      if (!greeted) {
        greeted = true;
        botReply(GREETING);
        renderChips();
      }
      setTimeout(function () { input.focus(); }, 350);
    }
    function close() {
      root.setAttribute("data-open", "false");
      launcher.innerHTML = ICON_CHAT;
    }
    function toggle() {
      root.getAttribute("data-open") === "true" ? close() : open();
    }

    launcher.addEventListener("click", toggle);
    closeBtn.addEventListener("click", close);
    foot.addEventListener("submit", function (e) { e.preventDefault(); ask(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && root.getAttribute("data-open") === "true") close();
    });

    // Gentle nudge: flash the tip a few seconds after load (once per session)
    if (!sessionStorage.getItem("dz_agent_seen")) {
      setTimeout(function () {
        if (root.getAttribute("data-open") === "false") {
          root.setAttribute("data-tip", "true");
          setTimeout(function () { root.removeAttribute("data-tip"); }, 4200);
        }
        sessionStorage.setItem("dz_agent_seen", "1");
      }, 3500);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
