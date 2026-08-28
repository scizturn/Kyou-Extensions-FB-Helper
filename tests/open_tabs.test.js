import test from "node:test";
import assert from "node:assert/strict";

import { appendItemIds, collectItemTabs, parseKyouItemIdFromUrl } from "../src/lib.js";

test("parseKyouItemIdFromUrl only accepts Kyou item URLs", () => {
  assert.equal(parseKyouItemIdFromUrl("https://kyou.id/items/112549"), "112549");
  assert.equal(parseKyouItemIdFromUrl("https://www.kyou.id/items/169575?ref=wa"), "169575");
  assert.equal(parseKyouItemIdFromUrl("https://www.facebook.com/photo?fbid=122334455"), "");
  assert.equal(parseKyouItemIdFromUrl("https://kyou.id/categories/112549"), "");
  assert.equal(parseKyouItemIdFromUrl(undefined), "");
});

test("collectItemTabs keeps tab order and drops duplicates", () => {
  const tabs = [
    { url: "https://kyou.id/items/112549", title: "Kemeja - Kyou" },
    { url: "https://www.facebook.com/media/set/?set=a.998877", title: "Album" },
    { url: "https://kyou.id/items/169575", title: "Celana - Kyou" },
    { url: "https://www.kyou.id/items/112549", title: "Kemeja duplicate tab" },
    {},
  ];
  assert.deepEqual(collectItemTabs(tabs), [
    { itemId: "112549", title: "Kemeja - Kyou", url: "https://kyou.id/items/112549" },
    { itemId: "169575", title: "Celana - Kyou", url: "https://kyou.id/items/169575" },
  ]);
  assert.deepEqual(collectItemTabs(null), []);
});

test("appendItemIds adds only new ids and keeps what staff typed", () => {
  const existing = "112549\nhttps://kyou.id/items/156998\n";
  const { text, added } = appendItemIds(existing, ["156998", "169575", "169575"]);
  assert.deepEqual(added, ["169575"]);
  assert.equal(text, "112549\nhttps://kyou.id/items/156998\n169575");
});

test("appendItemIds fills an empty textarea without a leading blank line", () => {
  const { text, added } = appendItemIds("", ["112549", "169575"]);
  assert.deepEqual(added, ["112549", "169575"]);
  assert.equal(text, "112549\n169575");
});
