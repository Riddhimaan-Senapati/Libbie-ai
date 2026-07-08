import { AlertTriangle, ArrowUpRight, CircleCheck, CircleAlert } from "lucide-react";

import { staleness, pipeline } from "@/lib/data";
import type { StalenessItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS = {
  current: { icon: CircleCheck, cls: "text-ok", label: "Current" },
  behind: { icon: CircleAlert, cls: "text-warn", label: "Behind" },
  major: { icon: AlertTriangle, cls: "text-danger", label: "Major gap" },
} as const;

export function RiskPanel({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div>
      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        Libbie tracks the load-bearing versions and reference builds in{" "}
        <span className="font-mono text-foreground">{pipeline.name}</span> and computes how far
        each has drifted from what's current. Ask about any row to see the decision behind it.
      </p>

      <div className="space-y-2.5">
        {staleness.map((item: StalenessItem) => {
          const s = STATUS[item.status];
          const Icon = s.icon;
          const q = `Why is ${item.name} pinned to ${item.pinned}?`;
          return (
            <div
              key={item.name}
              className={cn(
                "rounded-xl border p-3.5",
                item.status === "major"
                  ? "border-danger/40 bg-danger/5"
                  : item.status === "behind"
                    ? "border-warn/40 bg-warn/5"
                    : "border-border bg-card",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("size-4 shrink-0", s.cls)} aria-hidden />
                    <span className="truncate font-mono text-[13px] font-medium text-foreground">
                      {item.name}
                    </span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-muted-foreground">
                      {item.kind}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    pinned <span className="text-foreground">{item.pinned}</span> · current{" "}
                    <span className="text-foreground">{item.current}</span>
                  </p>
                </div>
                <span className={cn("shrink-0 text-[11px] font-medium", s.cls)}>{s.label}</span>
              </div>

              <p className="mt-2 text-[12px] leading-relaxed text-foreground/85">{item.caution}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-mono text-[10.5px] text-muted-foreground">{item.source}</span>
                <button
                  type="button"
                  onClick={() => onAsk(q)}
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-primary hover:underline"
                >
                  Ask why <ArrowUpRight className="size-3.5" aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
