// Keyline registry — maps each BoxType to its keyline component and to its
// panel-geometry builder (the builders are also used by the geometry test).

import type { BoxDimensions, BoxType, BoxVariables } from "@/types";
import type { KeylinePanelData } from "./keyline-base";

import { TelescopicKeyline, telescopicPanels } from "./telescopic-keyline";
import { MagneticKeyline, magneticPanels } from "./magnetic-keyline";
import { ShoulderKeyline, shoulderPanels } from "./shoulder-keyline";
import { DrawerSlidingKeyline, drawerSlidingPanels } from "./drawer-sliding-keyline";
import { MatchboxSlidingKeyline, matchboxSlidingPanels } from "./matchbox-sliding-keyline";
import { HingeLidKeyline, hingeLidPanels } from "./hinge-lid-keyline";
import { CollapsibleRigidKeyline, collapsibleRigidPanels } from "./collapsible-rigid-keyline";
import { DoubleDeckerKeyline, doubleDeckerPanels } from "./double-decker-keyline";
import { TrayOnlyKeyline, trayOnlyPanels } from "./tray-only-keyline";

export type KeylineComponent = (props: {
  dims: BoxDimensions;
  vars?: BoxVariables;
}) => React.ReactElement;

export const keylineComponents: Record<BoxType, KeylineComponent> = {
  telescopic: TelescopicKeyline,
  magnetic: MagneticKeyline,
  shoulder: ShoulderKeyline,
  drawer_sliding: DrawerSlidingKeyline,
  matchbox_sliding: MatchboxSlidingKeyline,
  hinge_lid: HingeLidKeyline,
  collapsible_rigid: CollapsibleRigidKeyline,
  double_decker: DoubleDeckerKeyline,
  tray_only: TrayOnlyKeyline,
};

export const keylinePanelBuilders: Record<
  BoxType,
  (dims: BoxDimensions, vars?: BoxVariables) => KeylinePanelData[]
> = {
  telescopic: telescopicPanels,
  magnetic: magneticPanels,
  shoulder: shoulderPanels,
  drawer_sliding: drawerSlidingPanels,
  matchbox_sliding: matchboxSlidingPanels,
  hinge_lid: hingeLidPanels,
  collapsible_rigid: collapsibleRigidPanels,
  double_decker: doubleDeckerPanels,
  tray_only: trayOnlyPanels,
};

// Reverse-board insert keyline — not a BoxType (it's an insert), so it's not in
// the registries above; re-exported for direct use in the form/result + tests.
export { ReverseBoardKeyline, reverseBoardPanels } from "./reverse-board-keyline";

export type { KeylinePanelData } from "./keyline-base";
