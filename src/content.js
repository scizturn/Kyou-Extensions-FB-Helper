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

  fillVisibleCaptions(message.rows)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

const DEFAULT_CAPTION_FILL_DELAY_MS = 750;

async function fillVisibleCaptions(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No prepared rows received.");
  }

  await updateJob({ status: "caption_filling", currentIndex: 0 });
  const fields = await waitForEmptyCaptionFields(rows.length);
  if (fields.length < rows.length) {
    throw new Error(
      `Could not find enough empty Facebook description fields. Found ${fields.length}/${rows.length}. Upload the downloaded images first, then try Fill captions.`,
    );
  }
  await fillCaptionFields(fields, rows, {
    delayMs: DEFAULT_CAPTION_FILL_DELAY_MS,
    onProgress: (currentIndex) => updateJob({ status: "caption_filling", currentIndex }),
  });
  await updateJob({ status: "done", currentIndex: rows.length, error: "" });

  return {
    ok: true,
    message: `Filled ${rows.length} captions. Review before saving.`,
  };
}

async function updateJob(patch) {
  try {
    await chrome.runtime.sendMessage({ type: "UPDATE_JOB_STATE", patch });
  } catch {
    // The Facebook fill should continue even if state update fails.
  }
}

async function waitForEmptyCaptionFields(expectedCount) {
  const fields = await waitFor(() => {
    const found = findCaptionFields().filter(isEditableEmpty);
    return found.length >= expectedCount ? found : null;
  }, 30000);
  return fields || findCaptionFields().filter(isEditableEmpty);
}

function findCaptionFields() {
  const candidates = [
    ...document.querySelectorAll("textarea"),
    ...document.querySelectorAll("[contenteditable='true'][role='textbox']"),
    ...document.querySelectorAll("[contenteditable='true'][aria-label]"),
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
  } else {
    node.textContent = value;
  }
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
