// Shared keyline SVG primitives. Box-type keyline components (one file each)
// build a list of panels — each panel a set of X and Y segments (in inches) —
// and hand them to <KeylineDiagram>, which scales them consistently and draws:
//   - the flat blank rectangle (solid navy)
//   - internal fold lines (dashed) at each segment boundary
//   - the segment dimensions (inches) along the top + left edges
//   - the component name + overall blank size
//
// Pure/presentational (no state, no DB) so it renders on the server and inside
// client forms alike. Segments come from the box-type formula structure; a test
// (scripts/keylines-check.ts) asserts each panel's segment sums equal the
// engine's blank dimensions, so the drawing and the cost can never drift.

import type { ReactElement } from "react";

export interface KeylineSegment {
  label: string; // variable name (H, L, W, BH, …) — for aria/debug
  length: number; // inches
}

export interface KeylinePanelData {
  component: string; // display name, e.g. "Tray"
  x: KeylineSegment[]; // left -> right (sums to blank width)
  y: KeylineSegment[]; // top -> bottom (sums to blank height)
}

/** Terse constructor: seg("H", 4). */
export const seg = (label: string, length: number): KeylineSegment => ({
  label,
  length,
});

const TARGET_PX = 190; // the largest panel edge maps to ~this many px
const MIN_SCALE = 5;
const MAX_SCALE = 26;

const sumLen = (segs: KeylineSegment[]) =>
  segs.reduce((s, seg) => s + seg.length, 0);

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** Cumulative inch positions of segment boundaries (includes the total). */
function cumulative(segs: KeylineSegment[]): number[] {
  const edges: number[] = [];
  let acc = 0;
  for (const s of segs) {
    acc += s.length;
    edges.push(acc);
  }
  return edges;
}

function KeylinePanel({
  data,
  scale,
}: {
  data: KeylinePanelData;
  scale: number;
}) {
  const wIn = sumLen(data.x);
  const hIn = sumLen(data.y);
  const wPx = wIn * scale;
  const hPx = hIn * scale;

  const padL = 28; // room for Y dimension labels
  const padT = 20; // room for X dimension labels
  const padR = 12;
  const padB = 12;
  const svgW = padL + wPx + padR;
  const svgH = padT + hPx + padB;

  const xFolds = cumulative(data.x).slice(0, -1); // internal only
  const yFolds = cumulative(data.y).slice(0, -1);

  let accX = 0;
  const xLabels = data.x.map((s) => {
    const center = accX + s.length / 2;
    accX += s.length;
    return { center, seg: s };
  });
  let accY = 0;
  const yLabels = data.y.map((s) => {
    const center = accY + s.length / 2;
    accY += s.length;
    return { center, seg: s };
  });

  return (
    <figure className="flex flex-col items-center gap-1.5">
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        role="img"
        aria-label={`${data.component} blank ${fmt(wIn)} by ${fmt(hIn)} inches`}
      >
        <rect
          x={padL}
          y={padT}
          width={wPx}
          height={hPx}
          className="fill-card stroke-primary"
          strokeWidth={1.5}
        />
        {xFolds.map((e, i) => (
          <line
            key={`xf${i}`}
            x1={padL + e * scale}
            y1={padT}
            x2={padL + e * scale}
            y2={padT + hPx}
            className="stroke-muted-foreground/50"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        ))}
        {yFolds.map((e, i) => (
          <line
            key={`yf${i}`}
            x1={padL}
            y1={padT + e * scale}
            x2={padL + wPx}
            y2={padT + e * scale}
            className="stroke-muted-foreground/50"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        ))}
        {xLabels.map((l, i) => (
          <text
            key={`xl${i}`}
            x={padL + l.center * scale}
            y={padT - 7}
            textAnchor="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {fmt(l.seg.length)}
          </text>
        ))}
        {yLabels.map((l, i) => (
          <text
            key={`yl${i}`}
            x={padL - 7}
            y={padT + l.center * scale}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted-foreground"
            fontSize={10}
          >
            {fmt(l.seg.length)}
          </text>
        ))}
      </svg>
      <figcaption className="text-center">
        <div className="text-xs font-medium text-foreground">
          {data.component}
        </div>
        <div className="text-[0.7rem] text-muted-foreground">
          {fmt(wIn)} × {fmt(hIn)} in
        </div>
      </figcaption>
    </figure>
  );
}

export function KeylineDiagram({
  boxLabel,
  panels,
}: {
  boxLabel: string;
  panels: KeylinePanelData[];
}): ReactElement {
  const maxInch = Math.max(
    ...panels.flatMap((p) => [sumLen(p.x), sumLen(p.y)]),
    1,
  );
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, TARGET_PX / maxInch));

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">{boxLabel}</h3>
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        {panels.map((p, i) => (
          <KeylinePanel key={i} data={p} scale={scale} />
        ))}
      </div>
    </section>
  );
}
