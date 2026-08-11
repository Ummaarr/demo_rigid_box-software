// Phase 8 render verification: render the QuotationDocument to a PDF file with
// synthetic data and confirm it's a valid PDF. Render-only — imports NO
// server-only modules, so it runs with the full (client) React build that
// @react-pdf/renderer's reconciler needs. Do NOT pass --conditions=react-server
// here (that selects React's RSC build and breaks the reconciler).
//
// The data layer (buildQuotationData) is verified separately by the route /
// scripts/estimate-from-db pattern; this proves the PDF layout renders.
//
// Run:  npx tsx scripts/verify-quote.ts

import { createElement } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderToBuffer } from "@react-pdf/renderer";

import { QuotationDocument } from "@/components/pdf/quotation-document";
// Type-only import is erased at runtime, so this does NOT pull in server-only.
import type { QuotationData } from "@/lib/pdf/quotation-data";
// lib/brand.ts is pure (no server-only), so the letterhead can come from the
// real source instead of being duplicated here — this fixture used to carry its
// own copy of COMPANY/BANK and could silently drift from the shipping values.
import { BRAND } from "@/lib/brand";

function loadLogo(): string | undefined {
  try {
    const buf = readFileSync(join(process.cwd(), "public", "brand", "logo.png"));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

const sub = 45510;
const addl = 3500;
const gst = sub * 0.05;
const addlGst = addl * 0.18;
const data: QuotationData = {
  quoteNo: `${BRAND.quotePrefix}/26-27/001`,
  issueDate: "17 Jun 2026",
  validUntil: "02 Jul 2026",
  preparedBy: "Admin User",
  billTo: { company: "Acme Luxury Packaging", contact: "Priya Nair" },
  items: [
    {
      sNo: 1,
      description: "Telescopic box",
      specsLines: [
        "1.5 mm kappa board · 10 × 8 × 4 in",
        "Outer: art paper 130 GSM · multicolour offset print (18x25) · matte lamination · foiling gold (matte)",
        "Inner: white paper 120 GSM",
        "Inserts & add-ons: XLPE foam 20 mm, 9 × 7 in (art-paper cover, printed) · Sleeve",
      ],
      qty: 500,
      unitPrice: 91.02,
      total: sub,
      additionalDetail: [
        { label: "Die", qty: 2, rate: 1500, amount: 3000 },
        { label: "Designer", amount: 500 },
      ],
      additionalTotal: addl,
    },
  ],
  subTotal: sub,
  additionalSubTotal: addl,
  gstLines: [
    { label: "GST @ 5% (boxes)", pct: 5, base: sub, amount: gst },
    { label: "GST @ 18% (additional charges)", pct: 18, base: addl, amount: addlGst },
  ],
  grandTotal: sub + addl + gst + addlGst,
  terms: [
    "Payment Terms: 50% advance upon order confirmation; balance before dispatch",
    "Lead Time: 15 working days from order confirmation and advance payment",
    "Validity: This quotation is valid for 15 days from the date of issue",
  ],
  company: {
    name: BRAND.name,
    tagline: BRAND.tagline,
    address: BRAND.address,
    gstin: BRAND.gstin,
  },
  bank: BRAND.bank,
};

async function main() {
  const logo = loadLogo();
  console.log(`Logo: ${logo ? "embedded" : "MISSING (text fallback)"}`);

  const buffer = await renderToBuffer(
    createElement(QuotationDocument, { data, logo }) as unknown as Parameters<
      typeof renderToBuffer
    >[0],
  );

  const out = join(process.cwd(), "tmp-quote.pdf");
  writeFileSync(out, buffer);

  const header = buffer.subarray(0, 5).toString("latin1");
  console.log("\n--- PDF ---");
  console.log(`  File:   ${out}`);
  console.log(`  Size:   ${(buffer.length / 1024).toFixed(1)} KB`);
  console.log(
    `  Header: ${header} ${header === "%PDF-" ? "(valid)" : "(INVALID)"}`,
  );
  if (header !== "%PDF-") process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
