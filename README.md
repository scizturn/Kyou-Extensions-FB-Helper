# Kyou FB Upload Helper

Chrome extension for staff-assisted Facebook album uploads.

The extension does not use the Facebook Graph API. Staff stays logged in to Facebook, opens the album edit page, clicks the extension, enters Kyou item IDs, previews image/caption data, then lets the extension fill the Facebook upload UI. Staff should review the album before clicking Facebook's final save/post button.

## Current Flow

1. Open the Facebook album edit page.
2. Open the extension popup.
3. Open **Furina settings** and fill the Furina URL plus extension token.
4. Fill the staff tab name, for example `FB - Helper - REGA`.
5. Paste item IDs or Kyou item links.
6. Click **Preview**.
7. Confirm the generated image/caption preview.
8. Click **Fill Facebook**.
9. Review the uploaded photos and descriptions in Facebook.
10. Save/post manually in Facebook.

## How It Works

- `src/background.js` parses item IDs, calls Furina's private `/fb-album-extension/prepare` endpoint, and saves the current job state.
- Furina uses its Google service account to write/read the private FB helper Google Sheet.
- `src/lib.js` contains item ID parsing, Kyou page fallback helpers, validation, and resumable job state helpers.
- `src/content.js` runs on Facebook pages, finds the upload file input, downloads image URLs as browser `File` objects, assigns them to the input, then fills visible caption/description fields.
- `src/popup.js` manages the staff UI and passes prepared rows to the Facebook tab.

## Furina Setup

In `Furina-Discord-Bot/.env`, add:

```env
FB_ALBUM_EXTENSION_TOKEN=change_this_to_a_long_random_secret
```

Then restart Furina. The extension should use:

```text
Furina URL: http://localhost:8080
Extension token: the same value as FB_ALBUM_EXTENSION_TOKEN
```

For remote staff computers, expose Furina over HTTPS and use that HTTPS base URL in the extension.

## Install Locally

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder: `FB-UPLOAD_EXTENTION`.

## Development

Run tests:

```bash
npm test
```

Run syntax checks:

```bash
node --check src/lib.js
node --check src/background.js
node --check src/popup.js
node --check src/content.js
```

## Limits

Facebook UI automation is fragile because Facebook can change labels, DOM structure, upload timing, or checkpoint flows. The extension intentionally stops before final save/post so staff can review the result.

The popup can close after a job is prepared. Job state is saved in Chrome local storage, and the content script updates progress while it downloads images and fills captions. If Chrome or the Facebook tab is closed, reopen the popup and clear/retry the saved job.

The extension requests broad HTTP/HTTPS host access because staff may point it to a local or remote Furina URL, and item images may be served from CDN domains that are not known ahead of time.
