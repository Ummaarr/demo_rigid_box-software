// Phase 5 check: every keyline's segment geometry must equal the engine's blank
// dimensions (so the drawing can't drift from the cost math), and every keyline
// component must render valid SVG. Run: npx tsx scripts/keylines-check.ts

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { keylineComponents, keylinePanelBuilders, reverseBoardPanels } from "@/components/keylines";
import { getBlanks } from "@/lib/formulas";
import { estimateReverseBoard } from "@/lib/engines/material";
import type { BoxDimensions, BoxType, BoxVariables } from "@/types";

const dims: BoxDimensions = { length_in: 10, width_in: 8, height_in: 4 };
const vars: BoxVariables = {
  lidDepth_in: 1.5,
  bottomHeight_in: 3,
  neckHeight_in: 1.5,
  flapLength_in: 1.5,
  panels: 4,
  flapHeight_in: 1,
  trayHeight1_in: 2,
  trayHeight2_in: 2,
};

const boxTypes: BoxType[] = [
  "telescopic",
  "magnetic",
  "shoulder",
  "drawer_sliding",
  "matchbox_sliding",
  "hinge_lid",
  "collapsible_rigid",
  "double_decker",
];

let failures = 0;
function ok(cond: boolean, msg: string) {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
}
const sum = (xs: { length: number }[]) => xs.reduce((s, x) => s + x.length, 0);

for (const bt of boxTypes) {
  console.log(`=== ${bt} ===`);
  const panels = keylinePanelBuilders[bt](dims, vars);
  const blanks = getBlanks(bt, dims, vars);

  ok(panels.length === blanks.length, `panel count == blank count (${panels.length})`);
  const n = Math.min(panels.length, blanks.length);
  for (let i = 0; i < n; i++) {
    const sx = sum(panels[i].x);
    const sy = sum(panels[i].y);
    ok(Math.abs(sx - blanks[i].width_in) < 1e-9, `${panels[i].component}: Σx ${sx} == blank W ${blanks[i].width_in}`);
    ok(Math.abs(sy - blanks[i].height_in) < 1e-9, `${panels[i].component}: Σy ${sy} == blank H ${blanks[i].height_in}`);
  }

  const html = renderToStaticMarkup(createElement(keylineComponents[bt], { dims, vars }));
  ok(html.includes("<svg"), "renders <svg>");
  const figures = (html.match(/<figure/g) ?? []).length;
  ok(figures === panels.length, `renders ${panels.length} panel figure(s)`);
}

// Reverse-board insert keyline (client 7-Jul) — not a BoxType, checked on its
// own: its single panel's segment sums must equal the engine's reverse-board
// keyline (Hi+L+Hi) × (Hi+W+Hi).
{
  console.log("=== reverse_board insert ===");
  const Hi = 2;
  const panels = reverseBoardPanels(dims, Hi);
  const rb = estimateReverseBoard(dims, Hi, 500, { width_in: 31, height_in: 41 });
  ok(panels.length === 1, "one reverse-board panel");
  const sx = sum(panels[0].x);
  const sy = sum(panels[0].y);
  ok(Math.abs(sx - rb.keyline.width_in) < 1e-9, `Σx ${sx} == keyline W ${rb.keyline.width_in}`);
  ok(Math.abs(sy - rb.keyline.height_in) < 1e-9, `Σy ${sy} == keyline H ${rb.keyline.height_in}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
