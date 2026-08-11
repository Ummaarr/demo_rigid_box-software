import Link from "next/link";
import {
  FilePlus2,
  Boxes,
  CalendarDays,
  Wallet,
  TrendingUp,
  PieChart,
  FileText,
} from "lucide-react";

import { verifySession } from "@/lib/auth";
import { createAdminClient } from "@/lib/db/admin";
import { loadDashboardStats } from "@/lib/db/dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardStats, type StatItem } from "@/components/stats";
import { TrendAreaChart } from "@/components/dashboard/trend-area-chart";
import { BoxTypePie } from "@/components/dashboard/box-type-pie";
import { RecentEstimatesTable } from "@/components/dashboard/recent-estimates";
import { formatMoney } from "@/lib/currency";

const inr = { format: (n: number) => formatMoney(n, 0) };

export default async function DashboardPage() {
  const session = await verifySession();
  const stats = await loadDashboardStats(createAdminClient(), session.role);

  const kpis: StatItem[] = [
    {
      label: "Total estimates",
      value: String(stats.totalEstimates),
      icon: Boxes,
      iconClassName: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
    {
      label: "This month",
      value: String(stats.estimatesThisMonth),
      delta: stats.estimatesMoMPct,
      footnote: "vs last month",
      icon: CalendarDays,
      iconClassName: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    },
  ];
  if (stats.revenue) {
    kpis.push(
      {
        label: "Total quoted",
        value: inr.format(stats.revenue.total),
        icon: Wallet,
        iconClassName: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      },
      {
        label: "Quoted this month",
        value: inr.format(stats.revenue.thisMonth),
        delta: stats.revenue.momPct,
        footnote: "vs last month",
        icon: TrendingUp,
        iconClassName: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      },
    );
  }

  return (
    <div className="flex w-full flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            Welcome back{session.fullName ? `, ${session.fullName}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            Here&apos;s what&apos;s happening with your estimates.
          </p>
        </div>
        <Link href="/estimates?new=1">
          <Button size="lg">
            <FilePlus2 data-icon="inline-start" />
            New estimate
          </Button>
        </Link>
      </header>

      {/* KPI cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardStats items={kpis} />
      </section>

      {/* Charts */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4 text-muted-foreground" />
              Estimates over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TrendAreaChart
              data={stats.monthly.map((m) => ({
                label: m.label,
                count: m.count,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="size-4 text-muted-foreground" />
              By box type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BoxTypePie
              data={stats.byBoxType.map((b) => ({
                label: b.label,
                count: b.count,
              }))}
            />
          </CardContent>
        </Card>
      </section>

      {/* Quote pipeline (client final doc item 14) — each tile links to the
          quotes list filtered by that status. Hidden on a pre-migration DB
          where the quotes table doesn't exist yet. */}
      {stats.quotes && stats.quotes.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              Quotes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[
                { label: "Awaiting approval", value: stats.quotes.awaiting, href: "/quotes?status=sent" },
                { label: "Accepted", value: stats.quotes.accepted, href: "/quotes?status=accepted" },
                { label: "Rejected", value: stats.quotes.rejected, href: "/quotes?status=rejected" },
                { label: "Revised", value: stats.quotes.revised, href: "/quotes" },
                { label: "Total sent", value: stats.quotes.total, href: "/quotes" },
              ].map((t) => (
                <Link
                  key={t.label}
                  href={t.href}
                  className="rounded-lg border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="text-2xl font-semibold tabular-nums">{t.value}</div>
                  <div className="text-xs text-muted-foreground">{t.label}</div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent estimates */}
      <RecentEstimatesTable recent={stats.recent} role={session.role} />
    </div>
  );
}
