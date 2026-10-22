import test from "node:test";
import assert from "node:assert/strict";
import {
  rankTabs,
  destination,
  makeResults,
  isSwitchableTab,
  chatGPTURL,
} from "../src/search.js";
const now = 1_000_000;
const tabs = [
  {
    id: 1,
    windowId: 1,
    title: "Pull requests · fieldwork",
    url: "https://github.com/fieldwork/pulls",
    lastAccessed: now - 10,
  },
  {
    id: 2,
    windowId: 2,
    title: "Figma — Product design",
    url: "https://figma.com/design/abc",
    lastAccessed: now - 100,
  },
  {
    id: 3,
    windowId: 1,
    title: "GitHub documentation",
    url: "https://docs.github.com",
    lastAccessed: now - 300,
  },
  {
    id: 4,
    windowId: 1,
    title: "Café planning",
    url: "https://example.com/cafe",
    lastAccessed: now - 200,
  },
];
const context = { sourceId: 1, windowId: 1, now };
test("open-tab results precede search", () => {
  assert.equal(makeResults(tabs, "figma", context)[0].tab.id, 2);
  assert.equal(makeResults(tabs, "figma", context).at(-2).kind, "search");
});
test("URL, title, initials, accents and multi-token matching", () => {
  for (const [q, id] of [
    ["github fieldwork", 1],
    ["fgm", 2],
    ["pd", 2],
    ["cafe", 4],
    ["pull requests", 1],
  ])
    assert.equal(rankTabs(tabs, q, context)[0]?.id, id, q);
});
test("empty query selects the previous tab across windows, ignoring pinned and window boosts", () => {
  assert.equal(rankTabs(tabs, "", context)[0].id, 2);
  assert.ok(!rankTabs(tabs, "", context).some((t) => t.id === 1));
  assert.equal(
    rankTabs(
      [...tabs, { id: 5, windowId: 1, pinned: true, lastAccessed: now - 500 }],
      "",
      context,
    )[0].id,
    2,
  );
});
test("current tab remains searchable", () =>
  assert.equal(rankTabs(tabs, "fieldwork", context)[0].id, 1));
test("exact title beats recently viewed partial match", () => {
  const items = [
    ...tabs,
    { id: 5, title: "Figma", url: "https://example.com", lastAccessed: 0 },
  ];
  assert.equal(rankTabs(items, "figma", context)[0].id, 5);
});
test("nonsense does not generate sparse false positives", () =>
  assert.equal(rankTabs(tabs, "fzzzzgr", context).length, 0));
test("explicit search excludes matching tabs", () => {
  const r = makeResults(tabs, "?figma", context);
  assert.equal(r.length, 2);
  assert.equal(r[0].query, "figma");
});
test("destinations: https, localhost, queries and unsafe schemes", () => {
  assert.deepEqual(destination("example.com/a"), {
    kind: "url",
    url: "https://example.com/a",
  });
  assert.equal(destination("localhost:3000").url, "http://localhost:3000/");
  for (const s of [
    "hello world",
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:pass@example.com",
  ])
    assert.equal(destination(s).kind, "search");
  assert.equal(destination("  "), null);
});
test("ranking 2000 tabs stays interactive", () => {
  const many = Array.from({ length: 2000 }, (_, i) => ({
    ...tabs[i % 4],
    id: i,
  }));
  const start = performance.now();
  assert.ok(rankTabs(many, "github fieldwork", context).length);
  assert.ok(performance.now() - start < 250);
});

test("search sits between confident matches and weak matches regardless of recency", () => {
  const candidates = [
    { id: 10, title: "Figma", url: "https://figma.com", lastAccessed: 0 },
    {
      id: 11,
      title: "A disfigured image",
      url: "https://example.com",
      lastAccessed: now,
      pinned: true,
      windowId: 1,
    },
  ];
  assert.deepEqual(
    makeResults(candidates, "fig", context).map((r) => r.key),
    ["tab:10", "destination", "chatgpt", "tab:11"],
  );
  assert.equal(makeResults(tabs, "fgm", context)[0].kind, "search");
  assert.equal(makeResults(tabs, "pd", context)[0].kind, "search");
  const weak = [
    {
      id: 12,
      title: "Show HN: A project",
      url: "https://news.ycombinator.com/item?id=1",
    },
    {
      id: 13,
      title: "All | Search powered by Algolia",
      url: "https://hn.algolia.com",
    },
  ];
  assert.equal(makeResults(weak, "hn", context)[0].kind, "search");
  assert.equal(
    makeResults(
      [...weak, { id: 14, title: "HN", url: "https://example.com" }],
      "hn",
      context,
    )[0].tab.id,
    14,
  );
  const mixed = [
    { id: 15, title: "Figma design", url: "https://figma.com" },
    {
      id: 16,
      title: "A figment",
      url: "https://example.com",
      lastAccessed: now,
      pinned: true,
    },
  ];
  assert.deepEqual(
    makeResults(mixed, "figma", context).map((r) => r.key),
    ["tab:15", "destination", "chatgpt"],
  );
  assert.deepEqual(
    makeResults(mixed, "fgm", context).map((r) => r.key),
    ["destination", "chatgpt", "tab:16", "tab:15"],
  );
});

test("only normal web and file tabs can be selected", () => {
  for (const url of [
    "chrome://dia-chat",
    "dia://chat",
    "chrome://extensions",
    "chrome://placeholder",
    "chrome-extension://abc/page",
    "about:blank",
    "",
    "invalid",
  ])
    assert.equal(isSwitchableTab({ url }), false, url);
  for (const url of [
    "https://chatgpt.com/",
    "http://localhost:3000/",
    "file:///tmp/example.html",
  ])
    assert.equal(isSwitchableTab({ url, title: "Dia chat" }), true, url);
});
test("ChatGPT handoff safely encodes only the explicit query", () => {
  const q = "hello & # ? café";
  assert.equal(new URL(chatGPTURL(q)).searchParams.get("q"), q);
  assert.equal(
    makeResults(tabs, "", context).some((r) => r.kind === "chatgpt"),
    false,
  );
  assert.equal(
    makeResults(tabs, "example.com", context).some((r) => r.kind === "chatgpt"),
    false,
  );
});
