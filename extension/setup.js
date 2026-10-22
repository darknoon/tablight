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
