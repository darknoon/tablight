## Privacy

No telemetry, accounts, runtime dependencies, persistent site access, or search history. Typing does not send queries to a service. Selecting web search, Ask ChatGPT, or a URL navigates to that destination. ChatGPT queries are included in the destination URL and may be retained in browser history.

Permissions:

| Permission               | Purpose                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| `tabs`                   | Read titles and URLs, then activate an existing tab              |
| `activeTab`, `scripting` | Insert the picker after an explicit invocation                   |
| `storage`                | Short-lived session authorization for the picker                 |
| `search`                 | Submit an explicitly selected web search to the browser's engine |
| `favicon`                | Read favicons through the browser's internal favicon endpoint    |

The picker runs in an extension-origin frame within a closed shadow root. Session tokens bind it to the invoking tab or fallback window. Its CSP prohibits network connections and remote scripts. The temporary 0.1.4 diagnostic log is removed on update; only the latest invocation time and opening method are retained in session storage, without page URLs, titles, or queries. Options can copy or download a diagnostic report; nothing is sent automatically. This is not an independent security audit.

## Develop

Requires Node.js 22 or newer.

```sh
npm ci
npx playwright install chromium
npm run build
npm test
npm run test:browser
npm run package
```

`CHROMIUM_PATH=/path/to/chromium npm run test:browser` selects an existing Chromium executable. Each run uses a fresh isolated profile. The suite loads the actual extension, assigns ⌘T in the shortcut editor and invokes the browser's extension-action API. It tests ranking, focus, tab switching, search/ChatGPT handoffs, isolation and the protected-page window. Web and ChatGPT destinations are intercepted fixtures: tests verify the handoff URL, not a live ChatGPT response. Artifacts are written to `artifacts/`.

The suite does not synthesize a physical macOS shortcut. The native extension-action binding was manually confirmed in Dia. Dia's custom command path delivered events without the page access needed for injection, and its programmatic action popup failed; this is why Tablight uses `_execute_action` and a real fallback window.

Setup instructions open on first install and remain available from the extension’s Options menu. Reloads and updates do not reopen them.

Selection uses the browser-provided system Highlight/HighlightText colors, not a fixed lavender. These are not Dia’s profile theme: no supported extension API to read that color has been identified.

To regenerate the README image using only fictional tabs, run `node scripts/screenshot.mjs` (with `CHROMIUM_PATH` if needed).

## Troubleshooting

Open the extension’s **Options** menu and choose **Copy diagnostics** or **Download diagnostics**. The report includes version, browser, shortcut, display settings, and the latest opening method. Paste or attach it to a support conversation. It excludes browsing content and is never sent automatically.
