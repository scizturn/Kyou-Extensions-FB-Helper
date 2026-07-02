import {
  createJobState,
  normalizeStaffTabOptions,
  parseItemIds,
  updateJobState,
} from "./lib.js";

const JOB_STATE_KEY_BASE = "fbHelperJobState";

// Daily keeps the legacy key so in-progress jobs survive the upgrade; Special Sale
// gets its own suffixed key so the two modes never clobber each other.
function jobStateKey(mode) {
  return mode === "special" ? `${JOB_STATE_KEY_BASE}:special` : JOB_STATE_KEY_BASE;
}

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PREPARE_KYOU_ITEMS") {
    prepareKyouItems(message)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    return true;
  }
  if (message?.type === "GET_JOB_STATE") {
    getJobState(message.mode).then(sendResponse);
    return true;
  }
  if (message?.type === "GET_STAFF_TABS") {
    getStaffTabs()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error.message || String(error), staffTabs: [] });
      });
    return true;
  }
  if (message?.type === "UPDATE_JOB_STATE") {
    mergeJobState(message.patch || {}, message.mode).then(sendResponse);
    return true;
  }
  if (message?.type === "CLEAR_JOB_STATE") {
    chrome.storage.local.remove([jobStateKey(message.mode)]).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

async function prepareKyouItems(message) {
  const itemIds = parseItemIds(message.rawItemIds);
  if (!itemIds.length) {
    return { ok: false, error: "No valid item IDs found." };
  }
  if (itemIds.length > 100) {
    return { ok: false, error: "Maximum 100 item IDs per upload batch." };
  }

  const settings = await getSettings();
  if (!settings.furinaBaseUrl || !settings.furinaToken) {
    return { ok: false, error: "Set Furina URL and token first." };
  }

  // Metabase pulls data straight from the DB (no staff tab); Sheet uses the
  // helper-tab formulas, so a staff tab must be chosen.
  const useMetabase = message.dataSource !== "sheet";
  if (!useMetabase && !message.tabName) {
    return { ok: false, error: "Choose a staff tab first." };
  }

  const endpoint = useMetabase ? "generate-caption" : "prepare";
  // Special Sale mode + Metabase → caption sale (harga normal + kuota promo + harga sale).
  const body = useMetabase
    ? { itemIds: message.rawItemIds, sale: message.mode === "special" }
    : { tabName: message.tabName, itemIds: message.rawItemIds };

  const response = await fetch(`${settings.furinaBaseUrl}/fb-album-extension/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.furinaToken}`,
    },
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = { ok: false, error: `Furina returned HTTP ${response.status}.` };
  }

  if (!response.ok || !payload?.ok) {
    return {
      ok: false,
      rows: payload?.rows || [],
      problems: payload?.problems || [],
      missingIds: payload?.missingIds || [],
      error: payload?.error || `Furina returned HTTP ${response.status}.`,
    };
  }

  const jobState = createJobState({ itemIds, rows: payload.rows });
  await chrome.storage.local.set({ [jobStateKey(message.mode)]: jobState });
  return { ...payload, jobState };
}

async function getStaffTabs() {
  const settings = await getSettings();
  if (!settings.furinaBaseUrl || !settings.furinaToken) {
    return { ok: false, error: "Set Furina URL and token first.", staffTabs: [] };
  }

  const response = await fetch(`${settings.furinaBaseUrl}/fb-album-extension/config`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${settings.furinaToken}`,
    },
  });
  const payload = await response.json();
  return {
    ok: response.ok && Boolean(payload?.ok),
    error: payload?.error || "",
    staffTabs: normalizeStaffTabOptions(payload?.staffTabs),
  };
}

async function getSettings() {
  const saved = await chrome.storage.local.get(["furinaBaseUrl", "furinaToken"]);
  return {
    furinaBaseUrl: String(saved.furinaBaseUrl || "").replace(/\/+$/, ""),
    furinaToken: String(saved.furinaToken || ""),
  };
}

async function getJobState(mode) {
  const key = jobStateKey(mode);
  const saved = await chrome.storage.local.get([key]);
  return { ok: true, jobState: saved[key] || null };
}

async function mergeJobState(patch, mode) {
  const current = (await getJobState(mode)).jobState;
  if (!current) {
    return { ok: false, error: "No job state found." };
  }
  const jobState = updateJobState(current, patch);
  await chrome.storage.local.set({ [jobStateKey(mode)]: jobState });
  return { ok: true, jobState };
}
