import { chromium } from "playwright";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
const profile = await mkdtemp("/tmp/tablight-screenshot-");
const context = await chromium.launchPersistentContext(profile, {
  executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  args: [
    "--enable-unsafe-extension-debugging",
    `--disable-extensions-except=${path.resolve("extension")}`,
    `--load-extension=${path.resolve("extension")}`,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const deadline = Date.now() + 5000;
  while (!context.pages().some((p) => p.url().endsWith("/setup.html"))) {
    if (Date.now() > deadline) throw new Error("Setup did not open");
    await new Promise((r) => setTimeout(r, 50));
  }
  // Every website is a synthetic fixture; no personal profile or live sites.
  const titles = [
    "Design notes",
    "Reading list",
    "Weekend recipes",
    "Project ideas",
    "Start",
  ];
  await context.route("https://*.example/**", (route) => {
    const index = Number(
      new URL(route.request().url()).hostname.split(".")[0].slice(3),
    );
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>${titles[index]}</title><style>html{background:#dedede}</style>`,
    });
  });
  let page;
  for (let i = 0; i < titles.length; i++) {
    page = await context.newPage();
    await page.goto(`https://tab${i}.example/`);
  }
  await page.bringToFront();
  const cdp = await context.browser().newBrowserCDPSession();
  const targets = await cdp.send("Target.getTargets", {
    filter: [{ type: "tab" }],
  });
  const target = targets.targetInfos.find((t) => t.url === page.url());
  await cdp.send("Extensions.triggerAction", { id, targetId: target.targetId });
  let frame;
  while (
    !(frame = page.frames().find((f) => f.url().includes("palette.html")))
  ) {
    if (Date.now() > deadline + 10000) throw new Error("Picker did not open");
    await new Promise((r) => setTimeout(r, 50));
  }
  await frame.locator(".result").first().waitFor();
  await frame
    .locator("#query")
    .evaluate((e) => (e.style.caretColor = "transparent"));
  await mkdir("docs", { recursive: true });
  await page.screenshot({ path: "docs/screenshot.png" });
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
