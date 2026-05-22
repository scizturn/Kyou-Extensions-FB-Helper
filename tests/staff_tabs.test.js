import test from "node:test";
import assert from "node:assert/strict";

import { normalizeStaffTabOptions } from "../src/lib.js";

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
