// This function is serialized by chrome.scripting into an isolated world.
export function mountOverlay(url) {
  if (globalThis.__tablightClose) {
    globalThis.__tablightClose();
    return false;
  }
  const previous = document.activeElement;
  const host = document.createElement("div");
  host.setAttribute("popover", "manual");
  host.style.cssText =
    "all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;z-index:2147483647!important;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent =
    ":host::backdrop{background:transparent} iframe{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal}";
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = "Tablight — search your tabs";
  root.append(style, frame);
  const close = () => {
    window.removeEventListener("message", message);
    host.remove();
    delete globalThis.__tablightClose;
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  const message = (event) => {
    if (
      event.source === frame.contentWindow &&
      event.origin === new URL(url).origin &&
      event.data === "tablight:close"
    )
      close();
  };
  globalThis.__tablightClose = close;
  window.addEventListener("message", message);
  document.documentElement.append(host);
  try {
    host.showPopover();
  } catch {}
  frame.focus();
  return true;
}
