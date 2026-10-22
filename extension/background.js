// src/overlay.js
function mountOverlay(url) {
  if (globalThis.__tablightClose) {
    globalThis.__tablightClose();
    return false;
  }
  const previous = document.activeElement;
  const host = document.createElement("div");
  host.setAttribute("popover", "manual");
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;z-index:2147483647!important;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = ":host::backdrop{background:transparent} iframe{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal}";
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = "Tablight \u2014 search your tabs";
  root.append(style, frame);
  const close = () => {
    window.removeEventListener("message", message);
    host.remove();
    delete globalThis.__tablightClose;
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  const message = (event) => {
    if (event.source === frame.contentWindow && event.origin === new URL(url).origin && event.data === "tablight:close")
      close();
  };
  globalThis.__tablightClose = close;
  window.addEventListener("message", message);
  document.documentElement.append(host);
  try {
    host.showPopover();
  } catch {
  }
  frame.focus();
  return true;
}

// src/search.js
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
function isSwitchableTab(tab) {
  try {
    return ["http:", "https:", "file:"].includes(new URL(tab.url).protocol);
  } catch {
    return false;
  }
}
function chatGPTURL(query) {
  return "https://chatgpt.com/?q=" + encodeURIComponent(query.trim());
}

// src/background.js
var own = chrome.runtime.getURL("");
var sessionKey = "paletteSessions";
var opening = false;
async function openPalette(tab) {
  if (opening) return;
  opening = true;
  try {
    tab ||= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!tab?.id) return;
    const token = crypto.randomUUID();
    const sessions = (await chrome.storage.session.get(sessionKey))[sessionKey] || {};
    const now = Date.now();
    for (const [key, value] of Object.entries(sessions))
      if (now - value.created > 864e5 || value.tabId === tab.id)
        delete sessions[key];
    sessions[token] = {
      tabId: tab.id,
      windowId: tab.windowId,
      incognito: tab.incognito,
      created: now
    };
    await chrome.storage.session.set({ [sessionKey]: sessions });
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: mountOverlay,
        args: [`${own}palette.html?overlay=${token}`]
      });
    } catch {
      const source = await chrome.windows.get(tab.windowId);
      const width = Math.min(680, source.width || 680), height = Math.min(490, source.height || 490);
      const popup = await chrome.windows.create({
        type: "popup",
        url: "about:blank",
        focused: true,
        incognito: tab.incognito,
        width,
        height,
        left: Math.max(
          0,
          Math.round(
            (source.left || 0) + ((source.width || width) - width) / 2
          )
        ),
        top: Math.max(
          0,
          Math.round(
            (source.top || 0) + ((source.height || height) - height) / 2
          )
        )
      });
      const paletteTab = popup.tabs?.[0] || (await chrome.tabs.query({ windowId: popup.id }))[0];
      try {
        if (!paletteTab?.id) throw new Error("Could not create the tab picker");
        sessions[token].paletteTabId = paletteTab.id;
        await chrome.storage.session.set({ [sessionKey]: sessions });
        await chrome.tabs.update(paletteTab.id, {
          url: `${own}palette.html?window=${token}`
        });
      } catch (error) {
        await chrome.windows.remove(popup.id);
        throw error;
      }
    }
  } finally {
    opening = false;
  }
}
chrome.action.onClicked.addListener(
  (tab) => openPalette(tab).catch(
    (error) => console.error("Tablight could not open:", error.message)
  )
);
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove("diagnostics");
  chrome.action.setPopup({ popup: "" });
});
async function contextFor(sender) {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(`${own}palette.html`))
    throw new Error("Unrecognized palette");
  if (sender.tab) {
    const params = new URL(sender.url).searchParams;
    const standalone = params.has("window");
    const token = params.get(standalone ? "window" : "overlay");
    const sessions = (await chrome.storage.session.get(sessionKey))[sessionKey] || {};
    const session = sessions[token];
    if (!session || (standalone ? session.paletteTabId : session.tabId) !== sender.tab.id || Date.now() - session.created > 864e5)
      throw new Error("This palette has expired. Reopen Tablight.");
    return {
      sourceId: session.tabId,
      windowId: session.windowId,
      incognito: session.incognito ?? sender.tab.incognito
    };
  }
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  if (!tab) throw new Error("No active browser window");
  return { sourceId: tab.id, windowId: tab.windowId, incognito: tab.incognito };
}
async function handle(message, sender) {
  const context = await contextFor(sender);
  if (message.type === "snapshot") {
    const tabs = (await chrome.tabs.query({})).filter((t) => t.incognito === context.incognito && isSwitchableTab(t)).map((t) => ({
      id: t.id,
      windowId: t.windowId,
      title: t.title || t.url || "Untitled",
      url: t.url || "",
      lastAccessed: t.lastAccessed,
      pinned: t.pinned,
      audible: t.audible,
      discarded: t.discarded,
      active: t.active
    }));
    return { tabs, context };
  }
  if (message.type === "switch") {
    if (!Number.isInteger(message.id)) throw new Error("Invalid tab");
    let tab;
    try {
      tab = await chrome.tabs.get(message.id);
    } catch {
      throw new Error("That tab was closed. Choose another result.");
    }
    if (!isSwitchableTab(tab))
      throw new Error("This browser-owned tab cannot be selected.");
    if (tab.incognito !== context.incognito)
      throw new Error("That tab is in a different browsing mode");
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true };
  }
  if (message.type === "chatgpt") {
    if (typeof message.query !== "string" || message.query.length > 8192 || !message.query.trim())
      throw new Error("Invalid query");
    await chrome.tabs.create({
      windowId: context.windowId,
      active: true,
      url: chatGPTURL(message.query)
    });
    return { ok: true };
  }
  if (message.type === "navigate") {
    if (typeof message.query !== "string" || message.query.length > 8192)
      throw new Error("Invalid query");
    const target = destination(message.query);
    if (!target || target.kind === "search" && !target.query)
      return { ok: false };
    const created = await chrome.tabs.create({
      windowId: context.windowId,
      active: true,
      ...target.kind === "url" ? { url: target.url } : {}
    });
    if (target.kind === "search")
      await chrome.search.query({ text: target.query, tabId: created.id });
    return { ok: true };
  }
  throw new Error("Unknown action");
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(
    (result) => respond({ result }),
    (error) => respond({ error: error.message })
  );
  return true;
});
export {
  openPalette
};
