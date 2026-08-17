// React-PDF raw-material output sheet (client's own "Raw material output
// sheet" template, shared 21-Jul). Quantities + nesting diagrams ONLY — no
// costs anywhere, so the sheet goes straight to the floor/purchase team.
//
// Layout follows her template: a header, the Kappa board block, Wrapping
// organised by component (Outer + Inner + Finishing), then Additions. Every
// material block is two-column — details on the left, the nesting diagram on
// the right, in a bordered card. Branding (espresso/clay, logo, tagline) is kept
// from the quotation document. Pure render: all layout math arrives in
// MaterialsData (lib/pdf/materials-data.ts). Text stays outside the Svg.

import {
  Document,
  Image,
  Line,
  Page,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import { VB, diagramScale, fmtIn } from "@/lib/nesting/geometry";
import { BRAND } from "@/lib/brand";
import type {
  MaterialBlock,
  MaterialsData,
  OutputItem,
  PdfDiagram,
  PdfKeyline,
} from "@/lib/pdf/materials-data";

// Warm espresso + clay, mirroring --primary / --clay in app/globals.css.
// Kept as literals because react-pdf cannot read CSS custom properties —
// rebranding means changing these AND globals.css (see the note there).
const INK = "#33261C";
const SOFT = "#B4552D";
const GREY = "#555555";
const LIGHT = "#E8E1D8"; // warm hairline, matching --border

// Diagram column width in pt; the 320×180 viewBox scales into it.
const DIAG_W = 250;
const DIAG_H = (DIAG_W * VB.H) / VB.W;

// Logo box — matches the quotation document (client 5-Aug), height derived from
// the asset's own intrinsic aspect so it can't drift from the artwork.
const LOGO_WIDTH = 240;
const LOGO_HEIGHT = Math.round(
  (LOGO_WIDTH * BRAND.logoIntrinsic.height) / BRAND.logoIntrinsic.width,
);

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 40,
    fontSize: 9,
    color: "#222222",
    fontFamily: "Helvetica",
    lineHeight: 1.35,
  },
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
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", color: INK, letterSpacing: 1, marginTop: 12, marginBottom: 5 },
  subTitle: { fontSize: 10, color: GREY, marginBottom: 8 },
  // Header field grid
  headerGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  headerItem: { flexDirection: "row", width: "50%", marginBottom: 2 },
  headerKey: { color: GREY, width: 155, flexShrink: 0 },
  headerVal: { fontFamily: "Helvetica-Bold", flex: 1 },
  specLine: { fontSize: 8, color: GREY },
  // Headings
  h1: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: INK,
    marginTop: 14,
    marginBottom: 4,
    borderBottomWidth: 1.5,
    borderBottomColor: SOFT,
    paddingBottom: 2,
  },
  componentLabel: { fontSize: 10, fontFamily: "Helvetica-Bold", color: INK, marginTop: 8, marginBottom: 2 },
  wrapSide: { fontSize: 9, fontFamily: "Helvetica-Bold", color: GREY, marginTop: 4, marginBottom: 2 },
  // Two-column block card
  card: {
    flexDirection: "row",
    borderWidth: 0.7,
    borderColor: LIGHT,
    borderRadius: 3,
    marginTop: 4,
    marginBottom: 2,
  },
  cardLeft: { width: "40%", padding: 6, borderRightWidth: 0.7, borderRightColor: LIGHT },
  cardRight: { width: "60%", padding: 6, alignItems: "center", justifyContent: "center" },
  blockHeading: { fontSize: 9, fontFamily: "Helvetica-Bold", color: INK, marginBottom: 3 },
  detailRow: { flexDirection: "row", marginBottom: 1.5 },
  detailKey: { color: GREY, width: 74, fontSize: 8.5 },
  detailVal: { fontFamily: "Helvetica-Bold", flex: 1, fontSize: 8.5 },
  totalLine: { fontSize: 9, fontFamily: "Helvetica-Bold", color: INK, marginTop: 4 },
  diagramCaption: { fontSize: 7, color: GREY, marginTop: 2, textAlign: "center" },
  legendRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 2, justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", marginRight: 8, marginBottom: 1 },
  legendSwatch: { width: 6, height: 6, marginRight: 3, borderRadius: 1 },
  legendText: { fontSize: 6.5, color: GREY, textTransform: "capitalize" },
  // Finishing table
  finTable: { marginTop: 3, borderWidth: 0.7, borderColor: LIGHT, borderRadius: 3 },
  finRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LIGHT },
  finKind: { width: "30%", padding: 3, fontSize: 8, fontFamily: "Helvetica-Bold", color: GREY },
  finType: { width: "40%", padding: 3, fontSize: 8 },
  finArea: { width: "30%", padding: 3, fontSize: 8 },
  finTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: INK, marginTop: 3 },
  // Lists
  listRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: LIGHT },
  listPhoto: { width: 34, height: 34, objectFit: "contain", marginRight: 6, borderWidth: 0.5, borderColor: LIGHT, borderRadius: 2 },
  keylineWrap: { flexDirection: "row", flexWrap: "wrap", marginTop: 2 },
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

/** A nesting diagram scaled into the right column of a card. */
function Diagram({ d }: { d: PdfDiagram }) {
  const scale = diagramScale(d.sheetW_in, d.sheetH_in);
  const sW = d.sheetW_in * scale;
  const sH = d.sheetH_in * scale;
  return (
    <View style={{ marginBottom: 3 }}>
      <Svg width={DIAG_W} height={DIAG_H} viewBox={`0 0 ${VB.W} ${VB.H}`}>
        <Rect x={VB.ML} y={VB.MT} width={sW} height={sH} fill="white" stroke={INK} strokeWidth={1.5} />
        {d.rects.map((r, i) => (
          <Rect
            key={i}
            x={VB.ML + r.x_in * scale}
            y={VB.MT + r.y_in * scale}
            width={r.w_in * scale}
            height={r.h_in * scale}
            fill={r.colour}
            fillOpacity={r.fillOpacity}
            stroke={r.colour}
            strokeWidth={0.7}
          />
        ))}
        {d.creases.map((c, i) => (
          <Line
            key={`c-${i}`}
            x1={VB.ML + c.x1 * scale}
            y1={VB.MT + c.y1 * scale}
            x2={VB.ML + c.x2 * scale}
            y2={VB.MT + c.y2 * scale}
            stroke={c.colour}
            strokeWidth={0.4}
            strokeDasharray="3 2"
            opacity={0.5}
          />
        ))}
      </Svg>
      <Text style={styles.diagramCaption}>{d.caption}</Text>
      {d.legend && d.legend.length > 0 && (
        <View style={styles.legendRow}>
          {d.legend.map((l, i) => (
            <View key={i} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: l.colour, opacity: 0.55 }]} />
              <Text style={styles.legendText}>{l.label}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Finishing table (optional add-ons), matching her template. */
function FinishingTable({ lines }: { lines: NonNullable<MaterialBlock["finishing"]> }) {
  if (!lines.length) return null;
  return (
    <View>
      <Text style={styles.finTitle}>Finishing (optional add-ons)</Text>
      <View style={styles.finTable}>
        {lines.map((f, i) => (
          <View key={i} style={styles.finRow}>
            <Text style={styles.finKind}>{f.label}</Text>
            <Text style={styles.finType}>{f.type}</Text>
            <Text style={styles.finArea}>{f.area ? `Area: ${f.area}` : ""}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A two-column material block (details left, diagram(s) right). */
function Block({ block }: { block: MaterialBlock }) {
  return (
    <View wrap={false}>
      <View style={styles.card}>
        <View style={styles.cardLeft}>
          <Text style={styles.blockHeading}>{block.heading}</Text>
          {block.lines.map((l, i) => (
            <View key={i} style={styles.detailRow}>
              {l.label ? <Text style={styles.detailKey}>{l.label}</Text> : null}
              <Text style={styles.detailVal}>{l.value}</Text>
            </View>
          ))}
          {block.total ? (
            <Text style={styles.totalLine}>Sheets: {block.total}</Text>
          ) : null}
          {block.note ? <Text style={[styles.diagramCaption, { textAlign: "left", marginTop: 3 }]}>{block.note}</Text> : null}
        </View>
        <View style={styles.cardRight}>
          {block.diagrams.map((d, i) => (
            <Diagram key={i} d={d} />
          ))}
        </View>
      </View>
      {block.finishing && block.finishing.length > 0 && <FinishingTable lines={block.finishing} />}
    </View>
  );
}

function Keylines({ keylines }: { keylines: PdfKeyline[] }) {
  return (
    <View>
      <Text style={styles.componentLabel}>Keylines</Text>
      <View style={styles.keylineWrap}>
        {keylines.map((k, i) => {
          const scale = diagramScale(k.blankW_in, k.blankH_in);
          return (
            <View key={i} style={{ width: "33%", marginBottom: 4, alignItems: "center" }} wrap={false}>
              <Svg width={DIAG_W * 0.6} height={DIAG_H * 0.6} viewBox={`0 0 ${VB.W} ${VB.H}`}>
                <Rect x={VB.ML} y={VB.MT} width={k.blankW_in * scale} height={k.blankH_in * scale} fill="white" stroke={INK} strokeWidth={1.5} />
                {k.creases.map((c, j) => (
                  <Line
                    key={j}
                    x1={VB.ML + c.x1 * scale}
                    y1={VB.MT + c.y1 * scale}
                    x2={VB.ML + c.x2 * scale}
                    y2={VB.MT + c.y2 * scale}
                    stroke={SOFT}
                    strokeWidth={0.6}
                    strokeDasharray="3 2"
                  />
                ))}
              </Svg>
              <Text style={styles.diagramCaption}>{k.component} · {k.size}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function Item({ item }: { item: OutputItem }) {
  switch (item.kind) {
    case "heading":
      return <Text style={styles.h1} minPresenceAhead={90}>{item.text}</Text>;
    case "block":
      return <Block block={item.block} />;
    case "keylines":
      return <Keylines keylines={item.keylines} />;
    case "componentWrap":
      return (
        <View>
          <Text style={styles.componentLabel} minPresenceAhead={60}>Component: {item.component}</Text>
          {item.outer && (
            <>
              <Text style={styles.wrapSide}>Outer wrap</Text>
              <Block block={item.outer} />
            </>
          )}
          {item.inner && (
            <>
              <Text style={styles.wrapSide}>Inner wrap</Text>
              <Block block={item.inner} />
            </>
          )}
        </View>
      );
    case "list":
      return (
        <View wrap={false}>
          <Text style={styles.componentLabel}>{item.heading}</Text>
          {item.rows.map((r, i) => (
            <View key={i} style={styles.listRow}>
              <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                {r.image ? <Image style={styles.listPhoto} src={r.image} /> : null}
                <Text>{r.label}</Text>
              </View>
              <Text style={{ fontFamily: "Helvetica-Bold" }}>{r.value}</Text>
            </View>
          ))}
        </View>
      );
  }
}

export function MaterialsDocument({ data, logo }: { data: MaterialsData; logo?: string }) {
  return (
    <Document
      title={`Raw material output sheet — ${data.title}`}
      author={data.company.name}
      subject="Raw material requirement"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            {logo ? <Image style={styles.logo} src={logo} /> : <Text style={styles.companyName}>{data.company.name}</Text>}
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.companyName}>{data.company.name}</Text>
            <Text style={styles.tagline}>{data.company.tagline}</Text>
          </View>
        </View>

        <Text style={styles.title}>RAW MATERIAL OUTPUT SHEET</Text>
        <Text style={styles.subTitle}>{data.title}</Text>

        <View style={styles.headerGrid}>
          {data.header.map((h, i) => (
            <View key={i} style={styles.headerItem}>
              <Text style={styles.headerKey}>{h.label}:</Text>
              <Text style={styles.headerVal}>{h.value || "—"}</Text>
            </View>
          ))}
        </View>
        {data.specLines.map((line, i) => (
          <Text key={i} style={styles.specLine}>{line}</Text>
        ))}

        {data.items.map((item, i) => (
          <Item key={i} item={item} />
        ))}

        <Text style={styles.footer} fixed>{data.company.name}</Text>
      </Page>
    </Document>
  );
}
