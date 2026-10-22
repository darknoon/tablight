import { mountOverlay } from "./overlay.js";
import { destination, isSwitchableTab, chatGPTURL } from "./search.js";
const own = chrome.runtime.getURL("");
const sessionKey = "paletteSessions";
// Both the toolbar and _execute_action shortcut arrive through onClicked,
// preserving the browser's activeTab grant (custom commands failed in Dia).
let opening = false;
export async function openPalette(tab) {
  if (opening) return;
  opening = true;
  try {
    tab ||= (
      await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    )[0];
    if (!tab?.id) return;
    const token = crypto.randomUUID();
    const sessions =
      (await chrome.storage.session.get(sessionKey))[sessionKey] || {};
    const now = Date.now();
    for (const [key, value] of Object.entries(sessions))
      if (now - value.created > 86_400_000 || value.tabId === tab.id)
        delete sessions[key];
    sessions[token] = {
      tabId: tab.id,
      windowId: tab.windowId,
      incognito: tab.incognito,
      created: now,
    };
    await chrome.storage.session.set({ [sessionKey]: sessions });
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: mountOverlay,
        args: [`${own}palette.html?overlay=${token}`],
      });
    } catch {
      // Browser-owned pages cannot host an overlay. Dia also rejects openPopup(),
      // so use a real, centered extension window and bind it to its source tab.
      const source = await chrome.windows.get(tab.windowId);
      const width = Math.min(680, source.width || 680),
        height = Math.min(490, source.height || 490);
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
            (source.left || 0) + ((source.width || width) - width) / 2,
          ),
        ),
        top: Math.max(
          0,
          Math.round(
            (source.top || 0) + ((source.height || height) - height) / 2,
          ),
        ),
      });
      const paletteTab =
        popup.tabs?.[0] || (await chrome.tabs.query({ windowId: popup.id }))[0];
      try {
        if (!paletteTab?.id) throw new Error("Could not create the tab picker");
        sessions[token].paletteTabId = paletteTab.id;
        await chrome.storage.session.set({ [sessionKey]: sessions });
        await chrome.tabs.update(paletteTab.id, {
          url: `${own}palette.html?window=${token}`,
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
chrome.action.onClicked.addListener((tab) =>
  openPalette(tab).catch((error) =>
    console.error("Tablight could not open:", error.message),
  ),
);
// Remove the temporary 0.1.4 debugging log and any persisted popup override.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.storage.local.remove("diagnostics");
  chrome.action.setPopup({ popup: "" });
  if (reason === "install") chrome.runtime.openOptionsPage();
});
async function contextFor(sender) {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(`${own}palette.html`)
  )
    throw new Error("Unrecognized palette");
  if (sender.tab) {
    const params = new URL(sender.url).searchParams;
    const standalone = params.has("window");
    const token = params.get(standalone ? "window" : "overlay");
    const sessions =
      (await chrome.storage.session.get(sessionKey))[sessionKey] || {};
    const session = sessions[token];
    if (
      !session ||
      (standalone ? session.paletteTabId : session.tabId) !== sender.tab.id ||
      Date.now() - session.created > 86_400_000
    )
      throw new Error("This palette has expired. Reopen Tablight.");
    return {
      sourceId: session.tabId,
      windowId: session.windowId,
      incognito: session.incognito ?? sender.tab.incognito,
    };
  }
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab) throw new Error("No active browser window");
  return { sourceId: tab.id, windowId: tab.windowId, incognito: tab.incognito };
}
async function handle(message, sender) {
  const context = await contextFor(sender);
  if (message.type === "snapshot") {
    const tabs = (await chrome.tabs.query({}))
      .filter((t) => t.incognito === context.incognito && isSwitchableTab(t))
      .map((t) => ({
        id: t.id,
        windowId: t.windowId,
        title: t.title || t.url || "Untitled",
        url: t.url || "",
        lastAccessed: t.lastAccessed,
        pinned: t.pinned,
        audible: t.audible,
        discarded: t.discarded,
        active: t.active,
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
    if (
      typeof message.query !== "string" ||
      message.query.length > 8192 ||
      !message.query.trim()
    )
      throw new Error("Invalid query");
    await chrome.tabs.create({
      windowId: context.windowId,
      active: true,
      url: chatGPTURL(message.query),
    });
    return { ok: true };
  }
  if (message.type === "navigate") {
    if (typeof message.query !== "string" || message.query.length > 8192)
      throw new Error("Invalid query");
    const target = destination(message.query);
    if (!target || (target.kind === "search" && !target.query))
      return { ok: false };
    const created = await chrome.tabs.create({
      windowId: context.windowId,
      active: true,
      ...(target.kind === "url" ? { url: target.url } : {}),
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
    (error) => respond({ error: error.message }),
  );
  return true;
});
