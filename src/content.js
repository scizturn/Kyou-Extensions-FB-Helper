chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FB_HELPER_FILL_ALBUM") {
    sendResponse({
      ok: false,
      error: "Auto-upload is disabled. Download images, upload them manually in Facebook, then click Fill captions.",
    });
    return false;
  }
  if (message?.type !== "FB_HELPER_FILL_CAPTIONS") {
    return false;
  }

  fillVisibleCaptions(message.rows, message.mode)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

const DEFAULT_CAPTION_FILL_DELAY_MS = 750;
const FIRST_FIELD_TIMEOUT_MS = 15000;
const SCROLL_SETTLE_MS = 1000;
const MAX_SCROLL_STALLS = 5;

async function fillVisibleCaptions(rows, mode) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No prepared rows received.");
  }

  // Resume-safe: skip rows whose caption is already present on the page, so a
  // second click after a partial fill continues instead of misaligning rows.
  const pending = withoutAlreadyFilledRows(rows);
  const alreadyFilled = rows.length - pending.length;
  if (pending.length === 0) {
    await updateJob({ status: "done", currentIndex: rows.length, error: "" }, mode);
    return { ok: true, message: `All ${rows.length} captions are already filled. Review before saving.` };
  }

  await updateJob({ status: "caption_filling", currentIndex: alreadyFilled }, mode);

  const firstBatch = await waitFor(() => {
    const found = emptyCaptionFields();
    return found.length ? found : null;
  }, FIRST_FIELD_TIMEOUT_MS);
  if (!firstBatch) {
    throw new Error(
      "No empty Facebook description fields found. Upload the downloaded images first, then try Fill captions.",
    );
  }

  // Facebook only mounts the description fields near the viewport, so on big
  // batches (PO) we fill what exists, scroll to force more fields to render,
  // and repeat until every row is placed or the page stops producing fields.
  let filledCount = 0;
  let stalls = 0;
  let lastField = null;
  while (filledCount < pending.length && stalls < MAX_SCROLL_STALLS) {
    const fields = emptyCaptionFields();
    if (!fields.length) {
      scrollToLoadMore(lastField);
      await sleep(SCROLL_SETTLE_MS);
      stalls += 1;
      continue;
    }
    stalls = 0;
    const batch = pending.slice(filledCount, filledCount + fields.length);
    const base = alreadyFilled + filledCount;
    await fillCaptionFields(fields, batch, {
      delayMs: DEFAULT_CAPTION_FILL_DELAY_MS,
      onProgress: (currentIndex) =>
        updateJob({ status: "caption_filling", currentIndex: base + currentIndex }, mode),
    });
    filledCount += batch.length;
    lastField = fields[batch.length - 1] || lastField;
  }

  const totalFilled = alreadyFilled + filledCount;
  if (filledCount < pending.length) {
    throw new Error(
      `Filled ${totalFilled}/${rows.length} captions before running out of empty fields. ` +
        "Scroll the album page so the remaining photos load, then click Fill captions again to continue.",
    );
  }
  await updateJob({ status: "done", currentIndex: rows.length, error: "" }, mode);

  return {
    ok: true,
    message: `Filled ${rows.length} captions. Review before saving.`,
  };
}

function withoutAlreadyFilledRows(rows) {
  // Multiset of the non-empty field values currently on the page.
  const existing = new Map();
  for (const node of findCaptionFields()) {
    const value = editableValue(node).trim();
    if (!value) {
      continue;
    }
    existing.set(value, (existing.get(value) || 0) + 1);
  }
  return rows.filter((row) => {
    const caption = String(row.caption || "").trim();
    const count = caption ? existing.get(caption) || 0 : 0;
    if (count > 0) {
      existing.set(caption, count - 1);
      return false;
    }
    return true;
  });
}

async function updateJob(patch, mode) {
  try {
    await chrome.runtime.sendMessage({ type: "UPDATE_JOB_STATE", patch, mode });
  } catch {
    // The Facebook fill should continue even if state update fails.
  }
}

function emptyCaptionFields() {
  return findCaptionFields().filter(isEditableEmpty);
}

function scrollToLoadMore(fromNode) {
  const anchor = fromNode?.isConnected ? fromNode : null;
  const container = anchor ? findScrollableAncestor(anchor) : null;
  if (container) {
    container.scrollTop += Math.round(container.clientHeight * 0.85);
  }
  window.scrollBy(0, Math.round(window.innerHeight * 0.85));
}

function findScrollableAncestor(node) {
  let current = node?.parentElement || null;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function findCaptionFields() {
  // Set dedupes nodes that match more than one selector (e.g. a contenteditable
  // with both role=textbox and aria-label) so a field is never counted twice.
  const candidates = [
    ...new Set([
      ...document.querySelectorAll("textarea"),
      ...document.querySelectorAll("[contenteditable='true'][role='textbox']"),
      ...document.querySelectorAll("[contenteditable='true'][aria-label]"),
    ]),
  ];

  return candidates
    .filter(isVisible)
    .filter((node) => {
      const label = textSignal(node).toLowerCase();
      return (
        label.includes("description") ||
        label.includes("caption") ||
        label.includes("optional") ||
        label.includes("say something") ||
        isAlbumGridTextField(node)
      );
    })
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top === br.top ? ar.left - br.left : ar.top - br.top;
    });
}

function isAlbumGridTextField(node) {
  const rect = node.getBoundingClientRect();
  return rect.left > 320 && rect.top > 40 && rect.width >= 120 && rect.height >= 30;
}

async function fillCaptionFields(fields, rows, options = {}) {
  const count = Math.min(fields.length, rows.length);
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : DEFAULT_CAPTION_FILL_DELAY_MS;
  const wait = options.wait || sleep;
  for (let index = 0; index < count; index += 1) {
    fields[index].scrollIntoView?.({ block: "center", inline: "nearest" });
    setEditableValue(fields[index], rows[index].caption);
    fields[index].blur?.();
    await options.onProgress?.(index + 1);
    if (index < count - 1 && delayMs > 0) {
      await wait(delayMs);
    }
  }
}

function isEditableEmpty(node) {
  return editableValue(node).trim() === "";
}

function editableValue(node) {
  return "value" in node ? String(node.value || "") : String(node.textContent || "");
}

function setEditableValue(node, value) {
  node.focus();
  if ("value" in node) {
    setNativeValue(node, value);
    dispatchTextInputEvents(node, value);
    return;
  }
  // Facebook's contenteditable fields (Lexical editor) revert plain textContent
  // writes; execCommand("insertText") goes through the editor's own input path.
  if (insertTextViaCommand(node, value)) {
    return;
  }
  node.textContent = value;
  dispatchTextInputEvents(node, value);
}

function insertTextViaCommand(node, value) {
  if (typeof document.execCommand !== "function" || typeof window.getSelection !== "function") {
    return false;
  }
  const selection = window.getSelection();
  if (!selection) {
    return false;
  }
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
  try {
    return document.execCommand("insertText", false, value);
  } catch {
    return false;
  }
}

function dispatchTextInputEvents(node, value) {
  node.dispatchEvent(createTextInputEvent("beforeinput", value));
  node.dispatchEvent(createTextInputEvent("input", value));
  node.dispatchEvent(new Event("change", { bubbles: true }));
}

function setNativeValue(node, value) {
  const prototype = Object.getPrototypeOf(node);
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) {
    setter.call(node, value);
  } else {
    node.value = value;
  }
}

function createTextInputEvent(type, value) {
  if (typeof InputEvent === "function") {
    return new InputEvent(type, { bubbles: true, inputType: "insertText", data: value });
  }
  return new Event(type, { bubbles: true });
}

function findButtonByText(labels) {
  const lowerLabels = labels.map((label) => label.toLowerCase());
  const nodes = [...document.querySelectorAll("div[role='button'], button, a[role='button']")];
  return nodes.find((node) => {
    if (!isVisible(node)) {
      return false;
    }
    const text = (node.innerText || node.textContent || "").trim().toLowerCase();
    return lowerLabels.some((label) => text.includes(label));
  });
}

function textSignal(node) {
  return [
    node.getAttribute("aria-label"),
    node.getAttribute("placeholder"),
    node.closest("[aria-label]")?.getAttribute("aria-label"),
    node.innerText,
    node.textContent,
  ]
    .filter(Boolean)
    .join(" ");
}

function isVisible(node) {
  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

async function waitFor(fn, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = fn();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
  globalThis.__fbHelperTestApi = { fillCaptionFields };
}
