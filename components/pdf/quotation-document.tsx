// React-PDF quotation document. Pure render component (no DB, no server-only) —
// the API route loads data via lib/pdf/quotation-data and renders this to a PDF
// buffer. Layout rebuilt + branded per docs/quotation-template.md; every field
// from the client's original template is preserved.
//
// NOTE: the built-in Helvetica font has no rupee (₹) glyph, so real-brand
// amounts use the "Rs. " prefix (standard on Indian quotations) to render
// reliably. The demo brand's dollar sign IS in Helvetica, so it renders the
// symbol directly — see BRAND.pdfCurrencyPrefix in lib/brand.ts.

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { QuotationData } from "@/lib/pdf/quotation-data";
import { BRAND } from "@/lib/brand";
import { CURRENCY_META } from "@/lib/currency-meta";
import type { CurrencyCode } from "@/types";

// Warm espresso + clay, mirroring --primary / --clay in app/globals.css.
// Kept as literals because react-pdf cannot read CSS custom properties —
// rebranding means changing these AND globals.css (see the note there).
const INK = "#33261C";
const SOFT = "#B4552D";
const GREY = "#555555";
const LIGHT = "#E8E1D8"; // warm hairline, matching --border

// Logo box (client 5-Aug: "increase the size of the logo"). The height is
// DERIVED from the asset's own intrinsic aspect rather than hardcoded, so a
// rebrand or a re-cropped logo.png can't leave a stale letterboxed number
// behind — same approach as components/brand-wordmark.tsx.
const LOGO_WIDTH = 240;
const LOGO_HEIGHT = Math.round(
  (LOGO_WIDTH * BRAND.logoIntrinsic.height) / BRAND.logoIntrinsic.width,
);

/**
 * A quote's own market dressing, or the deployment's when it has none — every
 * quote saved before multi-currency, and every admin/staff quote, so their
 * PDFs render byte-identically to before. A trial's card is priced in its own
 * currency, so there is no divisor to apply to it.
 */
const moneyFor = (currency?: CurrencyCode) => {
  if (!currency || currency === "INR") {
    // INR here means the deployment's own card, which BRAND already dresses
    // (today: the cosmetic dollar skin — see lib/brand.ts).
    return (n: number) =>
      BRAND.pdfCurrencyPrefix +
      (n / BRAND.currencyDivisor).toLocaleString(BRAND.currencyLocale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  }
  const meta = CURRENCY_META[currency];
  return (n: number) =>
    meta.pdfPrefix +
    n.toLocaleString(meta.locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontSize: 9,
    color: "#222222",
    fontFamily: "Helvetica",
    lineHeight: 1.4,
  },
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: INK,
    paddingBottom: 10,
  },
  logo: { width: LOGO_WIDTH, height: LOGO_HEIGHT, objectFit: "contain" },
  companyName: { fontSize: 13, fontFamily: "Helvetica-Bold", color: INK },
  tagline: { fontSize: 8, color: SOFT, fontFamily: "Helvetica-Oblique", marginTop: 2 },
  companyMeta: { fontSize: 7.5, color: GREY, marginTop: 4, maxWidth: 230, textAlign: "right" },
  headerRight: { alignItems: "flex-end" },
  // Title
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: INK,
    letterSpacing: 2,
    marginTop: 16,
    marginBottom: 12,
  },
  // Meta + bill-to row
  infoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 16 },
  infoBlock: { width: "48%" },
  blockLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: SOFT,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  metaLine: { flexDirection: "row", marginBottom: 2 },
  metaKey: { width: 70, color: GREY },
  metaVal: { fontFamily: "Helvetica-Bold" },
  // Table
  table: { marginBottom: 14 },
  tHead: { flexDirection: "row", backgroundColor: INK, color: "#FFFFFF" },
  tHeadCell: { padding: 6, fontSize: 8, fontFamily: "Helvetica-Bold" },
  tRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LIGHT },
  tCell: { padding: 6 },
  cSno: { width: "7%" },
  cDesc: { width: "30%" },
  cSpecs: { width: "33%" },
  cQty: { width: "10%", textAlign: "right" },
  cUnit: { width: "10%", textAlign: "right" },
  cTotal: { width: "10%", textAlign: "right" },
  // Totals
  totalsWrap: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 18 },
  totalsBox: { width: "45%" },
  totalLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  grandLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: INK,
    color: "#FFFFFF",
    marginTop: 2,
  },
  grandText: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  // Sections
  section: { marginBottom: 14 },
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: INK,
    marginBottom: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: LIGHT,
    paddingBottom: 3,
  },
  term: { flexDirection: "row", marginBottom: 2 },
  termBullet: { width: 10, color: SOFT },
  termText: { flex: 1, fontSize: 8, color: GREY },
  // Bank + signatures
  bottomRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  bottomBlock: { width: "48%" },
  bankLine: { fontSize: 8, color: GREY, marginBottom: 1 },
  signRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 40 },
  signBox: { width: "45%", borderTopWidth: 0.5, borderTopColor: "#999999", paddingTop: 4 },
  signLabel: { fontSize: 8, color: GREY },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 7,
    color: "#999999",
    borderTopWidth: 0.5,
    borderTopColor: LIGHT,
    paddingTop: 6,
  },
});

function MetaLine({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.metaLine}>
      <Text style={styles.metaKey}>{k}</Text>
      <Text style={styles.metaVal}>{v}</Text>
    </View>
  );
}

export function QuotationDocument({
  data,
  logo,
}: {
  data: QuotationData;
  logo?: string;
}) {
  const money = moneyFor(data.currency);
  const { company, bank } = data;
  return (
    <Document
      title={`Quotation ${data.quoteNo}`}
      author={company.name}
      subject="Quotation"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            {logo ? (
              <Image style={styles.logo} src={logo} />
            ) : (
              <Text style={styles.companyName}>{company.name}</Text>
            )}
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.companyName}>{company.name}</Text>
            <Text style={styles.tagline}>{company.tagline}</Text>
            <Text style={styles.companyMeta}>{company.address}</Text>
            <Text style={styles.companyMeta}>GSTIN: {company.gstin}</Text>
          </View>
        </View>

        <Text style={styles.title}>QUOTATION</Text>

        {/* Bill To + Meta */}
        <View style={styles.infoRow}>
          <View style={styles.infoBlock}>
            <Text style={styles.blockLabel}>Bill To</Text>
            <Text style={styles.metaVal}>{data.billTo.company}</Text>
            {data.billTo.contact ? (
              <Text style={{ color: GREY }}>{data.billTo.contact}</Text>
            ) : null}
          </View>
          <View style={styles.infoBlock}>
            <MetaLine k="Quotation No." v={data.quoteNo} />
            <MetaLine k="Date" v={data.issueDate} />
            <MetaLine k="Valid Until" v={data.validUntil} />
            <MetaLine k="Prepared By" v={data.preparedBy} />
          </View>
        </View>

        {/* Items table */}
        <View style={styles.table}>
          <View style={styles.tHead}>
            <Text style={[styles.tHeadCell, styles.cSno]}>S.No</Text>
            <Text style={[styles.tHeadCell, styles.cDesc]}>Product Description</Text>
            <Text style={[styles.tHeadCell, styles.cSpecs]}>Size / Specs</Text>
            <Text style={[styles.tHeadCell, styles.cQty]}>Qty</Text>
            <Text style={[styles.tHeadCell, styles.cUnit]}>Unit Price</Text>
            <Text style={[styles.tHeadCell, styles.cTotal]}>Total</Text>
          </View>
          {data.items.map((it) => {
            // Structured spec lines (client 4-Jul format); very old stored
            // quotes may only carry the single-line `specs`.
            const specLines = it.specsLines ?? (it.specs ? [it.specs] : []);
            return (
              <View style={styles.tRow} key={it.sNo}>
                <Text style={[styles.tCell, styles.cSno]}>{it.sNo}</Text>
                <Text style={[styles.tCell, styles.cDesc]}>{it.description}</Text>
                <View style={[styles.tCell, styles.cSpecs]}>
                  {specLines.map((line, i) => (
                    <Text key={i} style={i > 0 ? { marginTop: 1.5, color: GREY } : undefined}>
                      {line}
                    </Text>
                  ))}
                </View>
                <Text style={[styles.tCell, styles.cQty]}>
                  {it.qty.toLocaleString("en-IN")}
                </Text>
                <Text style={[styles.tCell, styles.cUnit]}>{money(it.unitPrice)}</Text>
                <Text style={[styles.tCell, styles.cTotal]}>{money(it.total)}</Text>
              </View>
            );
          })}
        </View>

        {/* One-time charges (client 17-Jun + 8-Jul: explicitly itemized — type,
            quantity, rate — separate from the box prices; 18% GST). */}
        {data.items.some((it) => (it.additionalDetail?.length ?? 0) > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>One-time charges (billed as actuals, 18% GST)</Text>
            {data.items.flatMap((it) =>
              (it.additionalDetail ?? []).map((d, i) => (
                <View style={styles.totalLine} key={`${it.sNo}-${i}`}>
                  <Text style={{ color: GREY }}>
                    {data.items.length > 1 ? `Item ${it.sNo} — ` : ""}
                    {d.label}
                    {d.qty != null && d.rate != null
                      ? ` (${d.qty} × ${money(d.rate)})`
                      : ""}
                  </Text>
                  <Text>{money(d.amount)}</Text>
                </View>
              )),
            )}
          </View>
        )}

        {/* Totals */}
        <View style={styles.totalsWrap}>
          <View style={styles.totalsBox}>
            <View style={styles.totalLine}>
              <Text style={{ color: GREY }}>Sub-total (boxes)</Text>
              <Text>{money(data.subTotal)}</Text>
            </View>
            {data.additionalSubTotal > 0 && (
              <View style={styles.totalLine}>
                <Text style={{ color: GREY }}>Additional charges</Text>
                <Text>{money(data.additionalSubTotal)}</Text>
              </View>
            )}
            {(data.gstLines ?? []).map((g) => (
              <View style={styles.totalLine} key={g.label}>
                <Text style={{ color: GREY }}>{g.label}</Text>
                <Text>{money(g.amount)}</Text>
              </View>
            ))}
            <View style={styles.grandLine}>
              <Text style={styles.grandText}>Grand Total</Text>
              <Text style={styles.grandText}>{money(data.grandTotal)}</Text>
            </View>
          </View>
        </View>

        {/* Additional Notes (round 10) — free text from the preview screen.
            Always in the client's own template; only now enterable. */}
        {data.notes ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Notes</Text>
            {data.notes.split("\n").map((line, i) => (
              <Text style={styles.termText} key={i}>
                {line}
              </Text>
            ))}
          </View>
        ) : null}

        {/* Terms */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Terms & Conditions</Text>
          {data.terms.map((t, i) => (
            <View style={styles.term} key={i}>
              <Text style={styles.termBullet}>•</Text>
              <Text style={styles.termText}>{t}</Text>
            </View>
          ))}
        </View>

        {/* Bank + signatures */}
        <View style={styles.bottomRow}>
          <View style={styles.bottomBlock}>
            <Text style={styles.sectionTitle}>Bank Details</Text>
            <Text style={styles.bankLine}>Account Name: {bank.accountName}</Text>
            <Text style={styles.bankLine}>Bank: {bank.bankName}</Text>
            <Text style={styles.bankLine}>Account No.: {bank.accountNo}</Text>
            <Text style={styles.bankLine}>
              IFSC: {bank.ifsc} · Branch: {bank.branch}
            </Text>
          </View>
        </View>

        <View style={styles.signRow}>
          <View style={styles.signBox}>
            <Text style={styles.signLabel}>Customer Acceptance: Signature & Date</Text>
          </View>
          <View style={styles.signBox}>
            <Text style={styles.signLabel}>For {company.name}</Text>
            <Text style={[styles.signLabel, { marginTop: 2 }]}>
              Authorised Signatory
            </Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          {company.name} · {company.tagline} · This is a computer-generated
          quotation.
        </Text>
      </Page>
    </Document>
  );
}
