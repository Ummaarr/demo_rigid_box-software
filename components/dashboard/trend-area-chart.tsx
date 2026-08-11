"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const config = {
  count: { label: "Estimates", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function TrendAreaChart({
  data,
}: {
  data: { label: string; count: number }[];
}) {
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <AreaChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <defs>
          <linearGradient id="fillCount" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
        />
        <YAxis
          width={28}
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <Area
          dataKey="count"
          type="monotone"
          stroke="var(--color-count)"
          strokeWidth={2}
          fill="url(#fillCount)"
        />
      </AreaChart>
    </ChartContainer>
  );
}
