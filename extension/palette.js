// src/search.js
var normalize = (value) => String(value ?? "").normalize("NFKD").replace(new RegExp("\\p{M}", "gu"), "").toLowerCase();
var words = (value) => normalize(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function displayURL(value) {
  try {
    const u = new URL(value);
    return (u.host || u.protocol.replace(":", "")) + (u.pathname === "/" ? "" : decodeURI(u.pathname));
  } catch {
    return value || "";
  }
}
function subsequence(query, text) {
  if (query.length < 3) return 0;
  let previous = -1, first = -1, gaps = 0;
  for (const char of query) {
    const i = text.indexOf(char, previous + 1);
    if (i < 0) return 0;
    if (first < 0) first = i;
    else gaps += i - previous - 1;
    previous = i;
  }
  if (gaps > query.length * 2 || previous - first > query.length * 3) return 0;
  return Math.max(8, 35 - gaps * 2 - first * 0.2);
}
function tokenScore(token, field) {
  if (field === token) return 120;
  if (field.startsWith(token)) return 100;
  const index = field.indexOf(token);
  if (index >= 0) return /[^\p{L}\p{N}]/u.test(field[index - 1]) ? 85 : 60;
  const initials = words(field).map((w) => w[0]).join("");
  if (token.length >= 2 && initials.includes(token)) return 72;
  return Math.max(0, ...words(field).map((word) => subsequence(token, word)));
}
function rankTabs(tabs2, query, { sourceId, windowId, now = Date.now() } = {}) {
  const q = normalize(query).trim();
  if (!q)
    return tabs2.filter((tab) => tab.id !== sourceId).slice().sort(
      (a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0) || a.id - b.id
    );
  const tokens = q.split(/\s+/).filter(Boolean);
  return tabs2.map((tab) => {
    const title = normalize(tab.title), url = normalize(displayURL(tab.url));
    let hostname = "";
    try {
      hostname = normalize(new URL(tab.url).hostname.replace(/^www\./, ""));
    } catch {
    }
    let relevance = 0, strongMatch = true;
    for (const token of tokens) {
      const score2 = Math.max(
        tokenScore(token, title),
        tokenScore(token, url) * 0.95
      );
      if (!score2) return null;
      relevance += score2;
      const titleStrong = tokenScore(token, title) >= (token.length < 3 ? 100 : 85);
      const hostStrong = token.length >= 3 && tokenScore(token, hostname) >= 95;
      strongMatch &&= titleStrong || hostStrong;
    }
    if (q && title === q) relevance += 160;
    if (q && url === q) relevance += 150;
    const age = Math.max(0, now - (tab.lastAccessed || 0));
    const recent = 10 / (1 + age / 36e5);
    const score = relevance + recent + (tab.windowId === windowId ? 2 : 0) + (tab.pinned ? 1 : 0) - (tab.id === sourceId ? 5 : 0);
    strongMatch ||= title === q || url === q;
    return { ...tab, score, strongMatch };
  }).filter(Boolean).sort(
    (a, b) => Number(b.strongMatch) - Number(a.strongMatch) || b.score - a.score || a.id - b.id
  );
}
function destination(raw) {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("?"))
    return { kind: "search", query: value.slice(1).trim() };
  if (/^(https?:\/\/)/i.test(value)) {
    try {
      const url = new URL(value);
      if (!url.username && !url.password) return { kind: "url", url: url.href };
    } catch {
    }
  }
  if (!/\s/.test(value) && /^(localhost(?=[:/]|$)|\[[\da-f:]+\]|(?:[\p{L}\p{N}-]+\.)+[\p{L}\p{N}-]+)(?::\d+)?(?:[/?#].*)?$/iu.test(
    value
  )) {
    try {
      return {
        kind: "url",
        url: new URL(
          (/^(localhost|127\.|\[::1\])/.test(value) ? "http://" : "https://") + value
        ).href
      };
    } catch {
    }
  }
  return { kind: "search", query: value };
}
function makeResults(tabs2, query, context2) {
  const dest = destination(query);
  const matches = query.trim().startsWith("?") ? [] : rankTabs(tabs2, query, context2).slice(0, 8).map((tab) => ({ kind: "tab", tab, key: `tab:${tab.id}` }));
  if (dest && (dest.kind !== "search" || dest.query)) {
    const firstWeak = matches.findIndex((result) => !result.tab.strongMatch);
    const actions = [{ ...dest, key: "destination" }];
    if (dest.kind === "search")
      actions.push({ kind: "chatgpt", query: dest.query, key: "chatgpt" });
    matches.splice(firstWeak < 0 ? matches.length : firstWeak, 0, ...actions);
  }
  return matches;
}

// src/palette.js
var overlay = new URL(location.href).searchParams.has("overlay");
document.body.classList.toggle("overlay", overlay);
var densityQuery;
function updateHairline() {
  densityQuery?.removeEventListener("change", updateHairline);
  const ratio = window.devicePixelRatio || 1;
  document.documentElement.style.setProperty("--hairline", `${1 / ratio}px`);
  densityQuery = matchMedia(`(resolution: ${ratio}dppx)`);
  densityQuery.addEventListener("change", updateHairline);
}
updateHairline();
if (overlay) {
  const panel = document.querySelector("#panel");
  const syncGlass = () => {
    const { x, y, width, height } = panel.getBoundingClientRect();
    parent.postMessage({ type: "tablight:panel", x, y, width, height }, "*");
  };
  new ResizeObserver(syncGlass).observe(panel);
  window.addEventListener("resize", syncGlass);
  syncGlass();
}
var input = document.querySelector("#query");
var list = document.querySelector("#results");
var status = document.querySelector("#status");
var tabs = [];
var context = {};
var results = [];
var selected = 0;
var ready = false;
var busy = false;
var pendingEnter = null;
var refreshTimer;
async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response.result;
}
function close() {
  if (overlay) parent.postMessage("tablight:close", "*");
  else window.close();
}
var svg = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>';
function highlighted(node, text, query) {
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  let i = 0;
  const normalized = normalize(text);
  if (normalized.length !== text.length) {
    node.textContent = text;
    return;
  }
  while (i < text.length) {
    const term = terms.find((t) => normalized.startsWith(t, i));
    if (term) {
      const mark = document.createElement("mark");
      mark.textContent = text.slice(i, i + term.length);
      node.append(mark);
      i += term.length;
    } else {
      let end = i + 1;
      while (end < text.length && !terms.some((t) => normalized.startsWith(t, end)))
        end++;
      node.append(document.createTextNode(text.slice(i, end)));
      i = end;
    }
  }
}
function render({ preserve = false } = {}) {
  const oldKey = preserve ? results[selected]?.key : null;
  results = makeResults(tabs, input.value, context);
  selected = oldKey ? Math.max(
    0,
    results.findIndex((r) => r.key === oldKey)
  ) : 0;
  list.replaceChildren();
  if (!ready) {
    status.textContent = "Loading your tabs\u2026";
    return;
  }
  status.textContent = results.length ? "" : "No other tabs yet. Type a URL or search the web.";
  for (const [index, result] of results.entries()) {
    const row = document.createElement("div");
    row.className = "result" + (result.kind !== "tab" ? " destination" : "");
    row.id = `result-${index}`;
    row.role = "option";
    row.dataset.key = result.key;
    row.setAttribute("aria-selected", String(index === selected));
    const icon = document.createElement("div");
    icon.className = "icon";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("div");
    text.className = "text";
    const title = document.createElement("div");
    title.className = "title";
    const badge = document.createElement("div");
    badge.className = "badge";
    if (result.kind === "tab") {
      const t = result.tab;
      icon.textContent = (new URL(t.url || "about:blank").hostname.replace(/^www\./, "")[0] || t.title[0] || "\xB7").toUpperCase();
      const image = document.createElement("img");
      image.alt = "";
      image.width = 18;
      image.height = 18;
      const favicon = new URL(chrome.runtime.getURL("/_favicon/"));
      favicon.searchParams.set("pageUrl", t.url);
      favicon.searchParams.set("size", "32");
      image.onload = () => icon.replaceChildren(image);
      image.src = favicon.href;
      highlighted(title, t.title, input.value);
      row.title = displayURL(t.url) + (t.windowId !== context.windowId ? " \xB7 Other window" : "") + (t.pinned ? " \xB7 Pinned" : "") + (t.audible ? " \xB7 Playing audio" : "");
      badge.textContent = t.id === context.sourceId ? "Current tab" : "Switch to Tab";
    } else {
      icon.innerHTML = svg;
      title.textContent = result.kind === "url" ? result.url : result.kind === "chatgpt" ? `Ask ChatGPT: \u201C${result.query}\u201D` : `Search the web: \u201C${result.query}\u201D`;
      row.title = result.kind === "url" ? "Open in a new tab" : result.kind === "chatgpt" ? "Send to ChatGPT in a new tab" : "Your default search engine";
      badge.textContent = result.kind === "url" ? "Open URL" : result.kind === "chatgpt" ? "Ask ChatGPT" : "Search";
    }
    const enter = document.createElement("span");
    enter.className = "enter";
    enter.textContent = "\u2192";
    badge.append(enter);
    text.append(title);
    row.append(icon, text, badge);
    row.addEventListener("pointermove", (event) => {
      if (event.movementX || event.movementY) select(index, false);
    });
    row.addEventListener("mousedown", (e) => e.preventDefault());
    row.addEventListener("click", () => {
      selected = index;
      activate(false);
    });
    list.append(row);
  }
  select(selected, false);
}
function select(index, scroll = true) {
  selected = Math.max(0, Math.min(index, results.length - 1));
  for (const [i, row2] of [...list.children].entries())
    row2.setAttribute("aria-selected", String(i === selected));
  const row = list.children[selected];
  if (row) {
    input.setAttribute("aria-activedescendant", row.id);
    if (scroll) row.scrollIntoView({ block: "nearest" });
  } else input.removeAttribute("aria-activedescendant");
}
async function activate(forceNew) {
  if (busy) return;
  if (!ready) {
    pendingEnter = { query: input.value, forceNew };
    return;
  }
  const result = results[selected];
  if (!forceNew && !result) return;
  busy = true;
  try {
    const response = await request(
      forceNew ? { type: "navigate", query: input.value } : result.kind === "tab" ? { type: "switch", id: result.tab.id } : result.kind === "chatgpt" ? { type: "chatgpt", query: result.query } : { type: "navigate", query: input.value }
    );
    if (response?.ok) close();
  } catch (error) {
    await refresh(false);
    status.textContent = error.message;
  } finally {
    busy = false;
  }
}
async function refresh(initial = false) {
  try {
    const data = await request({ type: "snapshot" });
    tabs = data.tabs;
    context = data.context;
    ready = true;
    render({ preserve: !initial });
    if (pendingEnter) {
      const pending = pendingEnter;
      pendingEnter = null;
      if (pending.query === input.value) await activate(pending.forceNew);
    }
  } catch (error) {
    ready = false;
    status.textContent = error.message;
  }
}
input.addEventListener("input", () => {
  pendingEnter = null;
  render();
});
input.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  const command = event.metaKey || event.ctrlKey;
  if (event.key === "ArrowDown" || event.ctrlKey && event.key === "n") {
    event.preventDefault();
    select((selected + 1) % Math.max(results.length, 1));
  } else if (event.key === "ArrowUp" || event.ctrlKey && event.key === "p") {
    event.preventDefault();
    select((selected - 1 + results.length) % Math.max(results.length, 1));
  } else if (event.key === "Enter") {
    event.preventDefault();
    activate(command || event.shiftKey);
  } else if (command && event.key.toLowerCase() === "t") {
    event.preventDefault();
    input.select();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
  if (event.key === "Tab") {
    event.preventDefault();
    input.focus();
  }
});
document.body.addEventListener("mousedown", (event) => {
  if (overlay && event.target === document.body) close();
});
var schedule = () => {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh(false), 60);
};
chrome.tabs.onRemoved.addListener(schedule);
chrome.tabs.onUpdated.addListener(schedule);
chrome.tabs.onCreated.addListener(schedule);
function focusInput() {
  input.focus({ preventScroll: true });
}
window.addEventListener("focus", () => {
  if (document.activeElement === document.body) focusInput();
});
focusInput();
requestAnimationFrame(focusInput);
render();
refresh(true);
