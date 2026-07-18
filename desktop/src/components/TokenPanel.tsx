import { Coins, ArrowDownToLine, ArrowUpFromLine, Gauge, Cpu, Cloud } from "lucide-react";

import { cn } from "@/lib/utils";

/** One recorded inference call for the current session. */
export interface CallRecord {
  model: string;
  /** true when the call went to a cloud provider (openai/anthropic). */
  cloud: boolean;
  inputTokens: number;
  outputTokens: number;
  tokensPerSec: number | null;
  /** Estimated USD; null = cloud model with no price in the table. */
  costUsd: number | null;
  ts: number;
}

function fmtTokens(n: number): string {
  return n.toLocaleString();
}

function fmtUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function Stat({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3 text-primary" aria-hidden />
        {label}
      </p>
      <p className="mt-1.5 font-mono text-[17px] font-semibold text-foreground">{value}</p>
    </div>
  );
}

export function TokenPanel({ calls }: { calls: CallRecord[] }) {
  const totalIn = calls.reduce((n, c) => n + c.inputTokens, 0);
  const totalOut = calls.reduce((n, c) => n + c.outputTokens, 0);
  const totalCost = calls.reduce((n, c) => n + (c.costUsd ?? 0), 0);
  const anyCloud = calls.some((c) => c.cloud);
  const anyUnpriced = calls.some((c) => c.cloud && c.costUsd == null);
  const lastTps = [...calls].reverse().find((c) => c.tokensPerSec != null)?.tokensPerSec ?? null;

  if (calls.length === 0) {
    return (
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        No calls yet this session. Ask Libbie a question and token usage will show up here, along
        with an estimated cost for cloud providers.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        Token usage for this session. Costs are estimates from an editable price table; local
        models are free, so they report <span className="font-mono text-foreground">tokens/sec</span>{" "}
        instead.
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <Stat label="Input" value={fmtTokens(totalIn)} Icon={ArrowDownToLine} />
        <Stat label="Output" value={fmtTokens(totalOut)} Icon={ArrowUpFromLine} />
        <Stat label="Total tokens" value={fmtTokens(totalIn + totalOut)} Icon={Coins} />
        {anyCloud ? (
          <Stat label="Est. cost" value={anyUnpriced ? `${fmtUsd(totalCost)}+` : fmtUsd(totalCost)} Icon={Cloud} />
        ) : (
          <Stat
            label="Last speed"
            value={lastTps != null ? `${lastTps.toFixed(1)} t/s` : "—"}
            Icon={Gauge}
          />
        )}
      </div>

      {!anyCloud && (
        <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-ok">
          <Cpu className="size-3.5" aria-hidden />
          $0 · local inference
        </p>
      )}

      <p className="mb-2 mt-5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Recent calls
      </p>
      <div className="space-y-2">
        {[...calls]
          .slice(-8)
          .reverse()
          .map((c, i) => (
            <div
              key={calls.length - i}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2"
            >
              <div className="min-w-0">
                <span className="flex items-center gap-1.5">
                  {c.cloud ? (
                    <Cloud className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <Cpu className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="truncate font-mono text-[12px] text-foreground">{c.model}</span>
                </span>
                <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                  {fmtTokens(c.inputTokens)} in · {fmtTokens(c.outputTokens)} out
                  {c.tokensPerSec != null && ` · ${c.tokensPerSec.toFixed(1)} t/s`}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 font-mono text-[12px] font-medium",
                  c.cloud ? "text-foreground" : "text-ok",
                )}
              >
                {c.cloud ? (c.costUsd == null ? "unpriced" : fmtUsd(c.costUsd)) : "$0"}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
