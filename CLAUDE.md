# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension ("Kyou FB Upload Helper") that helps staff post Kyou
catalog items to Facebook albums **through the Facebook web UI** — it never touches the
Facebook Graph API and never clicks Facebook's final save/post. Staff stay logged in to
Facebook manually; the extension only prepares image/caption data, downloads the images,
and fills the album's empty caption fields.

The extension is a thin client. The real data work (looking up Kyou items, reading the
private Google Sheet of staff "tabs") lives in a separate backend called **Furina**
(`Furina-Discord-Bot`, not in this repo), reached over two private endpoints:
`POST /fb-album-extension/prepare` and `GET /fb-album-extension/config`, both
authenticated with a shared bearer token the staff pastes into the popup.

## Commands

```bash
npm test                 # run all node:test suites in tests/
node --test tests/job_state.test.js   # run a single test file

# syntax check (no bundler/build step — files load as-is in Chrome)
node --check src/lib.js
```

Load the unpacked extension from this folder via `chrome://extensions` → Developer mode →
Load unpacked. There is no build, lint, or bundle step; `src/` files are shipped directly.
ES modules are used everywhere (`"type": "module"`), including the service worker
(`manifest.json` sets `background.type: "module"`).

## Architecture / data flow

The four `src/` scripts run in different Chrome contexts and only communicate via
`chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`. There are no direct imports
across contexts; **only `lib.js` is shared** (imported by background, popup, and the
tests). Pure, testable logic lives in `lib.js` by design — keep DOM/Chrome-API side
effects out of it.

- **`src/popup.js`** (side panel UI, `manifest.json` registers `popup.html` as
  `side_panel`) — drives the whole flow: Preview → Download images → Fill captions →
  Clear. Holds `preparedRows` in memory and persists settings + the last job to
  `chrome.storage.local`.
- **`src/background.js`** (service worker) — the only context that talks to Furina.
  Handles message types `PREPARE_KYOU_ITEMS`, `GET_STAFF_TABS`, `GET_JOB_STATE`,
  `UPDATE_JOB_STATE`, `CLEAR_JOB_STATE`. Owns the canonical job state under storage key
  `fbHelperJobState`.
- **`src/content.js`** (injected into `*.facebook.com`) — fills empty caption/description
  fields. Responds to `FB_HELPER_FILL_CAPTIONS`; deliberately **refuses**
  `FB_HELPER_FILL_ALBUM` (programmatic file upload is disabled on purpose).
- **`src/lib.js`** — pure helpers: item-ID/URL parsing, Kyou HTML scraping fallback
  (`parseKyouItemHtml`, `fetchKyouItems`), caption formatting, row validation, job-state
  factory/updater, staff-tab normalization, and `buildDownloadFilename`.

### End-to-end flow (matches the README "Current Flow")

1. Popup sends `PREPARE_KYOU_ITEMS` → background POSTs item IDs to Furina `/prepare` →
   Furina returns `rows` (`{itemId, imageUrl, caption, status, ...}`) → background calls
   `createJobState` and saves it.
2. Popup `downloadImages()` uses `window.showDirectoryPicker()` (File System Access API)
   so staff pick the destination folder, then fetches each `row.imageUrl` and writes it
   with `buildDownloadFilename(row, index)` → `NNN-STATUS-itemId.ext`.
3. Staff manually upload those files in Facebook's UI.
4. Popup `fillFacebook()` sends `FB_HELPER_FILL_CAPTIONS` to the content script, which
   finds empty description fields and fills them one at a time with a ~750ms delay
   (`DEFAULT_CAPTION_FILL_DELAY_MS`).

### Job state is the resume mechanism

The side panel can be closed mid-job. State (`status`, `currentIndex`, `rows`, `error`)
lives in `chrome.storage.local` and both the popup and content script patch it via
`UPDATE_JOB_STATE`. `status` moves through `preview_ready → images_downloaded →
caption_filling → done` (or `error`). On reopen, `restoreSavedJob()` rehydrates
`preparedRows` from the saved job.

## Gotchas worth knowing

- **Facebook DOM is unstable on purpose-handled.** `content.js` finds caption fields by
  fuzzy `aria-label`/text matching ("description", "caption", "optional", "say
  something") plus a geometry heuristic (`isAlbumGridTextField`), then sorts by screen
  position. Setting a React-controlled input requires `setNativeValue` + dispatching
  `beforeinput`/`input`/`change` — don't simplify to `node.value = x`.
- **Content script may not be injected yet.** `popup.js` `sendFillMessage` catches the
  "Receiving end does not exist" error (`isMissingContentScriptError`) and
  `chrome.scripting.executeScript`-injects `content.js` before retrying.
- **`buildDownloadFilename` must stay deterministic.** Stable, ordered, sanitized
  filenames (`001-RS-182534.webp`) are an explicit feature — recent commits exist solely
  to keep them stable. Don't add timestamps/randomness.
- **`tests/staff_tabs.test.js` currently fails** (`npm test` → 9 pass / 1 fail): it
  imports a removed `buildDownloadRequest` export and asserts the old
  `kyou-fb-upload/`-prefixed filename. The download path moved to a user-picked folder
  (`showDirectoryPicker`), so the test drifted from the code. Reconcile the test with the
  current `buildDownloadFilename` rather than re-adding the prefix.
- **Caption tests run `content.js` under Node** by setting `NODE_ENV=test`, which exposes
  `globalThis.__fbHelperTestApi` at the bottom of the file — keep that export hook when
  editing `content.js`.
- **Broad host permissions are intentional** (`https://*/*`, `http://*/*`): Furina may be
  a localhost dev server or a remote HTTPS URL, and item images come from arbitrary CDN
  domains.
