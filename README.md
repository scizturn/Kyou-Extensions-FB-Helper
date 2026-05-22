# Kyou FB Upload Helper

Chrome extension for staff-assisted Facebook album uploads.

The extension does not use the Facebook Graph API. Staff stays logged in to Facebook, opens the album edit page, clicks the extension, enters Kyou item IDs, previews image/caption data, then lets the extension fill the Facebook upload UI. Staff should review the album before clicking Facebook's final save/post button.

## Current Flow

1. Open the Facebook album edit page.
2. Open the extension popup.
3. Paste item IDs or Kyou item links.
4. Click **Preview**.
5. Confirm the generated image/caption preview.
6. Click **Fill Facebook**.
7. Review the uploaded photos and descriptions in Facebook.
8. Save/post manually in Facebook.

## How It Works

- `src/background.js` parses item IDs and fetches each `https://kyou.id/items/{id}` page.
- `src/lib.js` extracts Open Graph title/image/description data and formats the Facebook caption.
- `src/content.js` runs on Facebook pages, finds the upload file input, downloads image URLs as browser `File` objects, assigns them to the input, then fills visible caption/description fields.
- `src/popup.js` manages the staff UI and passes prepared rows to the Facebook tab.

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

The extension requests broad HTTPS host access because Kyou item images may be served from CDN domains that are not known ahead of time.
