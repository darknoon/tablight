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
    "all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;z-index:2147483647!important;color-scheme:normal!important;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `:host::backdrop{background:transparent!important;backdrop-filter:none!important}
    .shell{position:absolute;left:50%;transform:translateX(-50%);width:min(680px,calc(100vw - 40px));border-radius:12px;overflow:hidden;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 24px 64px rgb(0 0 0 / 24%),0 2px 8px rgb(0 0 0 / 6%)}
    iframe{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal}
    @media(prefers-color-scheme:dark){.shell{box-shadow:0 24px 60px rgb(0 0 0 / 44%)}}
    @media(prefers-reduced-transparency:reduce){.shell{backdrop-filter:none;-webkit-backdrop-filter:none}}
    @media(max-width:480px){.shell{width:calc(100vw - 20px)}}
    `;
  const shell = document.createElement("div");
  shell.className = "shell";
  const frame = document.createElement("iframe");
  frame.src = url;
  frame.title = "Tablight — search your tabs";
  shell.append(frame);
  root.append(style, shell);
  let panelHeight = 460;
  const layout = () => {
    const top =
      innerWidth <= 480 ? 24 : Math.max(24, Math.min(innerHeight * 0.25, 230));
    const available = Math.max(80, innerHeight - top - 24);
    shell.style.top = top + "px";
    shell.style.height = Math.min(panelHeight, available) + "px";
    frame.contentWindow?.postMessage(
      { type: "tablight:viewport", height: available },
      new URL(url).origin,
    );
  };
  const close = () => {
    window.removeEventListener("message", message);
    window.removeEventListener("resize", layout);
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
    if (
      event.data?.type === "tablight:panel" &&
      Number.isFinite(event.data.height) &&
      event.data.height > 0
    ) {
      panelHeight = Math.ceil(event.data.height);
      layout();
    }
  };
  // Only clicks outside the bounded frame dismiss the picker.
  host.addEventListener("pointerdown", (event) => {
    if (!event.composedPath().includes(shell)) close();
  });
  frame.addEventListener("load", layout);
  globalThis.__tablightClose = close;
  window.addEventListener("message", message);
  window.addEventListener("resize", layout);
  document.documentElement.append(host);
  layout();
  try {
    host.showPopover();
  } catch {}
  frame.focus();
  return true;
}
