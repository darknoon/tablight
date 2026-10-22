// No I/O. Every candidate is an already-open tab, supplied by the browser.
export const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
const words = (value) =>
  normalize(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
export function displayURL(value) {
  try {
    const u = new URL(value);
    return (
      (u.host || u.protocol.replace(":", "")) +
      (u.pathname === "/" ? "" : decodeURI(u.pathname))
    );
  } catch {
    return value || "";
  }
}
function subsequence(query, text) {
  if (query.length < 3) return 0;
  let previous = -1,
    first = -1,
    gaps = 0;
  for (const char of query) {
    const i = text.indexOf(char, previous + 1);
    if (i < 0) return 0;
    if (first < 0) first = i;
    else gaps += i - previous - 1;
    previous = i;
  }
  // Sparse accidental matches shouldn't displace the web-search fallback.
  if (gaps > query.length * 2 || previous - first > query.length * 3) return 0;
  return Math.max(8, 35 - gaps * 2 - first * 0.2);
}
function tokenScore(token, field) {
  if (field === token) return 120;
  if (field.startsWith(token)) return 100;
  const index = field.indexOf(token);
  if (index >= 0) return /[^\p{L}\p{N}]/u.test(field[index - 1]) ? 85 : 60;
  const initials = words(field)
    .map((w) => w[0])
    .join("");
  if (token.length >= 2 && initials.includes(token)) return 72;
  return Math.max(0, ...words(field).map((word) => subsequence(token, word)));
}
export function rankTabs(
  tabs,
  query,
  { sourceId, windowId, now = Date.now() } = {},
) {
  const q = normalize(query).trim();
  if (!q)
    return tabs
      .filter((tab) => tab.id !== sourceId)
      .slice()
      .sort(
        (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.id - b.id,
      );
  const tokens = q.split(/\s+/).filter(Boolean);
  return tabs
    .map((tab) => {
      const title = normalize(tab.title),
        url = normalize(displayURL(tab.url));
      let hostname = "";
      try {
        hostname = normalize(new URL(tab.url).hostname.replace(/^www\./, ""));
      } catch {}
      let relevance = 0,
        strongMatch = true;
      for (const token of tokens) {
        const score = Math.max(
          tokenScore(token, title),
          tokenScore(token, url) * 0.95,
        );
        if (!score) return null;
        relevance += score;
        // Short queries need a leading match; incidental words and fuzzy initials
        // remain available below search. URL paths alone are weaker evidence.
        const titleStrong =
          tokenScore(token, title) >= (token.length < 3 ? 100 : 85);
        const hostStrong =
          token.length >= 3 && tokenScore(token, hostname) >= 95;
        strongMatch &&= titleStrong || hostStrong;
      }
      if (q && title === q) relevance += 160;
      if (q && url === q) relevance += 150;
      const age = Math.max(0, now - (tab.lastAccessed || 0));
      const recent = 10 / (1 + age / 3_600_000);
      const score =
        relevance +
        recent +
        (tab.windowId === windowId ? 2 : 0) +
        (tab.pinned ? 1 : 0) -
        (tab.id === sourceId ? 5 : 0);
      strongMatch ||= title === q || url === q;
      return { ...tab, score, strongMatch };
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        Number(b.strongMatch) - Number(a.strongMatch) ||
        b.score - a.score ||
        a.id - b.id,
    );
}
export function destination(raw) {
  const value = raw.trim();
  if (!value) return null;
  // A leading ? explicitly requests search, regardless of tab matches.
  if (value.startsWith("?"))
    return { kind: "search", query: value.slice(1).trim() };
  if (/^(https?:\/\/)/i.test(value)) {
    try {
      const url = new URL(value);
      if (!url.username && !url.password) return { kind: "url", url: url.href };
    } catch {}
  }
  if (
    !/\s/.test(value) &&
    /^(localhost(?=[:/]|$)|\[[\da-f:]+\]|(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+)(?::\d+)?(?:[/?#].*)?$/iu.test(
      value,
    )
  ) {
    try {
      return {
        kind: "url",
        url: new URL(
          (/^(localhost|127\.|\[::1\])/.test(value) ? "http://" : "https://") +
            value,
        ).href,
      };
    } catch {}
  }
  return { kind: "search", query: value };
}
export function makeResults(tabs, query, context) {
  const dest = destination(query);
  const matches = query.trim().startsWith("?")
    ? []
    : rankTabs(tabs, query, context)
        .slice(0, 8)
        .map((tab) => ({ kind: "tab", tab, key: `tab:${tab.id}` }));
  if (dest && (dest.kind !== "search" || dest.query)) {
    const firstWeak = matches.findIndex((result) => !result.tab.strongMatch);
    const actions = [{ ...dest, key: "destination" }];
    if (dest.kind === "search")
      actions.push({ kind: "chatgpt", query: dest.query, key: "chatgpt" });
    matches.splice(firstWeak < 0 ? matches.length : firstWeak, 0, ...actions);
  }
  return matches;
}

// Keep browser-owned pages (including Dia chat and placeholder WebUIs) out of
// suggestions; external sites with similar titles remain ordinary tabs.
export function isSwitchableTab(tab) {
  try {
    return ["http:", "https:", "file:"].includes(new URL(tab.url).protocol);
  } catch {
    return false;
  }
}
export function chatGPTURL(query) {
  return "https://chatgpt.com/?q=" + encodeURIComponent(query.trim());
}
