import { fetchKyouItems, parseItemIds, validateRows } from "./lib.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "PREPARE_KYOU_ITEMS") {
    return false;
  }

  prepareKyouItems(message.rawItemIds)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

async function prepareKyouItems(rawItemIds) {
  const itemIds = parseItemIds(rawItemIds);
  if (!itemIds.length) {
    return { ok: false, error: "No valid item IDs found." };
  }
  if (itemIds.length > 50) {
    return { ok: false, error: "Maximum 50 item IDs per upload batch." };
  }

  const rows = await fetchKyouItems(itemIds);
  const validation = validateRows(rows);
  return {
    ok: validation.problems.length === 0,
    rows,
    problems: validation.problems,
    error: validation.problems.length ? "Some items are missing image or caption data." : "",
  };
}
