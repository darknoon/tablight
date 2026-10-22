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
  style.textContent = `:host::backdrop{background:transparent}
    .backdrop{position:absolute;inset:0;background:rgb(30 30 35 / 12%);pointer-events:none}
    .glass{position:absolute;visibility:hidden;border-radius:12px;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);pointer-events:none}
    iframe{position:relative;display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal}
    @media(prefers-reduced-transparency:reduce){.glass{backdrop-filter:none;-webkit-backdrop-filter:none}}
    `;
  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const glass = document.createElement("div");
  glass.className = "glass";
  glass.setAttribute("aria-hidden", "true");
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = "Tablight — search your tabs";
  root.append(style, backdrop, glass, frame);
  const close = () => {
    window.removeEventListener("message", message);
    host.remove();
    delete globalThis.__tablightClose;
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  const message = (event) => {
    if (
      event.source !== frame.contentWindow ||
      event.origin !== new URL(url).origin
    )
      return;
    if (event.data === "tablight:close") close();
    if (event.data?.type === "tablight:panel") {
      const { x, y, width, height } = event.data;
      if (
        ![x, y, width, height].every(Number.isFinite) ||
        width < 0 ||
        height < 0
      )
        return;
      Object.assign(glass.style, {
        left: x + "px",
        top: y + "px",
        width: width + "px",
        height: height + "px",
        visibility: "visible",
      });
    }
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
