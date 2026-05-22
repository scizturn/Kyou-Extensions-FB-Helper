import test from "node:test";
import assert from "node:assert/strict";

import { createJobState, updateJobState } from "../src/lib.js";

test("createJobState stores rows and initial progress for resumable popup state", () => {
  const rows = [
    { itemId: "112549", imageUrl: "https://img.example/a.jpg", caption: "Caption A" },
    { itemId: "169575", imageUrl: "https://img.example/b.jpg", caption: "Caption B" },
  ];

  const state = createJobState({ itemIds: ["112549", "169575"], rows }, "2026-05-22T01:02:03.000Z");

  assert.deepEqual(state, {
    jobId: "2026-05-22T01:02:03.000Z",
    status: "preview_ready",
    itemIds: ["112549", "169575"],
    rows,
    currentIndex: 0,
    error: "",
    updatedAt: "2026-05-22T01:02:03.000Z",
  });
});

test("updateJobState changes status while preserving rows", () => {
  const state = createJobState(
    {
      itemIds: ["112549"],
      rows: [{ itemId: "112549", imageUrl: "https://img.example/a.jpg", caption: "Caption A" }],
    },
    "2026-05-22T01:02:03.000Z",
  );

  assert.deepEqual(updateJobState(state, { status: "uploading", currentIndex: 1 }, "2026-05-22T01:03:00.000Z"), {
    ...state,
    status: "uploading",
    currentIndex: 1,
    updatedAt: "2026-05-22T01:03:00.000Z",
  });
});
