chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "FB_HELPER_FILL_ALBUM") {
    return false;
  }

  fillAlbum(message.rows)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

async function fillAlbum(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No prepared rows received.");
  }

  const input = await findOrOpenFileInput();
  const existingFields = new Set(findCaptionFields());
  await updateJob({ status: "downloading", currentIndex: 0, error: "" });
  const files = [];
  for (let index = 0; index < rows.length; index += 1) {
    files.push(await rowToFile(rows[index]));
    await updateJob({ status: "downloading", currentIndex: index + 1 });
  }
  const transfer = new DataTransfer();
  for (const file of files) {
    transfer.items.add(file);
  }

  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  await updateJob({ status: "caption_filling", currentIndex: 0 });
  const fields = await waitForNewCaptionFields(existingFields, rows.length);
  if (fields.length < rows.length) {
    throw new Error(
      `Facebook did not create enough new description fields after upload. Found ${fields.length}/${rows.length}.`,
    );
  }
  fillCaptionFields(fields, rows);
  await updateJob({ status: "done", currentIndex: rows.length, error: "" });

  return {
    ok: true,
    message: `Uploaded ${files.length} image files and filled ${rows.length} captions. Review before saving.`,
  };
}

async function updateJob(patch) {
  try {
    await chrome.runtime.sendMessage({ type: "UPDATE_JOB_STATE", patch });
  } catch {
    // The Facebook fill should continue even if state update fails.
  }
}

async function findOrOpenFileInput() {
  let input = findFileInput();
  if (input) {
    return input;
  }

  const button = findButtonByText(["Upload photos or videos", "Add photos/videos", "Upload"]);
  if (!button) {
    throw new Error("Could not find Facebook upload button.");
  }
  button.click();
  input = await waitFor(findFileInput, 8000);
  if (!input) {
    throw new Error("Facebook file input did not appear.");
  }
  return input;
}

function findFileInput() {
  const inputs = [...document.querySelectorAll("input[type='file']")];
  return inputs.find((input) => {
    const accept = String(input.accept || "").toLowerCase();
    return input.multiple || accept.includes("image") || accept.includes("video");
  });
}

async function rowToFile(row) {
  const response = await fetch(row.imageUrl, { credentials: "omit" });
  if (!response.ok) {
    throw new Error(`${row.itemId}: image download failed HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const extension = extensionFromType(blob.type) || extensionFromUrl(row.imageUrl) || "jpg";
  return new File([blob], `${row.itemId}.${extension}`, {
    type: blob.type || "image/jpeg",
  });
}

async function waitForNewCaptionFields(existingFields, expectedCount) {
  const fields = await waitFor(() => {
    const found = findCaptionFields().filter((field) => !existingFields.has(field));
    return found.length >= expectedCount ? found : null;
  }, 30000);
  return fields || findCaptionFields().filter((field) => !existingFields.has(field));
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

function fillCaptionFields(fields, rows) {
  const count = Math.min(fields.length, rows.length);
  for (let index = 0; index < count; index += 1) {
    setEditableValue(fields[index], rows[index].caption);
  }
}

function setEditableValue(node, value) {
  node.focus();
  if ("value" in node) {
    node.value = value;
  } else {
    node.textContent = value;
  }
  node.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: value }));
  node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  node.dispatchEvent(new Event("change", { bubbles: true }));
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

function extensionFromType(type) {
  const normalized = String(type || "").split(";")[0].trim().toLowerCase();
  if (normalized === "image/jpeg") {
    return "jpg";
  }
  if (normalized === "image/png") {
    return "png";
  }
  if (normalized === "image/webp") {
    return "webp";
  }
  return "";
}

function extensionFromUrl(url) {
  const match = String(url || "").match(/\.([a-z0-9]{3,4})(?:[?#]|$)/i);
  return match ? match[1].toLowerCase() : "";
}
