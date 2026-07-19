"use client";

import * as React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip as RechartsTooltip,
  LabelList,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  Dna,
  FlaskConical,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";

import { staleness, pipeline } from "@/lib/data";
import type { StalenessItem, StalenessStatus } from "@/lib/types";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// --- status helpers ----------------------------------------------------------

const STATUS_META: Record<
  StalenessStatus,
  { label: string; varName: string; weight: number; dotClass: string }
> = {
  current: { label: "Current", varName: "--ok", weight: 1, dotClass: "bg-ok" },
  behind: { label: "Behind", varName: "--warn", weight: 2, dotClass: "bg-warn" },
  major: { label: "Major drift", varName: "--danger", weight: 3, dotClass: "bg-danger" },
};

function statusColor(status: StalenessStatus): string {
  return `var(${STATUS_META[status].varName})`;
}

function StatusPill({ status }: { status: StalenessStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{
        color: `var(${meta.varName})`,
        borderColor: `color-mix(in oklch, var(${meta.varName}) 40%, transparent)`,
        backgroundColor: `color-mix(in oklch, var(${meta.varName}) 12%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: `var(${meta.varName})` }}
      />
      {meta.label}
    </span>
  );
}

// --- chart -------------------------------------------------------------------

interface ChartDatum {
  name: string;
  weight: number;
  status: StalenessStatus;
  pinned: string;
  current: string;
}

function SeverityChart({ items }: { items: StalenessItem[] }) {
  const data: ChartDatum[] = React.useMemo(
    () =>
      [...items]
        .sort((a, b) => STATUS_META[b.status].weight - STATUS_META[a.status].weight)
        .map((it) => ({
          name: it.name,
          weight: STATUS_META[it.status].weight,
          status: it.status,
          pinned: it.pinned,
          current: it.current,
        })),
    [items],
  );

  return (
    <div className="h-[260px] w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 76, bottom: 4, left: 4 }}
          barCategoryGap={6}
        >
          <XAxis type="number" domain={[0, 3]} hide />
          <YAxis
            type="category"
            dataKey="name"
            width={96}
            tickLine={false}
            axisLine={false}
            tick={{
              fill: "var(--muted-foreground)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
          />
          <RechartsTooltip
            cursor={{ fill: "color-mix(in oklch, var(--foreground) 5%, transparent)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as ChartDatum;
              return (
                <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
                  <div className="mb-1 font-mono font-medium text-foreground">{d.name}</div>
                  <div className="font-mono text-muted-foreground">
                    {d.pinned} <span className="opacity-60">→</span> {d.current}
                  </div>
                  <div className="mt-1" style={{ color: statusColor(d.status) }}>
                    {STATUS_META[d.status].label}
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="weight" radius={[3, 3, 3, 3]} barSize={14} isAnimationActive>
            {data.map((d) => (
              <Cell key={d.name} fill={statusColor(d.status)} fillOpacity={0.85} />
            ))}
            <LabelList
              dataKey="status"
              position="right"
              content={(props) => {
                const { x, y, width, height, value } = props as {
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                  value: StalenessStatus;
                };
                return (
                  <text
                    x={x + width + 6}
                    y={y + height / 2}
                    dominantBaseline="central"
                    fontSize={10}
                    fontFamily="var(--font-mono)"
                    fill={statusColor(value)}
                  >
                    {STATUS_META[value].label}
                  </text>
                );
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// --- hero drift row ----------------------------------------------------------

function ReferenceDriftHero({ item }: { item: StalenessItem }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl border p-5"
      style={{
        borderColor: "color-mix(in oklch, var(--danger) 35%, transparent)",
        background:
          "linear-gradient(135deg, color-mix(in oklch, var(--danger) 10%, var(--card)), var(--card))",
      }}
    >
      <div className="bg-grid bg-grid-fade pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="relative flex items-start gap-3">
        <span
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg"
          style={{
            color: "var(--danger)",
            backgroundColor: "color-mix(in oklch, var(--danger) 16%, transparent)",
          }}
        >
          <Dna className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.7rem] font-medium tracking-wide text-danger uppercase">
              Reference-build drift
            </span>
            <StatusPill status={item.status} />
          </div>
          <h3 className="mt-1 font-display text-lg leading-tight">
            The cohort is anchored to a superseded genome build
          </h3>
          <div className="mt-2 flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-background/60 px-3 py-2 font-mono text-sm">
            <span className="text-foreground">{item.pinned}</span>
            <ArrowRight className="size-3.5 shrink-0 text-danger" />
            <span className="break-words text-muted-foreground">{item.current}</span>
          </div>
          <p className="mt-2.5 text-sm text-muted-foreground">{item.caution}</p>
          <div className="mt-3 font-mono text-[0.7rem] break-all text-muted-foreground/70">
            {item.source}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- main panel --------------------------------------------------------------

export function RiskPanel() {
  const heroItem = staleness.find((s) => s.kind === "reference-build");
  const rows = staleness.filter((s) => s.kind !== "reference-build");

  const majorCount = staleness.filter((s) => s.status === "major").length;
  const behindCount = staleness.filter((s) => s.status === "behind").length;
  const currentCount = staleness.filter((s) => s.status === "current").length;

  return (
    <section
      className="@container panel rounded-2xl p-5 @md:p-6"
      aria-labelledby="risk-panel-heading"
    >
      {/* Header / posture summary */}
      <header className="flex flex-col gap-4 border-b border-border pb-5 @xl:flex-row @xl:items-start @xl:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-code-soft text-code">
            <ShieldAlert className="size-5" />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 id="risk-panel-heading" className="font-display text-xl leading-none">
                Risk &amp; staleness
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full border border-conversation/40 bg-conversation-soft px-2 py-0.5 text-[0.65rem] font-medium text-conversation">
                <FlaskConical className="size-2.5" /> Sample data
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Dependency &amp; reference posture for{" "}
              <span className="font-mono text-foreground">{pipeline.name}</span>. Pinned versions
              are intentional, so review the cautions before any upgrade.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <PostureStat
            value={majorCount}
            label="major"
            varName="--danger"
            icon={<AlertTriangle className="size-3.5" />}
          />
          <PostureStat
            value={behindCount}
            label="behind"
            varName="--warn"
            icon={<ChevronDown className="size-3.5" />}
          />
          <PostureStat
            value={currentCount}
            label="current"
            varName="--ok"
            icon={<ShieldCheck className="size-3.5" />}
          />
        </div>
      </header>

      {/* Hero reference-build drift */}
      {heroItem && (
        <div className="pt-5">
          <ReferenceDriftHero item={heroItem} />
        </div>
      )}

      {/* Chart + table grid */}
      <div className="mt-5 grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        {/* Expandable item list */}
        <div className="min-w-0 rounded-xl border border-border bg-card/40">
          <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-border px-4 py-2.5 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase @lg:grid-cols-[1.4fr_1.6fr_auto]">
            <span>Dependency</span>
            <span className="hidden @lg:block">Pinned → Current</span>
            <span className="text-right">Status</span>
          </div>
          <Accordion>
            {rows.map((item) => (
              <AccordionItem key={item.name} value={item.name} className="px-4">
                <AccordionTrigger className="py-3 hover:no-underline">
                  <div className="grid w-full grid-cols-[1fr_auto] items-center gap-3 pr-2 @lg:grid-cols-[1.4fr_1.6fr_auto]">
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="text-sm font-medium text-foreground">{item.name}</span>
                      <span className="text-[0.7rem] text-muted-foreground capitalize">
                        {item.kind}
                      </span>
                    </span>
                    <span className="hidden items-center gap-2 font-mono text-xs @lg:flex">
                      <span className="text-foreground">{item.pinned}</span>
                      <ArrowRight
                        className="size-3"
                        style={{ color: statusColor(item.status) }}
                      />
                      <span className="text-muted-foreground">{item.current}</span>
                    </span>
                    <span className="justify-self-end">
                      <StatusPill status={item.status} />
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-2 pr-6 pb-1">
                    <p className="text-sm leading-relaxed text-muted-foreground">{item.caution}</p>
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[0.7rem] text-muted-foreground/70">
                      <span className="@lg:hidden">
                        {item.pinned} → {item.current}
                      </span>
                      <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 break-all">
                        {item.source}
                      </span>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* Chart */}
        <div className="min-w-0 rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Severity by tool</h3>
            <span className="font-mono text-[0.65rem] text-muted-foreground">
              {staleness.length} tracked
            </span>
          </div>
          <SeverityChart items={staleness} />
          <div className="mt-1 flex items-center justify-center gap-4 text-[0.65rem]">
            {(Object.keys(STATUS_META) as StalenessStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: statusColor(s) }}
                />
                {STATUS_META[s].label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function PostureStat({
  value,
  label,
  varName,
  icon,
}: {
  value: number;
  label: string;
  varName: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center rounded-lg border px-3 py-1.5"
      style={{
        borderColor: `color-mix(in oklch, var(${varName}) 30%, transparent)`,
        backgroundColor: `color-mix(in oklch, var(${varName}) 8%, transparent)`,
      }}
    >
      <span className="flex items-center gap-1 text-lg font-semibold tabular-nums" style={{ color: `var(${varName})` }}>
        {icon}
        {value}
      </span>
      <span className="text-[0.6rem] tracking-wide text-muted-foreground uppercase">{label}</span>
    </div>
  );
}
