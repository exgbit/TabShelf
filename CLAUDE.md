# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

TabShelf ("标签收藏集") — a free/open-source Toby replacement: a Chrome Manifest V3 extension for saving/restoring tab groups, a new-tab workbench, and global search. Pure local storage (`chrome.storage.local`), no backend, no build step. See README.md and REQUIREMENTS.md for full feature scope and design rationale.

## Development

No build tools, package manager, linter, or test suite — plain JS/HTML/CSS loaded directly by Chrome.

- **Load/reload the extension**: `chrome://extensions` → enable "开发者模式" (Developer mode) → "加载已解压的扩展程序" (Load unpacked) → select the repo root. After editing any file, click the extension's reload icon on that page to pick up changes (for `newtab.html`/`.js`/`.css` changes, also close and reopen new-tab pages).
- **Debug popup.js**: right-click the toolbar icon → Inspect popup.
- **Debug newtab.js**: open a new tab, then DevTools as normal.
- There is no automated test suite; verify changes manually by exercising the popup and new-tab workbench in Chrome.

## Architecture

Three independent entry points share one data module, with no shared framework or module bundler (each JS file is an IIFE attached to `window`):

- **`storage.js`** (`window.Store`) — the sole data-access layer. Wraps `chrome.storage.local` under a single key (`collections`), an array of collection objects: `{ id, name, org, space, starred, createdAt, tabs: [{title, url}] }`. Also owns:
  - **Migration**: `migrate()` upcasts pre-org/space records (name like `"org / space / name"`) on read.
  - **Import/export**: `exportData()`/`importData()` handle TabShelf's own JSON format and can also directly ingest Toby's official export format (`normalizeToby`), flattening `organizations → spaces → collections → bookmarks` into TabShelf's flat collection list while preserving `org`/`space` as fields.
  - Both `popup.js` and `newtab.js` call `Store` directly and re-fetch (`Store.getAll()`) after every mutation — there is no shared in-memory store or event bus between the two pages.

- **`popup.js`** + `popup.html/css` — toolbar popup for quick-saving the current tab or window. Has its own drill-down navigation state (`view: {type: 'spaces'} | {type: 'space', space}`) and its own org switcher, independent of newtab's.

- **`newtab.js`** + `newtab.html/css` — overrides Chrome's new-tab page (`chrome_url_overrides.newtab`) as the main workbench: four-column layout (org rail → space panel → collection cards → live "open tabs" list per window). Listens to `chrome.tabs`/`chrome.windows` events to keep the right-hand open-tabs column live (debounced via `scheduleRenderOpenTabs`).

**Data model conventions worth knowing before editing either UI:**
- `org`/`space` are plain string fields on each collection, not separate entities — the org/space lists shown in the UI are derived by scanning `collections` for distinct values (`orgList()`, `spaceNames()`). Renaming/deleting the last collection in an org or space silently removes that org/space from the UI.
- Empty string org/space means "default" — displayed as `个人` (org) or `全部收藏集` (space), not stored as such.
- `saveTabToSpace` (popup.js) and the space-panel "quick save" icon both target a per-space default collection (name = space name, or `收集箱` for the default space), auto-creating it if absent.
