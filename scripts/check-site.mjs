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
    `--disable-extensions-except=${path.resolve(process.env.EXTENSION_PATH || "extension")}`,
    `--load-extension=${path.resolve(process.env.EXTENSION_PATH || "extension")}`,
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

  const page = await context.newPage();
  await page.goto("https://simonwillison.net/", {
    waitUntil: "domcontentloaded",
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.bringToFront();
  await page.evaluate(() => document.fonts.ready);
  const clip = { x: 0, y: 0, width: 160, height: 120 };
  const before = await page.screenshot({ clip });
  const cdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await cdp.send("Target.getTargets", {
    filter: [{ type: "tab" }],
  });
  await cdp.send("Extensions.triggerAction", {
    id,
    targetId: targetInfos.find((t) => t.url === page.url())?.targetId,
  });

  let frame;
  const until = Date.now() + 5000;
  while (
    !(frame = page.frames().find((f) => f.url().includes("palette.html")))
  ) {
    if (Date.now() > until) throw new Error("Picker missing");
    await new Promise((r) => setTimeout(r, 50));
  }
  await frame.locator("#query").waitFor();
  await new Promise((r) => setTimeout(r, 200));
  const after = await page.screenshot({ clip });
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/simonwillison-dark.png" });
  console.log("Outside pixels unchanged:", before.equals(after));
  if (!before.equals(after)) throw new Error("Page outside picker changed");
  const bounds = await frame.frameElement().then((el) => el.boundingBox());
  console.log("Picker frame bounds:", bounds);
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
