import { isMissingContentScriptError } from "./lib.js";

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

let preparedRows = [];

init();

async function init() {
  const saved = await chrome.storage.local.get(["itemIds", "furinaBaseUrl", "furinaToken", "staffTab"]);
  itemIdsInput.value = saved.itemIds || "";
  furinaBaseUrlInput.value = saved.furinaBaseUrl || "";
  furinaTokenInput.value = saved.furinaToken || "";
  staffTabInput.value = saved.staffTab || "";

  itemIdsInput.addEventListener("input", () => {
    chrome.storage.local.set({ itemIds: itemIdsInput.value });
    preparedRows = [];
    downloadButton.disabled = true;
    fillButton.disabled = true;
    previewEl.textContent = "";
  });
  furinaBaseUrlInput.addEventListener("input", saveSettings);
  furinaTokenInput.addEventListener("input", saveSettings);
  staffTabInput.addEventListener("change", saveSettings);

  previewButton.addEventListener("click", previewItems);
  downloadButton.addEventListener("click", downloadImages);
  fillButton.addEventListener("click", fillFacebook);
  clearButton.addEventListener("click", clearSavedJob);
  refreshTabsButton.addEventListener("click", loadStaffTabs);

  const tab = await getActiveTab();
  pageStateEl.textContent = isFacebookTab(tab) ? "Facebook tab detected" : "Open Facebook album first";
  await loadStaffTabs();
  await restoreSavedJob();
}

async function previewItems() {
  setLoading("Fetching Kyou items...");
  fillButton.disabled = true;
  previewEl.textContent = "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "PREPARE_KYOU_ITEMS",
      rawItemIds: itemIdsInput.value,
      tabName: staffTabInput.value.trim(),
    });

    if (!response?.ok) {
      preparedRows = response?.rows || [];
      renderPreview(preparedRows, response?.problems || []);
      setStatus(response?.error || "Failed to prepare items.", true);
      return;
    }

    preparedRows = response.rows;
    renderPreview(preparedRows, []);
    if (response.jobState) {
      renderJobState(response.jobState);
    }
    setStatus(`${preparedRows.length} items ready.`);
  } finally {
    clearLoading();
  }
}

async function fillFacebook() {
  if (!preparedRows.length) {
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
      patch: { status: "caption_filling", currentIndex: 0, error: "" },
    });
    const response = await sendFillMessage(tab.id, preparedRows);

    if (!response?.ok) {
      await chrome.runtime.sendMessage({
        type: "UPDATE_JOB_STATE",
        patch: { status: "error", error: response?.error || "Facebook fill failed." },
      });
      setStatus(response?.error || "Facebook fill failed.", true);
      return;
    }
    await chrome.runtime.sendMessage({
      type: "UPDATE_JOB_STATE",
      patch: { status: "done", currentIndex: preparedRows.length, error: "" },
    });
    setStatus(response.message || "Facebook fields filled. Review before saving.");
  } catch (error) {
    const message = error.message || String(error);
    await chrome.runtime.sendMessage({
      type: "UPDATE_JOB_STATE",
      patch: { status: "error", error: message },
    });
    setStatus(message, true);
  } finally {
    clearLoading();
  }
}

async function sendFillMessage(tabId, rows) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: "FB_HELPER_FILL_CAPTIONS",
      rows,
    });
  } catch (error) {
    if (!isMissingContentScriptError(error)) {
      throw error;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"],
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    return chrome.tabs.sendMessage(tabId, {
      type: "FB_HELPER_FILL_CAPTIONS",
      rows,
    });
  }
}

async function downloadImages() {
  if (!preparedRows.length) {
    setStatus("Preview items first.", true);
    return;
  }
  setLoading("Downloading images...");
  try {
    const response = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_IMAGES",
      rows: preparedRows,
    });
    if (!response?.ok) {
      setStatus(response?.error || "Download failed.", true);
      return;
    }
    setStatus(`${response.message} Upload them manually in Facebook, then click Fill captions.`);
  } finally {
    clearLoading();
  }
}

async function restoreSavedJob() {
  const response = await chrome.runtime.sendMessage({ type: "GET_JOB_STATE" });
  const jobState = response?.jobState;
  if (!jobState) {
    return;
  }
  preparedRows = jobState.rows || [];
  renderPreview(preparedRows, []);
  renderJobState(jobState);
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
  await chrome.runtime.sendMessage({ type: "CLEAR_JOB_STATE" });
  preparedRows = [];
  downloadButton.disabled = true;
  fillButton.disabled = true;
  previewEl.textContent = "";
  setStatus("Saved job cleared.");
}

function saveSettings() {
  chrome.storage.local.set({
    furinaBaseUrl: furinaBaseUrlInput.value.trim(),
    furinaToken: furinaTokenInput.value,
    staffTab: staffTabInput.value,
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

function renderPreview(rows, problems) {
  previewEl.textContent = "";
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
  fillButton.disabled = true;
  setStatus(message);
}

function clearLoading() {
  previewButton.disabled = false;
  downloadButton.disabled = preparedRows.length === 0;
  fillButton.disabled = preparedRows.length === 0;
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
