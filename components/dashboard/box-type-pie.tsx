"use client";

import { Cell, Pie, PieChart } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// Warm palette drawn from the brand pair (espresso + clay) and the browns
// between them, alternating dark/accent the way the original navy+gold ramp
// did. Restrained on purpose — the donut should read professional, not
// rainbow-coloured.
const PALETTE = [
  "#33261c",
  "#b4552d",
  "#5c4432",
  "#c98155",
  "#7a6553",
  "#dcae8b",
  "#a3968a",
  "#c9bfb4",
];

const config = { count: { label: "Estimates" } } satisfies ChartConfig;

export function BoxTypePie({
  data,
}: {
  data: { label: string; count: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
        No estimates yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ChartContainer config={config} className="aspect-auto h-44 w-full">
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent nameKey="label" hideLabel />}
          />
          <Pie
            data={data}
            dataKey="count"
            nameKey="label"
            innerRadius={45}
            outerRadius={75}
            paddingAngle={2}
            strokeWidth={2}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
            />
            <span className="truncate text-muted-foreground">{d.label}</span>
            <span className="ml-auto font-medium tabular-nums">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
