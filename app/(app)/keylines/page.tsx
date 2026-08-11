// Keyline preview (Phase 5) — renders all 8 box-type keylines with sample
// dimensions so the SVG diagrams can be reviewed. Authenticated (the proxy
// redirects logged-out users to /login). Chrome (sidebar) comes from the (app)
// layout.

import { verifySession } from "@/lib/auth";
import { keylineComponents } from "@/components/keylines";
import { PageHeader } from "@/components/page-header";
import type { BoxDimensions, BoxType, BoxVariables } from "@/types";

const sampleDims: BoxDimensions = { length_in: 10, width_in: 8, height_in: 4 };
const sampleVars: BoxVariables = {
  lidDepth_in: 1.5,
  bottomHeight_in: 3,
  neckHeight_in: 1.5,
  flapLength_in: 1.5,
  panels: 4,
  flapHeight_in: 1,
  trayHeight1_in: 2,
  trayHeight2_in: 2,
};

const ORDER: BoxType[] = [
  "telescopic",
  "magnetic",
  "shoulder",
  "drawer_sliding",
  "matchbox_sliding",
  "hinge_lid",
  "collapsible_rigid",
  "double_decker",
];

export default async function KeylinesPreviewPage() {
  await verifySession();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6 lg:p-8">
      <PageHeader
        title="Keylines"
        description={`Sample box ${sampleDims.length_in}×${sampleDims.width_in}×${sampleDims.height_in} in. Dashed lines are folds; numbers are inches.`}
      />

      <div className="flex flex-col gap-10">
        {ORDER.map((boxType) => {
          const Keyline = keylineComponents[boxType];
          return (
            <div key={boxType} className="rounded-lg border p-6">
              <Keyline dims={sampleDims} vars={sampleVars} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
