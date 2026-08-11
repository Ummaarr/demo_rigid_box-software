// Single source of truth for the company identity: name, tagline, letterhead
// address, GSTIN, bank block, quote-number prefix, currency dressing and the
// wordmark's intrinsic size. Everything that would otherwise be hardcoded across
// the PDF builders, the login page, the sidebar and the app metadata reads here.
//
// PURE ON PURPOSE — no `server-only`, no React. Client components
// (BrandWordmark, app-sidebar, login), server-side PDF builders and the offline
// scripts in /scripts all import it.
//
// Northpack Industries is a placeholder identity for demonstration. The GSTIN is
// the canonical documentation-example number and the bank details are
// deliberately degenerate, so a quotation PDF produced here can never be
// mistaken for a real invoice. Replace this whole block to rebrand.

export interface Brand {
  name: string;
  monogram: string;
  tagline: string;
  address: string;
  gstin: string;
  bank: {
    accountName: string;
    bankName: string;
    accountNo: string;
    ifsc: string;
    branch: string;
  };
  quotePrefix: string;
  emailPlaceholder: string;
  metaDescription: string;
  logoIntrinsic: { width: number; height: number };
  isDemo: boolean;
  currencySymbol: string;
  currencyLocale: string;
  currencyDivisor: number;
  pdfCurrencyPrefix: string;
}

export const BRAND: Brand = {
  name: "Northpack Industries Pvt Ltd",
  monogram: "N",
  // Same words as the lockup in public/brand/logo.png — keep in sync.
  tagline: "Precise | Protective | Practical",
  address: "Plot 42, Industrial Layout, Bengaluru – 560058, Karnataka, India",
  gstin: "29AAAAA0000A1Z5",
  bank: {
    accountName: "Northpack Industries Pvt Ltd",
    bankName: "SAMPLE BANK",
    accountNo: "00000000000000",
    ifsc: "SMPL0000000",
    branch: "Bengaluru",
  },
  quotePrefix: "NPI",
  emailPlaceholder: "you@northpack.example",
  metaDescription: "Rigid box cost estimation — demo environment with sample data.",
  logoIntrinsic: { width: 1004, height: 591 },
  isDemo: true,
  // Cosmetic only (client request, 2026-08-01): every price shows in dollars
  // for the demo. Nothing is recalculated or written back — the stored numbers
  // stay the rupee figures the engine produced; the glyph, digit grouping and
  // a render-time divisor are all that change.
  currencySymbol: "$",
  currencyLocale: "en-US",
  // 1 = show the stored figures as-is under a dollar sign.
  //
  // Set this to ~83 (INR/USD) for an honest conversion — but that was tried and
  // deliberately reverted, because it works against what the demo is for:
  //   price/box   $56.68     -> $0.68
  //   quote total $56,675.70 -> $682.84
  //   total quoted $966,618  -> $11,646
  // A 68-cent box and a $683 order read as trivial; at 1, the same data reads
  // as a credible luxury-packaging order. Dividing also costs precision — a
  // 2-decimal unit price of $0.68 x 1,000 no longer matches the printed total
  // (0.4% drift, vs 0.008% undivided), which is visible on the quote PDF.
  currencyDivisor: 1,
  pdfCurrencyPrefix: "$",
};
