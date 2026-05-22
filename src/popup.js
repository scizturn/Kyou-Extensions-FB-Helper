const itemIdsInput = document.querySelector("#itemIds");
const previewButton = document.querySelector("#previewButton");
const fillButton = document.querySelector("#fillButton");
const statusEl = document.querySelector("#status");
const previewEl = document.querySelector("#preview");
const pageStateEl = document.querySelector("#pageState");

let preparedRows = [];

init();

async function init() {
  const saved = await chrome.storage.local.get(["itemIds"]);
  itemIdsInput.value = saved.itemIds || "";
  itemIdsInput.addEventListener("input", () => {
    chrome.storage.local.set({ itemIds: itemIdsInput.value });
    preparedRows = [];
    fillButton.disabled = true;
    previewEl.textContent = "";
  });

  previewButton.addEventListener("click", previewItems);
  fillButton.addEventListener("click", fillFacebook);

  const tab = await getActiveTab();
  pageStateEl.textContent = isFacebookTab(tab) ? "Facebook tab detected" : "Open Facebook album first";
}

async function previewItems() {
  setLoading("Fetching Kyou items...");
  fillButton.disabled = true;
  previewEl.textContent = "";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "PREPARE_KYOU_ITEMS",
      rawItemIds: itemIdsInput.value,
    });

    if (!response?.ok) {
      preparedRows = response?.rows || [];
      renderPreview(preparedRows, response?.problems || []);
      setStatus(response?.error || "Failed to prepare items.", true);
      return;
    }

    preparedRows = response.rows;
    renderPreview(preparedRows, []);
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

  setLoading("Sending rows to Facebook page...");
  const tab = await getActiveTab();
  if (!isFacebookTab(tab)) {
    setStatus("Open the Facebook album edit tab first.", true);
    clearLoading();
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "FB_HELPER_FILL_ALBUM",
      rows: preparedRows,
    });

    if (!response?.ok) {
      setStatus(response?.error || "Facebook fill failed.", true);
      return;
    }
    setStatus(response.message || "Facebook fields filled. Review before saving.");
  } finally {
    clearLoading();
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
