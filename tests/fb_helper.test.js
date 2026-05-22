import test from "node:test";
import assert from "node:assert/strict";

import {
  buildKyouItemUrl,
  formatCaption,
  parseItemIds,
  parseKyouItemHtml,
  validateRows,
} from "../src/lib.js";

test("parseItemIds keeps unique ids in input order", () => {
  const raw = `
    112549
    https://kyou.id/items/169575, 156998
    item 112549
    https://www.kyou.id/items/149639?x=1
  `;

  assert.deepEqual(parseItemIds(raw), ["112549", "169575", "156998", "149639"]);
});

test("buildKyouItemUrl creates canonical item page urls", () => {
  assert.equal(buildKyouItemUrl("112549"), "https://kyou.id/items/112549");
});

test("parseKyouItemHtml extracts title, image, price text, and description", () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="Rurouni Kenshin Ichiban Kuji Figure">
        <meta property="og:image" content="https://cdn.example/kenshin.jpg">
        <meta name="description" content="Harga Normal: IDR 1,050,000 | Harga Sanno Matsuri SALE : IDR 919.000">
      </head>
      <body>
        <script type="application/ld+json">
          {"name":"Fallback","image":"https://cdn.example/fallback.jpg","offers":{"priceCurrency":"IDR","price":"919000"}}
        </script>
      </body>
    </html>
  `;

  assert.deepEqual(parseKyouItemHtml(html, "112549"), {
    itemId: "112549",
    title: "Rurouni Kenshin Ichiban Kuji Figure",
    imageUrl: "https://cdn.example/kenshin.jpg",
    priceText: "Harga Normal: IDR 1,050,000\nHarga Sanno Matsuri SALE : IDR 919.000",
    sourceUrl: "https://kyou.id/items/112549",
  });
});

test("formatCaption produces the Facebook album caption format", () => {
  const caption = formatCaption({
    itemId: "112549",
    title: "Rurouni Kenshin Ichiban Kuji Figure",
    priceText: "Harga Normal: IDR 1,050,000\nHarga Sanno Matsuri SALE : IDR 919.000",
    sourceUrl: "https://kyou.id/items/112549",
  });

  assert.equal(
    caption,
    "Rurouni Kenshin Ichiban Kuji Figure\n\nHarga Normal: IDR 1,050,000\nHarga Sanno Matsuri SALE : IDR 919.000\n\nBelanja ngga ribet di Kyou.id!\nhttps://kyou.id/items/112549",
  );
});

test("validateRows reports missing images and captions", () => {
  const rows = [
    { itemId: "112549", imageUrl: "https://cdn.example/a.jpg", caption: "Caption A" },
    { itemId: "169575", imageUrl: "", caption: "Caption B" },
    { itemId: "156998", imageUrl: "https://cdn.example/c.jpg", caption: "" },
  ];

  assert.deepEqual(validateRows(rows), {
    ready: [rows[0]],
    problems: [
      { itemId: "169575", problem: "image missing" },
      { itemId: "156998", problem: "caption missing" },
    ],
  });
});
