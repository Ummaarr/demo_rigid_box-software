"use client";

import { Cell, Pie, PieChart } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// On-brand palette: navy + gold + supporting grey-blues. Kept restrained so the
// donut reads professional rather than rainbow-coloured.
const PALETTE = [
  "#1f2a5c",
  "#c6a24c",
  "#3a4a82",
  "#6b7494",
  "#4b5575",
  "#d8c187",
  "#9aa0b5",
  "#b8bccb",
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
