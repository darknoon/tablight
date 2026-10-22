import { chromium } from "playwright";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
const executablePath = process.env.CHROMIUM_PATH || chromium.executablePath();
await mkdir("artifacts", { recursive: true });
const context = await chromium.launchPersistentContext(
  await mkdtemp("/tmp/tablight-browser-test-"),
  {
    executablePath,
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      "--enable-unsafe-extension-debugging",
      `--disable-extensions-except=${path.resolve("extension")}`,
      `--load-extension=${path.resolve("extension")}`,
    ],
  },
);
const browserCDP = await context.browser().newBrowserCDPSession();
context.setDefaultTimeout(5000);
const reports = [];
function report(name) {
  reports.push(name);
  console.log("PASS", name);
}
const wait = async (fn, description) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out: " + description);
};
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  // Let the first-install options navigation finish before creating fixture tabs.
  await wait(
    () =>
      Promise.resolve(
        context.pages().some((p) => p.url().endsWith("/setup.html")),
      ),
    "first-install setup",
  );

  await context.route("https://*.test/**", (route) => {
    const url = new URL(route.request().url());
    const titles = {
      "notes.test": "Notes — Weekly planning",
      "figma.test": "Figma — Product design",
      "github.test": "Pull requests · fieldwork",
      "linear.test": "Linear — Roadmap",
      "evil.test": "<img src=x onerror=alert(1)> · Unsafe title",
    };
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><title>${(titles[url.host] || url.host).replaceAll("<", "&lt;")}</title><style>body{font:16px system-ui;background:#faf9f6;color:#393640;margin:70px}h1{font-size:42px;letter-spacing:-2px}p{color:#8a8491}textarea{width:500px;height:200px;border:1px solid #ddd;padding:20px;border-radius:10px}</style><p>PERSONAL / NOTES</p><h1>A little room to think.</h1><p>Everything you need, one shortcut away.</p><textarea aria-label="Notes">Keep this draft and cursor position.</textarea>`,
    });
  });
  const pages = {};
  for (const domain of ["github", "figma", "linear", "evil", "notes"]) {
    const page = await context.newPage();
    await page.goto(`https://${domain}.test/`);
    pages[domain] = page;
  }
  const origin = pages.notes;
  const cdp = await context.newCDPSession(origin);
  const { targetInfo } = await cdp.send("Target.getTargetInfo");
  async function trigger(page = origin) {
    await page.bringToFront();
    const session = await context.newCDPSession(page);
    const targets = await browserCDP.send("Target.getTargets", {
      filter: [{ type: "tab" }],
    });
    const targetInfo = targets.targetInfos.find((t) => t.url === page.url());
    await browserCDP.send("Extensions.triggerAction", {
      id,
      targetId: targetInfo.targetId,
    });
    await session.detach();
    await wait(
      () => page.frames().some((f) => f.url().includes("palette.html")),
      "palette frame",
    );
    const frame = page.frames().find((f) => f.url().includes("palette.html"));
    await frame.locator("#query").waitFor();
    await wait(
      () =>
        frame
          .locator("#results .result")
          .count()
          .then((x) => x > 0),
      "loaded results",
    );
    return frame;
  }
  async function dismiss(frame) {
    // Chromium can lose the CDP key-down acknowledgement when Escape removes
    // the focused out-of-process iframe. Observe the actual dismissal instead.
    const down = origin.keyboard.down("Escape");
    down.catch(() => {});
    await wait(() => frame.isDetached(), "Escape removes the palette frame");
    await origin.keyboard.up("Escape");
  }
  // Assign through the visible browser shortcut editor.
  const shortcuts = await context.newPage();
  await shortcuts.goto("chrome://extensions/shortcuts");
  await shortcuts
    .getByRole("button", {
      name: "Edit shortcut Activate the extension for Tablight — jump to a tab",
      exact: true,
    })
    .click();
  await shortcuts.keyboard.press("Meta+t");
  await wait(
    () =>
      worker
        .evaluate(() => chrome.commands.getAll())
        .then(
          (commands) =>
            commands.find((c) => c.name === "_execute_action")?.shortcut ===
            "⌘T",
        ),
    "shortcut editor assignment",
  );
  await shortcuts.screenshot({ path: "artifacts/shortcut-assigned.png" });
  report("Chromium shortcut editor accepts ⌘T typed into the binding field");
  await shortcuts.close();
  await origin.locator("textarea").focus();
  await origin.locator("textarea").evaluate((e) => e.setSelectionRange(5, 10));
  const outsideClip = { x: 0, y: 0, width: 160, height: 120 };
  const outsideBefore = await origin.screenshot({ clip: outsideClip });
  let frame = await trigger();
  assert.deepEqual(
    await origin.screenshot({ clip: outsideClip }),
    outsideBefore,
  );
  report("Page pixels outside the panel shadow remain unchanged");

  assert.equal(
    await frame.locator("#query").evaluate((e) => document.activeElement === e),
    true,
  );
  report("Real extension action opens centered overlay with input focused");
  for (const ratio of [1, 1.5, 2, 3]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: ratio,
      mobile: false,
    });
    await wait(
      () =>
        frame.evaluate(
          () =>
            Math.abs(
              parseFloat(
                getComputedStyle(document.querySelector("#panel"))
                  .borderTopWidth,
              ) *
                devicePixelRatio -
                1,
            ) < 0.001,
        ),
      "device-pixel hairline",
    );
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  report("Hairline follows device pixel ratios 1, 1.5, 2 and 3");

  await frame.locator("#query").fill("fig");
  assert.match(
    await frame.locator("[aria-selected=true] .title").innerText(),
    /Figma/,
  );
  await origin.screenshot({
    path: "artifacts/palette-light.png",
    animations: "disabled",
  });
  await frame.locator("#query").press("Enter");
  await wait(
    () =>
      worker
        .evaluate(
          async () =>
            (
              await chrome.tabs.query({ active: true, lastFocusedWindow: true })
            )[0].url,
        )
        .then((u) => u.includes("figma.test")),
    "switch to Figma",
  );
  assert.equal((await worker.evaluate(() => chrome.tabs.query({}))).length, 6);
  report("Type → Return switches to existing tab without creating a duplicate");
  frame = await trigger();
  await dismiss(frame);
  await wait(() => origin.frames().length === 1, "dismiss");
  assert.equal(
    await origin
      .locator("textarea")
      .evaluate(
        (e) =>
          document.activeElement === e &&
          e.selectionStart === 5 &&
          e.selectionEnd === 10,
      ),
    true,
  );
  report("Escape restores page focus and text selection");
  frame = await trigger();
  await frame.locator("#query").fill("pd");
  assert.equal(
    await frame.locator("[aria-selected=true]").getAttribute("data-key"),
    "destination",
  );
  assert.match(await frame.locator(".result").nth(2).innerText(), /Figma/);
  await frame.locator("#query").fill("fieldwork");
  assert.match(
    await frame.locator("[aria-selected=true] .title").innerText(),
    /Pull requests/,
  );
  report("Initials, title and URL matching work in Chromium");
  await frame.locator("#query").fill("unsafe");
  assert.equal(await frame.locator("#results img[onerror]").count(), 0);
  assert.match(await frame.locator(".title").first().innerText(), /<img/);
  report("Untrusted tab titles render as text, never HTML");
  await frame.locator("#query").fill("figma");
  await frame.locator("#query").press("ArrowDown");
  assert.equal(
    await frame.locator("[aria-selected=true]").getAttribute("data-key"),
    "destination",
  );
  await frame.locator("#query").press("ArrowUp");
  assert.match(
    await frame.locator("[aria-selected=true]").getAttribute("data-key"),
    /^tab:/,
  );
  report("Arrow navigation selects explicit search or tab result");
  await dismiss(frame);
  await origin.emulateMedia({ colorScheme: "dark" });
  frame = await trigger();
  await frame.locator("#query").fill("");
  await origin.screenshot({
    path: "artifacts/palette-dark.png",
    animations: "disabled",
  });
  await dismiss(frame);
  report("Light and dark palette screenshots captured");
  // Cross-window activation uses the real windows API.
  const second = await worker.evaluate(() =>
    chrome.windows.create({ url: "https://figma.test/second" }),
  );
  frame = await trigger();
  await frame.locator("#query").fill("figma.test/second");
  await frame.locator("#query").press("Enter");
  await wait(
    () =>
      worker
        .evaluate(() => chrome.windows.getLastFocused())
        .then((w) => w.id === second.id),
    "cross-window focus",
  );
  report("Switches and focuses a tab in another window");
  // URL fallback creates only the requested destination.
  frame = await trigger();
  await frame.locator("#query").fill("https://new.test/hello");
  const before = (await worker.evaluate(() => chrome.tabs.query({}))).length;
  await frame.locator("#query").press("Enter");
  await wait(
    () =>
      worker
        .evaluate(() => chrome.tabs.query({}))
        .then((t) => t.some((x) => x.url === "https://new.test/hello")),
    "new URL",
  );
  assert.equal(
    (await worker.evaluate(() => chrome.tabs.query({}))).length,
    before + 1,
  );
  report("URL fallback opens exactly one destination tab");
  // Tabs closing while the palette is open disappear without changing the typed query.
  frame = await trigger();
  await frame.locator("#query").fill("linear");
  const linearId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({})).find((t) => t.url.includes("linear.test"))
        .id,
  );
  await worker.evaluate((id) => chrome.tabs.remove(id), linearId);
  await wait(
    () =>
      frame
        .locator('[data-key="tab:' + linearId + '"]')
        .count()
        .then((n) => n === 0),
    "live removal",
  );
  assert.equal(await frame.locator("#query").inputValue(), "linear");
  report("Closed tabs are removed live without losing the query");
  await dismiss(frame);
  // Search input remains usable while a tab navigates or changes its title.
  frame = await trigger();
  await frame.locator("#query").fill("figma");
  await frame.locator("#query").press("ArrowDown");
  const selectedKey = await frame
    .locator("[aria-selected=true]")
    .getAttribute("data-key");
  await pages.figma.evaluate(() => (document.title = "Figma — Updated design"));
  await wait(
    () =>
      frame
        .getByText("Figma — Updated design", { exact: true })
        .count()
        .then((n) => n === 1),
    "live title refresh",
  );
  assert.equal(
    await frame.locator("[aria-selected=true]").getAttribute("data-key"),
    selectedKey,
  );
  assert.equal(await frame.locator("#query").inputValue(), "figma");
  report("Live title updates preserve keyboard selection and typed query");
  await dismiss(frame);
  // Outside click dismisses without navigating.
  frame = await trigger();
  await frame.locator("body").click({ position: { x: 5, y: 5 } });
  await wait(() => origin.frames().length === 1, "outside dismissal");
  report("Clicking outside the palette dismisses it");
  // Explicit search submits only when Return is pressed, using the browser's engine.
  const searchRequests = [];
  await context.route("https://www.google.com/**", (route) => {
    searchRequests.push(route.request().url());
    return route.fulfill({
      contentType: "text/html",
      body: "<title>Search results</title>Search results",
    });
  });
  frame = await trigger();
  await frame.locator("#query").fill("?a deliberately unique query");
  assert.equal(searchRequests.length, 0);
  await frame.locator("#query").press("Enter");
  await wait(() => searchRequests.length > 0, "explicit web search");
  assert.ok(
    searchRequests.some(
      (u) =>
        u.includes("a+deliberately+unique+query") ||
        u.includes("a%20deliberately%20unique%20query"),
    ),
  );
  report("Search uses the browser engine only after explicit submission");
  frame = await trigger();
  await frame.locator("#query").fill("figma");
  await frame.locator("#query").press("Shift+Enter");
  await wait(
    () => searchRequests.some((u) => /[?&]q=figma(?:&|$)/.test(u)),
    "forced search",
  );
  report("Shift+Return searches instead of switching to a matching tab");
  // Host pages cannot read other tabs through the isolated extension frame.
  frame = await trigger();
  assert.equal(
    await origin.evaluate(() =>
      document.body.innerText.includes("Product design"),
    ),
    false,
  );
  assert.equal(
    await origin.evaluate(() =>
      [...document.querySelectorAll("div")].some((e) => e.shadowRoot),
    ),
    false,
  );
  report("Page scripts cannot inspect the closed shadow root or tab results");
  await dismiss(frame);
  // An arbitrary host embedding the public HTML receives no tab data.
  await origin.evaluate((url) => {
    const iframe = document.createElement("iframe");
    iframe.src = url;
    iframe.id = "untrusted";
    document.body.append(iframe);
  }, `chrome-extension://${id}/palette.html?overlay=invalid`);
  await wait(
    () => origin.frames().some((f) => f.url().includes("overlay=invalid")),
    "untrusted frame",
  );
  const untrusted = origin
    .frames()
    .find((f) => f.url().includes("overlay=invalid"));
  await wait(
    () =>
      untrusted
        .locator("#status")
        .innerText()
        .then((t) => t.includes("expired")),
    "reject unauthorized frame",
  );
  assert.equal(await untrusted.locator(".result").count(), 0);
  await origin.locator("#untrusted").evaluate((e) => e.remove());
  report("Unauthorized embedded palettes cannot access tabs");
  await worker.evaluate((id) => chrome.windows.remove(id), second.id);
  // Empty-query Enter must toggle actual activation order, without typing first.
  const tabIds = await worker.evaluate(async () =>
    Object.fromEntries(
      (await chrome.tabs.query({}))
        .filter((t) =>
          ["https://notes.test/", "https://figma.test/"].includes(t.url),
        )
        .map((t) => [new URL(t.url).hostname, t.id]),
    ),
  );
  await worker.evaluate(async (ids) => {
    await chrome.tabs.update(ids["figma.test"], { active: true });
    await chrome.tabs.update(ids["notes.test"], { active: true });
  }, tabIds);
  for (const [page, expected] of [
    [origin, tabIds["figma.test"]],
    [pages.figma, tabIds["notes.test"]],
    [origin, tabIds["figma.test"]],
  ]) {
    frame = await trigger(page);
    assert.equal(
      await frame
        .locator("#query")
        .evaluate((e) => document.activeElement === e),
      true,
    );
    assert.equal(
      await frame.locator("[aria-selected=true]").getAttribute("data-key"),
      "tab:" + expected,
    );
    await frame.locator("#query").press("ArrowDown");
    await frame.locator("#query").press("ArrowUp");
    assert.equal(
      await frame.locator("[aria-selected=true]").getAttribute("data-key"),
      "tab:" + expected,
    );
    await frame.locator("#query").press("Enter");
    await wait(
      () =>
        worker
          .evaluate(
            async () =>
              (
                await chrome.tabs.query({
                  active: true,
                  lastFocusedWindow: true,
                })
              )[0].id,
          )
          .then((id) => id === expected),
      "previous-tab Enter",
    );
  }
  report(
    "Repeated opening focuses input; arrows work; empty Return toggles previous tabs",
  );
  // Protected pages use an actual independent window, then close on selection.
  const protectedPage = await context.newPage();
  await protectedPage.goto("chrome://version");
  await protectedPage.bringToFront();
  const protectedTargets = await browserCDP.send("Target.getTargets", {
    filter: [{ type: "tab" }],
  });
  const protectedTarget = protectedTargets.targetInfos.find(
    (t) => t.url === protectedPage.url(),
  );
  await browserCDP.send("Extensions.triggerAction", {
    id,
    targetId: protectedTarget.targetId,
  });
  // A new page starts at about:blank before receiving its authorized URL.
  await wait(
    () => context.pages().some((p) => p.url().includes("palette.html?window=")),
    "protected-page picker window",
  );
  const picker = context
    .pages()
    .find((p) => p.url().includes("palette.html?window="));
  await picker.locator("#query").waitFor();
  await wait(
    () =>
      picker
        .locator(".result")
        .count()
        .then((n) => n > 0),
    "picker results",
  );
  assert.equal(
    await picker
      .locator("#query")
      .evaluate((e) => document.activeElement === e),
    true,
  );
  const pickerBounds = await picker.locator("#results").boundingBox();
  assert.ok(pickerBounds.height > 300);
  assert.equal(
    await picker
      .locator(".result")
      .filter({ hasText: "About Version" })
      .count(),
    0,
  );
  const pickerTab = await worker.evaluate(async () =>
    (await chrome.tabs.query({})).find((t) =>
      t.url.includes("palette.html?window="),
    ),
  );
  const targetTab = await worker.evaluate(async () =>
    (await chrome.tabs.query({})).find((t) => t.url === "https://figma.test/"),
  );
  assert.notEqual(pickerTab.windowId, targetTab.windowId);
  await picker.locator("#query").fill("figma.test");
  await picker
    .locator(".result")
    .filter({ hasText: "Figma — Updated design" })
    .click();
  await wait(() => picker.isClosed(), "picker closes after switching");
  assert.equal(
    await worker.evaluate(
      (id) => chrome.tabs.get(id).then((t) => t.active),
      targetTab.id,
    ),
    true,
  );
  report(
    "Protected-page fallback opens a focused window and closes after tab selection",
  );
  await protectedPage.bringToFront();
  await browserCDP.send("Extensions.triggerAction", {
    id,
    targetId: protectedTarget.targetId,
  });
  await wait(
    () => context.pages().some((p) => p.url().includes("palette.html?window=")),
    "second picker window",
  );
  const escapePicker = context
    .pages()
    .find((p) => p.url().includes("palette.html?window="));
  await escapePicker.locator("#query").waitFor();
  const escapeDown = escapePicker.keyboard.down("Escape");
  escapeDown.catch(() => {});
  await wait(() => escapePicker.isClosed(), "Escape closes picker window");
  report("Escape closes the protected-page picker without switching tabs");

  // ChatGPT is contacted only when its specific result is selected.
  await context.route("https://chatgpt.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>ChatGPT handoff</title>",
    }),
  );
  const chatTabs = () =>
    worker.evaluate(async () =>
      (await chrome.tabs.query({})).filter((t) =>
        (t.pendingUrl || t.url || "").startsWith("https://chatgpt.com/"),
      ),
    );
  assert.equal((await chatTabs()).length, 0);
  frame = await trigger();
  await frame.locator("#query").fill("a question & details");
  assert.equal((await chatTabs()).length, 0);
  await frame.locator('[data-key="chatgpt"]').click();
  await wait(() => chatTabs().then((t) => t.length === 1), "ChatGPT handoff");
  const chatTab = (await chatTabs())[0];
  assert.equal(
    new URL(chatTab.pendingUrl || chatTab.url).searchParams.get("q"),
    "a question & details",
  );
  report(
    "Explicit Ask ChatGPT action passes the encoded query; typing sends nothing",
  );
  assert.deepEqual(
    await worker
      .evaluate(() => chrome.commands.getAll())
      .then((cs) => cs.map((c) => c.name)),
    ["_execute_action"],
  );
  assert.equal(
    await worker.evaluate(() => chrome.runtime.getManifest().options_ui.page),
    "setup.html",
  );
  report(
    "Only the native extension action is exposed; setup is available from Options",
  );
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${id}/setup.html`);
  await wait(
    () =>
      setup
        .locator("#shortcut")
        .innerText()
        .then((t) => t.includes("T")),
    "assigned shortcut shown in setup",
  );
  assert.match(
    await setup.locator("main").innerText(),
    /Activate the extension/,
  );
  await setup.locator("#open").click();
  await wait(
    () =>
      Promise.resolve(
        context
          .pages()
          .some((p) => p.url() === "chrome://extensions/shortcuts"),
      ),
    "setup opens shortcut editor",
  );
  await setup.screenshot({ path: "artifacts/setup.png" });
  report(
    "Setup shows the assigned action shortcut and opens the browser shortcut editor",
  );
  await writeFile(
    "artifacts/browser-report.json",
    JSON.stringify(
      {
        browser: await worker.evaluate(() => navigator.userAgent),
        passed: reports,
        nativeKeystrokeTested: false,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
}
