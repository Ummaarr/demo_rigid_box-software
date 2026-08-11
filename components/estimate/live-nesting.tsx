"use client";

// Live sheet-nesting preview shown on the estimate form as the order is built.
// Engine 1 is pure (no server-only in getBlanks / estimateMaterials), so we run
// the SAME nesting math the server uses, right here in the browser, and re-render
// on every selection change. Nesting needs only geometry (blanks + sheet sizes +
// quantity) — no rates — so no cost data is involved.

import {
  estimateMaterials,
  wrapGroupsOf,
  type MaterialInput,
  type MaterialQuantities,
} from "@/lib/engines/material";
import {
  keylinePanelBuilders,
  reverseBoardPanels,
  type KeylinePanelData,
} from "@/components/keylines";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FoamNestingSection,
  MaterialNestingBlock,
  WindowNestingSection,
} from "./nesting-diagram";

/** Box keyline panels for crease overlays — swallow incomplete-spec errors. */
function panelsFor(input: MaterialInput | null): KeylinePanelData[] | undefined {
  if (!input) return undefined;
  try {
    return keylinePanelBuilders[input.boxType](input.dims, input.vars);
  } catch {
    return undefined;
  }
}

/** Compute the preview quantities, swallowing engine input errors (incomplete vars). */
function tryEstimate(input: MaterialInput | null): MaterialQuantities | null {
  if (!input) return null;
  try {
    return estimateMaterials(input);
  } catch {
    // getBlanks throws on a missing/invalid required variable — the spec just
    // isn't complete enough to preview yet. Caller shows a hint instead.
    return null;
  }
}

export function LiveNesting({
  input,
  autoPrintNote,
}: {
  input: MaterialInput | null;
  /** Round 5: shown when a wrap uses Auto print size (no sheet to preview). */
  autoPrintNote?: string;
}) {
  const materials = tryEstimate(input);
  const panels = panelsFor(input);
  const reversePanels =
    input?.reverseBoard != null
      ? reverseBoardPanels(input.dims, input.reverseBoard.insertHeight_in)
      : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Sheet nesting</CardTitle>
        <CardDescription>
          Live layout of how blanks are cut from each stock sheet. Updates as you
          change the spec — no need to calculate first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!materials ? (
          <p className="text-sm text-muted-foreground">
            Complete the box spec to preview nesting.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {autoPrintNote && (
              <p className="rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs">
                {autoPrintNote}
              </p>
            )}
            <MaterialNestingBlock label="Board" est={materials.board} panels={panels} />
            {/* One block per wrap group (client item 2) — a single block
                unless components carry different paper/print/finish. */}
            {wrapGroupsOf(materials, "outer").map((g, i, all) => (
              <MaterialNestingBlock
                key={`outer-${i}`}
                label={`Outer paper${all.length > 1 ? ` — ${g.components.map((c) => c.replace(/_/g, " ")).join(", ")}` : ""}`}
                est={g.material}
                panels={panels}
              />
            ))}
            {wrapGroupsOf(materials, "inner").map((g, i, all) => (
              <MaterialNestingBlock
                key={`inner-${i}`}
                label={`Inner paper${all.length > 1 ? ` — ${g.components.map((c) => c.replace(/_/g, " ")).join(", ")}` : ""}`}
                est={g.material}
                panels={panels}
              />
            ))}
            {materials.reverseBoard && (
              <MaterialNestingBlock
                label="Reverse board"
                est={materials.reverseBoard.board}
                panels={reversePanels}
              />
            )}
            {materials.reverseBoard?.topPaper && (
              <MaterialNestingBlock
                label="Reverse board top paper"
                est={materials.reverseBoard.topPaper}
                panels={reversePanels}
              />
            )}
            {(materials.foams ?? []).map((f, i) => (
              <FoamNestingSection
                key={i}
                est={f}
                label={
                  (materials.foams?.length ?? 0) > 1
                    ? `Foam insert ${i + 1}`
                    : "Foam insert"
                }
              />
            ))}
            {/* Round-5 inserts (client 13-Jul; sleeve = card stock since round 6). */}
            {materials.sleeve && (
              <MaterialNestingBlock label="Sleeve" est={materials.sleeve.paper} />
            )}
            {materials.beading && (
              <MaterialNestingBlock label="Beading" est={materials.beading.paper} />
            )}
            {materials.cardPartitions && (
              <MaterialNestingBlock label="Card partitions" est={materials.cardPartitions.paper} />
            )}
            {materials.customPartition && (
              <MaterialNestingBlock label="Custom card partition" est={materials.customPartition.paper} />
            )}
            {materials.addons.window && (
              <WindowNestingSection est={materials.addons.window} />
            )}
            <p className="text-xs text-muted-foreground">
              Layout and base sheet counts. Printing wastage (extra sheets for
              setup/spoilage) is added to the purchased count in the cost
              breakdown after you calculate.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
