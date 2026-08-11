import type { BoxType } from "@/types";

// Human-readable labels for each box type. Single source of truth shared by the
// estimate form, the dashboard, and anywhere a box type is shown to the user.
export const BOX_LABELS: Record<BoxType, string> = {
  telescopic: "Telescopic",
  magnetic: "Magnetic",
  shoulder: "Shoulder",
  drawer_sliding: "Drawer sliding",
  matchbox_sliding: "Match-box sliding",
  hinge_lid: "Hinge lid",
  collapsible_rigid: "Collapsible rigid",
  double_decker: "Double decker",
  tray_only: "Only tray",
};

export function boxLabel(boxType: string): string {
  return (BOX_LABELS as Record<string, string>)[boxType] ?? boxType;
}
