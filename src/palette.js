import { makeResults, displayURL, normalize } from "./search.js";
const overlay = new URL(location.href).searchParams.has("overlay");
document.body.classList.toggle("overlay", overlay);
// Keep a hairline at one device pixel through zoom and monitor changes.
let densityQuery;
function updateHairline() {
  densityQuery?.removeEventListener("change", updateHairline);
  const ratio = window.devicePixelRatio || 1;
  document.documentElement.style.setProperty("--hairline", `${1 / ratio}px`);
  densityQuery = matchMedia(`(resolution: ${ratio}dppx)`);
  densityQuery.addEventListener("change", updateHairline);
}
updateHairline();
if (overlay) {
  window.addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.type !== "tablight:viewport")
      return;
    const height = event.data.height;
    if (Number.isFinite(height) && height > 0)
      document.documentElement.style.setProperty(
        "--available-height",
        height + "px",
      );
  });
  const panel = document.querySelector("#panel");
  const syncGlass = () => {
    const { x, y, width, height } = panel.getBoundingClientRect();
    parent.postMessage({ type: "tablight:panel", x, y, width, height }, "*");
  };
  new ResizeObserver(syncGlass).observe(panel);
  window.addEventListener("resize", syncGlass);
  syncGlass();
}

const input = document.querySelector("#query"),
  list = document.querySelector("#results"),
  status = document.querySelector("#status");
let tabs = [],
  context = {},
  results = [],
  selected = 0,
  ready = false,
  busy = false,
  pendingEnter = null,
  refreshTimer;
async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response.result;
}
function close() {
  if (overlay) parent.postMessage("tablight:close", "*");
  else window.close();
}
const svg =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg>';
function highlighted(node, text, query) {
  // textContent only; browser titles and URLs are untrusted input.
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  let i = 0;
  const normalized = normalize(text);
  // Diacritics can change lengths; avoid offset errors rather than misrendering.
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
      while (
        end < text.length &&
        !terms.some((t) => normalized.startsWith(t, end))
      )
        end++;
      node.append(document.createTextNode(text.slice(i, end)));
      i = end;
    }
  }
}
function render({ preserve = false } = {}) {
  const oldKey = preserve ? results[selected]?.key : null;
  results = makeResults(tabs, input.value, context);
  selected = oldKey
    ? Math.max(
        0,
        results.findIndex((r) => r.key === oldKey),
      )
    : 0;
  list.replaceChildren();
  if (!ready) {
    status.textContent = "Loading your tabs…";
    return;
  }
  status.textContent = results.length
    ? ""
    : "No other tabs yet. Type a URL or search the web.";
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
      icon.textContent = (
        new URL(t.url || "about:blank").hostname.replace(/^www\./, "")[0] ||
        t.title[0] ||
        "·"
      ).toUpperCase();
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
      row.title =
        displayURL(t.url) +
        (t.windowId !== context.windowId ? " · Other window" : "") +
        (t.pinned ? " · Pinned" : "") +
        (t.audible ? " · Playing audio" : "");
      badge.textContent =
        t.id === context.sourceId ? "Current tab" : "Switch to Tab";
    } else {
      icon.innerHTML = svg;
      title.textContent =
        result.kind === "url"
          ? result.url
          : result.kind === "chatgpt"
            ? `Ask ChatGPT: “${result.query}”`
            : `Search the web: “${result.query}”`;
      row.title =
        result.kind === "url"
          ? "Open in a new tab"
          : result.kind === "chatgpt"
            ? "Send to ChatGPT in a new tab"
            : "Your default search engine";
      badge.textContent =
        result.kind === "url"
          ? "Open URL"
          : result.kind === "chatgpt"
            ? "Ask ChatGPT"
            : "Search";
    }
    const enter = document.createElement("span");
    enter.className = "enter";
    enter.textContent = "→";
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
  for (const [i, row] of [...list.children].entries())
    row.setAttribute("aria-selected", String(i === selected));
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
      forceNew
        ? { type: "navigate", query: input.value }
        : result.kind === "tab"
          ? { type: "switch", id: result.tab.id }
          : result.kind === "chatgpt"
            ? { type: "chatgpt", query: result.query }
            : { type: "navigate", query: input.value },
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
  if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
    event.preventDefault();
    select((selected + 1) % Math.max(results.length, 1));
  } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
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
const schedule = () => {
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
