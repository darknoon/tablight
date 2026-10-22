import { chromium } from "playwright";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
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
  const fixtures = [
    { title: "Design resources · GitHub", icon: "github.ico" },
    { title: "Design · Wikipedia", icon: "wikipedia.ico" },
    { title: "Design tutorials · YouTube", icon: "youtube.png" },
    { title: "Start" },
  ];
  await context.route("https://*.example/**", (route) => {
    const url = new URL(route.request().url());
    const index = Number(url.hostname.split(".")[0].slice(3));
    const fixture = fixtures[index];
    if (url.pathname === "/favicon.ico" && fixture.icon) {
      return route.fulfill({
        path: path.resolve("docs/fixtures", fixture.icon),
      });
    }
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><title>${fixture.title}</title>${fixture.icon ? '<link rel="icon" href="/favicon.ico">' : ""}<style>html{background:#dedede}</style>`,
    });
  });
  let page;
  for (let i = 0; i < fixtures.length; i++) {
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
  await frame.locator("#query").fill("design");
  await frame.locator('[data-key="chatgpt"]').waitFor();
  // Synthetic pages have no real browser favicon cache. Seed their official
  // fixture icons for this demo; no personal browser profile is used.
  const demoIcons = await Promise.all(
    fixtures
      .filter((f) => f.icon)
      .map(async (f) => ({
        title: f.title,
        src: `data:image/${f.icon.endsWith(".png") ? "png" : "x-icon"};base64,${(await readFile(path.resolve("docs/fixtures", f.icon))).toString("base64")}`,
      })),
  );
  await frame.evaluate((icons) => {
    for (const item of icons) {
      const row = [...document.querySelectorAll(".result")].find(
        (r) => r.querySelector(".title").textContent === item.title,
      );
      const image = new Image(16, 16);
      image.src = item.src;
      image.alt = "";
      row.querySelector(".icon").replaceChildren(image);
    }
  }, demoIcons);

  await frame.waitForFunction(() => {
    const icons = [...document.querySelectorAll(".result .icon img")];
    return (
      icons.length === 3 &&
      icons.every((img) => img.complete && img.naturalWidth > 0)
    );
  });

  await frame
    .locator("#query")
    .evaluate((e) => (e.style.caretColor = "transparent"));
  await mkdir("docs", { recursive: true });
  await page.screenshot({ path: "docs/screenshot.png" });
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
