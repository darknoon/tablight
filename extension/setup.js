const mac = /Mac/.test(navigator.platform);
const suggested = mac ? "⌘T" : "Ctrl+T";
document.querySelector("#suggested").textContent = suggested;
document.querySelector(".note").textContent =
  `${suggested} normally opens a new tab. Assigning it here uses it for Tablight instead. If your browser keeps intercepting it, choose another shortcut.`;
document.querySelector("#name").textContent = chrome.runtime.getManifest().name;
async function refreshShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    document.querySelector("#shortcut").textContent =
      commands.find((c) => c.name === "_execute_action")?.shortcut || "Not set";
  } catch {
    document.querySelector("#shortcut").textContent =
      "Check keyboard shortcuts below";
  }
}
document
  .querySelector("#open")
  .addEventListener("click", () =>
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" }),
  );
window.addEventListener("focus", refreshShortcut);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshShortcut();
});
refreshShortcut();

async function diagnostics() {
  const { lastInvocation } = await chrome.storage.session.get("lastInvocation");
  return JSON.stringify(
    {
      version: chrome.runtime.getManifest().version,
      browser: navigator.userAgent,
      platform: navigator.platform,
      pixelRatio: devicePixelRatio,
      darkAppearance: matchMedia("(prefers-color-scheme: dark)").matches,
      shortcut:
        (await chrome.commands.getAll()).find(
          (c) => c.name === "_execute_action",
        )?.shortcut || null,
      lastInvocation: lastInvocation
        ? { time: lastInvocation.time, stage: lastInvocation.stage }
        : null,
    },
    null,
    2,
  );
}
document.querySelector("#copy-debug").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(await diagnostics());
    document.querySelector("#debug-status").textContent =
      "Copied. Paste the diagnostics into your support conversation.";
  } catch {
    document.querySelector("#debug-status").textContent =
      "Copy was unavailable. Use Download diagnostics and attach the file instead.";
  }
});
document
  .querySelector("#download-debug")
  .addEventListener("click", async () => {
    const url = URL.createObjectURL(
      new Blob([await diagnostics()], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "tablight-diagnostics.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.querySelector("#debug-status").textContent =
      "Downloaded. Attach the file to your support conversation.";
  });
