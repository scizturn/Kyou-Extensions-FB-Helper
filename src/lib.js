const ITEM_ID_RE = /(?:kyou\.id\/items\/)?(\d{4,})/gi;

export function parseItemIds(raw) {
  const seen = new Set();
  const ids = [];
  for (const match of String(raw || "").matchAll(ITEM_ID_RE)) {
    const id = match[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function buildKyouItemUrl(itemId) {
  return `https://kyou.id/items/${String(itemId).trim()}`;
}

export function parseKyouItemHtml(html, itemId) {
  const sourceUrl = buildKyouItemUrl(itemId);
  const title =
    readMeta(html, "property", "og:title") ||
    readMeta(html, "name", "twitter:title") ||
    readTitle(html) ||
    "";
  const imageUrl =
    readMeta(html, "property", "og:image") ||
    readMeta(html, "name", "twitter:image") ||
    readJsonLdImage(html) ||
    "";
  const description =
    readMeta(html, "name", "description") ||
    readMeta(html, "property", "og:description") ||
    "";

  return {
    itemId: String(itemId),
    title: cleanText(title),
    imageUrl: cleanText(imageUrl),
    priceText: normalizeDescription(description),
    sourceUrl,
  };
}

export function formatCaption(item) {
  const parts = [];
  if (item.title) {
    parts.push(item.title);
  }
  if (item.priceText) {
    parts.push(item.priceText);
  }
  parts.push(`Belanja ngga ribet di Kyou.id!\n${item.sourceUrl || buildKyouItemUrl(item.itemId)}`);
  return parts.join("\n\n").trim();
}

export function validateRows(rows) {
  const ready = [];
  const problems = [];
  for (const row of rows) {
    if (!String(row.imageUrl || "").trim()) {
      problems.push({ itemId: row.itemId, problem: "image missing" });
    } else if (!String(row.caption || "").trim()) {
      problems.push({ itemId: row.itemId, problem: "caption missing" });
    } else {
      ready.push(row);
    }
  }
  return { ready, problems };
}

export function createJobState({ itemIds, rows }, now = new Date().toISOString()) {
  return {
    jobId: now,
    status: "preview_ready",
    itemIds: [...itemIds],
    rows: [...rows],
    currentIndex: 0,
    error: "",
    updatedAt: now,
  };
}

export function updateJobState(state, patch, now = new Date().toISOString()) {
  return {
    ...state,
    ...patch,
    updatedAt: now,
  };
}

export function canUsePreparedRows(rows) {
  return Array.isArray(rows) && rows.length > 0;
}

export function normalizeStaffTabOptions(options) {
  if (!Array.isArray(options)) {
    return [];
  }
  return options
    .map((option) => {
      const value = String(option?.value || "").trim();
      const label = String(option?.label || value).trim();
      return { label, value };
    })
    .filter((option) => option.value);
}

export function normalizeWarnings(warnings) {
  if (!Array.isArray(warnings)) {
    return [];
  }
  return warnings.map((warning) => String(warning || "").trim()).filter(Boolean);
}

export function isMissingContentScriptError(error) {
  return String(error?.message || error || "")
    .toLowerCase()
    .includes("receiving end does not exist");
}

export function buildDownloadFilename(row, index) {
  const order = String(index + 1).padStart(3, "0");
  const status = String(row?.status || "NA")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "") || "NA";
  const itemId = String(row?.itemId || "item").replace(/[^a-z0-9_-]/gi, "");
  const extension = extensionFromUrl(row?.imageUrl) || "jpg";
  return `kyou-fb-upload/${order}-${status}-${itemId}.${extension}`;
}

export function buildDownloadRequest(row, index) {
  return {
    url: row.imageUrl,
    filename: buildDownloadFilename(row, index),
    conflictAction: "overwrite",
    saveAs: false,
  };
}

export async function fetchKyouItems(itemIds, fetchImpl = fetch) {
  const rows = [];
  for (const itemId of itemIds) {
    const sourceUrl = buildKyouItemUrl(itemId);
    const response = await fetchImpl(sourceUrl, { credentials: "omit" });
    if (!response.ok) {
      throw new Error(`Kyou item ${itemId} failed: HTTP ${response.status}`);
    }
    const html = await response.text();
    const parsed = parseKyouItemHtml(html, itemId);
    rows.push({ ...parsed, caption: formatCaption(parsed) });
  }
  return rows;
}

function readMeta(html, attrName, attrValue) {
  const escapedValue = escapeRegExp(attrValue);
  const tagPattern = new RegExp(`<meta\\b(?=[^>]*\\b${attrName}=["']${escapedValue}["'])[^>]*>`, "i");
  const tag = String(html || "").match(tagPattern)?.[0] || "";
  if (!tag) {
    return "";
  }
  return decodeHtml(readAttribute(tag, "content"));
}

function readTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtml(match[1]) : "";
}

function readJsonLdImage(html) {
  const scripts = String(html || "").matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1].trim());
      const image = findJsonLdImage(parsed);
      if (image) {
        return image;
      }
    } catch {
      // Ignore invalid JSON-LD blocks from the page.
    }
  }
  return "";
}

function findJsonLdImage(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = findJsonLdImage(item);
      if (image) {
        return image;
      }
    }
    return "";
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const image = value.image;
  if (typeof image === "string") {
    return image;
  }
  if (Array.isArray(image) && typeof image[0] === "string") {
    return image[0];
  }
  if (image && typeof image.url === "string") {
    return image.url;
  }
  return "";
}

function readAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i"));
  return match ? match[2] : "";
}

function normalizeDescription(value) {
  return cleanText(value).replace(/\s*\|\s*/g, "\n");
}

function cleanText(value) {
  return decodeHtml(String(value || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extensionFromUrl(url) {
  const match = String(url || "").match(/\.([a-z0-9]{3,4})(?:[?#]|$)/i);
  return match ? match[1].toLowerCase() : "";
}
