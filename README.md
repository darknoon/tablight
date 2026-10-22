# Tablight

A small tab picker for Chromium browsers, inspired by Arc. Open it, type a few letters, and press Return to switch tabs.

## Install

1. Download and extract the release ZIP into a permanent folder, or use this repository's `extension/` folder.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the folder containing `manifest.json`.
3. Open `chrome://extensions/shortcuts`. Under **Tablight**, assign **⌘T** to **Activate the extension**. Leave the scope as **In Dia** or **In Chrome**.

The default shortcut is ⌘⇧Space on macOS and Ctrl⇧Space elsewhere. Chromium does not allow Tablight to install ⌘T as its default, so it must be assigned manually. Clicking the toolbar icon invokes the same action.

**Upgrading from 0.1.x:** keep ⌘T on **Activate the extension**. The old custom **Search tabs** command is removed. Replace the installed files and click Reload on the extension card. There is no settings page.

## Use

- Empty input + Return switches to the most recently used eligible tab.
- Type to match titles or URLs. Strong matches appear above web search; weak fuzzy matches appear below it.
- Up/down chooses a result. Return activates it.
- **Search the web** uses your browser's default engine, such as Google.
- **Ask ChatGPT** opens `chatgpt.com/?q=…` with the selected query. This is a website handoff, not an API integration; ChatGPT controls sign-in and prompt handling.
- Shift+Return or ⌘Return forces a new URL or web search. A leading `?` excludes tab matches.
- Escape dismisses the picker. Clicking outside the in-page overlay also dismisses it.

Normal websites use a centered overlay with a frosted panel and a one-device-pixel hairline (dark appearance follows your system). The page outside the panel stays sharp and lightly dimmed. Reduced-transparency preferences disable the panel blur. Protected pages such as `chrome://extensions` use a small centered window. Selecting a result or pressing Escape closes that window.

Results include HTTP, HTTPS and file tabs in the same browser profile and browsing mode. Browser-owned pages, extension pages, Dia chat and placeholder WebUIs are excluded so the picker does not switch into internal browser surfaces. External sites such as ChatGPT are ordinary searchable tabs. Local file overlays require the browser's file-access permission; otherwise the window fallback is used.

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

The picker runs in an extension-origin frame within a closed shadow root. Session tokens bind it to the invoking tab or fallback window. Its CSP prohibits network connections and remote scripts. The temporary 0.1.4 diagnostic log is removed on update; this version does not record diagnostics. This is not an independent security audit.

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
