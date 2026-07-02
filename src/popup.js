import { buildDownloadFilename, canUsePreparedRows, isMissingContentScriptError, normalizeWarnings } from "./lib.js";

const itemIdsInput = document.querySelector("#itemIds");
const previewButton = document.querySelector("#previewButton");
const downloadButton = document.querySelector("#downloadButton");
const fillButton = document.querySelector("#fillButton");
const clearButton = document.querySelector("#clearButton");
const refreshTabsButton = document.querySelector("#refreshTabsButton");
const statusEl = document.querySelector("#status");
const previewEl = document.querySelector("#preview");
const pageStateEl = document.querySelector("#pageState");
const furinaBaseUrlInput = document.querySelector("#furinaBaseUrl");
const furinaTokenInput = document.querySelector("#furinaToken");
const staffTabInput = document.querySelector("#staffTab");
const staffTabRow = document.querySelector("#staffTabRow");
const dataSourceInput = document.querySelector("#dataSource");
const modeTabButtons = [...document.querySelectorAll(".mode-tab")];

// Metabase pulls item data straight from the DB (no staff tab); Sheet uses the
// helper-tab formulas. Default to Sheet so the update keeps the legacy behavior
// until a user explicitly switches the source.
const DEFAULT_DATA_SOURCE = "sheet";

// Daily and Special Sale run the identical flow but keep separate inputs and saved
// jobs. Daily reuses the legacy storage keys so existing drafts survive; Special Sale
// gets suffixed keys. Furina settings and the staff-tab option list stay shared.
const MODES = {
  daily: { label: "Daily" },
  special: { label: "Special Sale" },
};

const modeState = {
  daily: { preparedRows: [] },
  special: { preparedRows: [] },
};

let activeMode = "daily";

function current() {
  return modeState[activeMode];
}

function itemIdsKey(mode) {
  return mode === "special" ? "itemIds:special" : "itemIds";
}

function staffTabKey(mode) {
  return mode === "special" ? "staffTab:special" : "staffTab";
}

function dataSourceKey(mode) {
  return mode === "special" ? "dataSource:special" : "dataSource";
}

function currentDataSource() {
  return dataSourceInput.value === "sheet" ? "sheet" : "metabase";
}

// Staff tab only matters for the Sheet source; hide it when Metabase is selected.
function applyDataSourceUI() {
  staffTabRow.hidden = currentDataSource() !== "sheet";
}

init();

async function init() {
  const saved = await chrome.storage.local.get(["furinaBaseUrl", "furinaToken"]);
  furinaBaseUrlInput.value = saved.furinaBaseUrl || "";
  furinaTokenInput.value = saved.furinaToken || "";

  itemIdsInput.addEventListener("input", () => {
    chrome.storage.local.set({ [itemIdsKey(activeMode)]: itemIdsInput.value });
    current().preparedRows = [];
    downloadButton.disabled = true;
    fillButton.disabled = true;
    previewEl.textContent = "";
  });
  furinaBaseUrlInput.addEventListener("input", saveFurinaSettings);
  furinaTokenInput.addEventListener("input", saveFurinaSettings);
  staffTabInput.addEventListener("change", () => {
    chrome.storage.local.set({ [staffTabKey(activeMode)]: staffTabInput.value });
  });
  dataSourceInput.addEventListener("change", () => {
    chrome.storage.local.set({ [dataSourceKey(activeMode)]: currentDataSource() });
    applyDataSourceUI();
  });

  previewButton.addEventListener("click", previewItems);
  downloadButton.addEventListener("click", downloadImages);
  fillButton.addEventListener("click", fillFacebook);
  clearButton.addEventListener("click", clearSavedJob);
  refreshTabsButton.addEventListener("click", loadStaffTabs);
  for (const button of modeTabButtons) {
    button.addEventListener("click", () => switchMode(button.dataset.mode));
  }

  const tab = await getActiveTab();
  pageStateEl.textContent = isFacebookTab(tab) ? "Facebook tab detected" : "Open Facebook album first";
  await loadStaffTabs();
  await loadMode(activeMode);
}

async function switchMode(mode) {
  if (!MODES[mode] || mode === activeMode) {
    return;
  }
  activeMode = mode;
  for (const button of modeTabButtons) {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  }
  await loadMode(mode);
}

async function loadMode(mode) {
  const saved = await chrome.storage.local.get([itemIdsKey(mode), staffTabKey(mode), dataSourceKey(mode)]);
  itemIdsInput.value = saved[itemIdsKey(mode)] || "";

  const desiredTab = saved[staffTabKey(mode)] || "";
  staffTabInput.value = [...staffTabInput.options].some((option) => option.value === desiredTab)
    ? desiredTab
    : "";

  dataSourceInput.value = saved[dataSourceKey(mode)] === "sheet" ? "sheet" : DEFAULT_DATA_SOURCE;
  applyDataSourceUI();

  previewEl.textContent = "";
  setStatus("");
  await restoreSavedJob();
}

async function previewItems() {
  setLoading("Fetching Kyou items...");
  fillButton.disabled = true;
  previewEl.textContent = "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "PREPARE_KYOU_ITEMS",
      mode: activeMode,
      dataSource: currentDataSource(),
      rawItemIds: itemIdsInput.value,
      tabName: staffTabInput.value.trim(),
    });

    if (!response?.ok) {
      current().preparedRows = response?.rows || [];
      renderPreview(current().preparedRows, response?.problems || [], response?.warnings || []);
      setStatus(response?.error || "Failed to prepare items.", true);
      return;
    }

    current().preparedRows = response.rows;
    renderPreview(current().preparedRows, [], response.warnings || []);
    if (response.jobState) {
      renderJobState(response.jobState);
    }
    setStatus(`${current().preparedRows.length} items ready.`);
  } finally {
    clearLoading();
  }
}

async function fillFacebook() {
  if (!current().preparedRows.length) {
    setStatus("Preview items first.", true);
    return;
  }

  setLoading("Filling captions on Facebook page...");
  const tab = await getActiveTab();
  if (!isFacebookTab(tab)) {
    setStatus("Open the Facebook album edit tab first.", true);
    clearLoading();
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: "UPDATE_JOB_STATE",
      mode: activeMode,
      patch: { status: "caption_filling", currentIndex: 0, error: "" },
    });
    const response = await sendFillMessage(tab.id, current().preparedRows);

    if (!response?.ok) {
      await chrome.runtime.sendMessage({
        type: "UPDATE_JOB_STATE",
        mode: activeMode,
        patch: { status: "error", error: response?.error || "Facebook fill failed." },
      });
      setStatus(response?.error || "Facebook fill failed.", true);
      return;
    }
    await chrome.runtime.sendMessage({
      type: "UPDATE_JOB_STATE",
      mode: activeMode,
      patch: { status: "done", currentIndex: current().preparedRows.length, error: "" },
    });
    setStatus(response.message || "Facebook fields filled. Review before saving.");
  } catch (error) {
    const message = error.message || String(error);
    await chrome.runtime.sendMessage({
      type: "UPDATE_JOB_STATE",
      mode: activeMode,
      patch: { status: "error", error: message },
    });
    setStatus(message, true);
  } finally {
    clearLoading();
  }
}

async function sendFillMessage(tabId, rows) {
  const message = { type: "FB_HELPER_FILL_CAPTIONS", mode: activeMode, rows };
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isMissingContentScriptError(error)) {
      throw error;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"],
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function downloadImages() {
  if (!current().preparedRows.length) {
    setStatus("Preview items first.", true);
    return;
  }
  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({
      id: "kyou-download-folder",
      mode: "readwrite",
    });
  } catch (error) {
    if (error.name !== "AbortError") {
      setStatus(error.message || String(error), true);
    }
    return;
  }

  setLoading("Downloading images...");
  try {
    const rows = current().preparedRows;
    let successCount = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const filename = buildDownloadFilename(row, index, "");
      try {
        const response = await fetch(row.imageUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        successCount += 1;
      } catch (err) {
        console.error(`Failed to download ${row.imageUrl}:`, err);
      }
    }

    await chrome.runtime.sendMessage({
      type: "UPDATE_JOB_STATE",
      mode: activeMode,
      patch: { status: "images_downloaded", currentIndex: rows.length, error: "" },
    });

    setStatus(`Downloaded ${successCount} images. Upload them manually in Facebook, then click Fill captions.`);
  } catch (error) {
    setStatus(error.message || "Download failed.", true);
  } finally {
    clearLoading();
  }
}

async function restoreSavedJob() {
  const response = await chrome.runtime.sendMessage({ type: "GET_JOB_STATE", mode: activeMode });
  const jobState = response?.jobState;
  if (!jobState) {
    current().preparedRows = [];
    updateActionButtons();
    return;
  }
  current().preparedRows = jobState.rows || [];
  renderPreview(current().preparedRows, []);
  renderJobState(jobState);
  updateActionButtons();
}

function renderJobState(jobState) {
  if (!jobState) {
    return;
  }
  const total = jobState.rows?.length || 0;
  const progress = total ? ` ${jobState.currentIndex || 0}/${total}` : "";
  const suffix = jobState.error ? ` - ${jobState.error}` : "";
  setStatus(`Saved job: ${jobState.status}${progress}${suffix}`, jobState.status === "error");
}

async function clearSavedJob() {
  await chrome.runtime.sendMessage({ type: "CLEAR_JOB_STATE", mode: activeMode });
  current().preparedRows = [];
  downloadButton.disabled = true;
  fillButton.disabled = true;
  previewEl.textContent = "";
  setStatus("Saved job cleared.");
}

function saveFurinaSettings() {
  chrome.storage.local.set({
    furinaBaseUrl: furinaBaseUrlInput.value.trim(),
    furinaToken: furinaTokenInput.value,
  });
}

async function loadStaffTabs() {
  const selectedValue = staffTabInput.value;
  const response = await chrome.runtime.sendMessage({ type: "GET_STAFF_TABS" });
  if (!response?.ok) {
    renderStaffTabs([], selectedValue);
    if (furinaBaseUrlInput.value || furinaTokenInput.value) {
      setStatus(response?.error || "Failed to load helper tabs.", true);
    }
    return;
  }
  renderStaffTabs(response.staffTabs || [], selectedValue);
}

function renderStaffTabs(staffTabs, selectedValue) {
  staffTabInput.textContent = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = staffTabs.length ? "Choose helper tab" : "No helper tabs loaded";
  staffTabInput.append(placeholder);

  for (const tab of staffTabs) {
    const option = document.createElement("option");
    option.value = tab.value;
    option.textContent = tab.label;
    staffTabInput.append(option);
  }

  if (selectedValue && staffTabs.some((tab) => tab.value === selectedValue)) {
    staffTabInput.value = selectedValue;
  }
}

function renderPreview(rows, problems, warnings = []) {
  previewEl.textContent = "";
  for (const warning of normalizeWarnings(warnings)) {
    const line = document.createElement("div");
    line.className = "warning";
    line.textContent = warning;
    previewEl.append(line);
  }
  for (const row of rows) {
    const item = document.createElement("article");
    item.className = "item";
    const image = document.createElement("img");
    image.src = row.imageUrl || "";
    image.alt = row.itemId;
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = row.itemId;
    const caption = document.createElement("p");
    caption.textContent = row.caption || row.title || "";
    body.append(title, caption);
    item.append(image, body);
    previewEl.append(item);
  }

  for (const problem of problems) {
    const line = document.createElement("div");
    line.className = "problem";
    line.textContent = `${problem.itemId}: ${problem.problem}`;
    previewEl.append(line);
  }
}

function setLoading(message) {
  previewButton.disabled = true;
  downloadButton.disabled = true;
  fillButton.disabled = true;
  setStatus(message);
}

function clearLoading() {
  previewButton.disabled = false;
  updateActionButtons();
}

function updateActionButtons() {
  const hasRows = canUsePreparedRows(current().preparedRows);
  downloadButton.disabled = !hasRows;
  fillButton.disabled = !hasRows;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? "problem" : "";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isFacebookTab(tab) {
  return /^https:\/\/(www\.)?facebook\.com\//.test(tab?.url || "");
}
