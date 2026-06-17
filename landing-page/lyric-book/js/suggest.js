// Songwriting suggestions: real rhymes via the free Datamuse dictionary API
// (https://www.datamuse.com/api/) plus a local syllable estimator for rhythm.
// No API key, no AI text generation — these are dictionary-grounded helpers.
(function () {
  const DATAMUSE = "https://api.datamuse.com/words";

  async function fetchRhymes(word) {
    const w = encodeURIComponent(String(word).trim().toLowerCase());
    if (!w) return { rhymes: [], near: [] };
    const [rhymes, near] = await Promise.all([
      get(`${DATAMUSE}?rel_rhy=${w}&md=s&max=24`),
      get(`${DATAMUSE}?rel_nry=${w}&md=s&max=24`)
    ]);
    return { rhymes: clean(rhymes), near: clean(near) };
  }

  async function get(url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  function clean(list) {
    return (list || [])
      .filter((it) => it.word && !it.word.includes(" "))
      .map((it) => ({
        word: it.word,
        syllables: it.numSyllables || estimateSyllables(it.word)
      }));
  }

  // Heuristic syllable counter (good enough for live per-line rhythm feedback).
  function estimateSyllables(word) {
    word = String(word).toLowerCase().replace(/[^a-z]/g, "");
    if (!word) return 0;
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
    word = word.replace(/^y/, "");
    const groups = word.match(/[aeiouy]{1,2}/g);
    return groups ? Math.max(1, groups.length) : 1;
  }

  function countLineSyllables(line) {
    const words = line.trim().split(/\s+/).filter(Boolean);
    return words.reduce((sum, w) => sum + estimateSyllables(w), 0);
  }

  function lastWord(text) {
    const m = String(text).trim().match(/([A-Za-z']+)[^A-Za-z']*$/);
    return m ? m[1] : "";
  }

  window.LBSuggest = { fetchRhymes, estimateSyllables, countLineSyllables, lastWord };
})();
