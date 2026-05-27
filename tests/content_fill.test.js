import test from "node:test";
import assert from "node:assert/strict";

globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener() {},
    },
  },
};

test("fillCaptionFields fills one field at a time with a delay between captions", async () => {
  process.env.NODE_ENV = "test";
  await import("../src/content.js");
  const { fillCaptionFields } = globalThis.__fbHelperTestApi;
  const calls = [];
  const fields = [createField("first", calls), createField("second", calls), createField("third", calls)];
  const rows = [
    { caption: "Caption A" },
    { caption: "Caption B" },
    { caption: "Caption C" },
  ];
  const waits = [];

  await fillCaptionFields(fields, rows, {
    delayMs: 750,
    wait: async (ms) => waits.push(ms),
  });

  assert.deepEqual(
    calls.filter((call) => call.type === "focus" || call.type === "blur").map((call) => call.type),
    ["focus", "blur", "focus", "blur", "focus", "blur"],
  );
  assert.deepEqual(fields.map((field) => field.value), ["Caption A", "Caption B", "Caption C"]);
  assert.deepEqual(waits, [750, 750]);
});

function createField(name, calls) {
  return {
    value: "",
    focus() {
      calls.push({ name, type: "focus" });
    },
    blur() {
      calls.push({ name, type: "blur" });
    },
    dispatchEvent(event) {
      calls.push({ name, type: event.type });
      return true;
    },
    scrollIntoView() {
      calls.push({ name, type: "scrollIntoView" });
    },
  };
}
