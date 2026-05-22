import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDownloadRequest,
  buildDownloadFilename,
  isMissingContentScriptError,
  normalizeStaffTabOptions,
  normalizeWarnings,
} from "../src/lib.js";

test("normalizeStaffTabOptions keeps valid label and value pairs", () => {
  assert.deepEqual(
    normalizeStaffTabOptions([
      { label: "FB - Helper - REGA", value: "FB - Helper - REGA" },
      { label: "Broken" },
      { value: "FB - Helper - TEGAR" },
    ]),
    [
      { label: "FB - Helper - REGA", value: "FB - Helper - REGA" },
      { label: "FB - Helper - TEGAR", value: "FB - Helper - TEGAR" },
    ],
  );
});

test("isMissingContentScriptError detects Chrome missing receiver errors", () => {
  assert.equal(
    isMissingContentScriptError(new Error("Could not establish connection. Receiving end does not exist.")),
    true,
  );
  assert.equal(isMissingContentScriptError(new Error("Facebook file input did not appear.")), false);
});

test("buildDownloadFilename keeps item order and stable extension", () => {
  assert.equal(
    buildDownloadFilename({ itemId: "182534", status: "RS", imageUrl: "https://cdn.example/miku.webp?x=1" }, 0),
    "kyou-fb-upload/001-RS-182534.webp",
  );
  assert.equal(
    buildDownloadFilename({ itemId: "118147", status: "PO", imageUrl: "https://cdn.example/no-ext" }, 1),
    "kyou-fb-upload/002-PO-118147.jpg",
  );
  assert.equal(
    buildDownloadFilename({ itemId: "123456", status: "", imageUrl: "https://cdn.example/no-ext" }, 2),
    "kyou-fb-upload/003-NA-123456.jpg",
  );
});

test("buildDownloadRequest forces stable filenames for repeat downloads", () => {
  assert.deepEqual(
    buildDownloadRequest({ itemId: "182534", status: "RS", imageUrl: "https://cdn.example/miku.jpg" }, 0),
    {
      url: "https://cdn.example/miku.jpg",
      filename: "kyou-fb-upload/001-RS-182534.jpg",
      conflictAction: "overwrite",
      saveAs: false,
    },
  );
});

test("normalizeWarnings keeps non-empty string warnings", () => {
  assert.deepEqual(normalizeWarnings(["Removed DB NO EXIST: 112549", "", null, "Shelving rank unavailable"]), [
    "Removed DB NO EXIST: 112549",
    "Shelving rank unavailable",
  ]);
});
