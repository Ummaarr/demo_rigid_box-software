import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";

export type StatItem = {
  label: string;
  value: string;
  /** undefined = no delta chip; null = "new" (no prior period). */
  delta?: number | null;
  footnote?: string;
  /** Header icon (avama-style tinted chip, top-right). */
  icon?: LucideIcon;
  /** Tailwind tint for the icon chip, e.g. "bg-blue-500/10 text-blue-600". */
  iconClassName?: string;
};

export function DashboardStats({ items }: { items: StatItem[] }) {
  return (
    <>
      {items.map((s) => {
        const Icon = s.icon;
        return (
          <Card key={s.label}>
            <CardHeader>
              <CardTitle className="font-normal text-muted-foreground text-xs">
                {s.label}
              </CardTitle>
              {Icon && (
                <CardAction>
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-lg",
                      s.iconClassName ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-[18px]" />
                  </span>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <p className="font-heading text-2xl font-semibold tabular-nums">
                {s.value}
              </p>
              {s.delta !== undefined && (
                <div className="flex items-center gap-1 text-xs">
                  {s.delta === null ? (
                    <span className="text-muted-foreground">New</span>
                  ) : (
                    <Delta value={s.delta}>
                      <DeltaIcon />
                      <DeltaValue />
                    </Delta>
                  )}
                  {s.footnote && (
                    <span className="text-muted-foreground">{s.footnote}</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
