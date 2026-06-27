"use client";

import { ShieldCheck, WifiOff } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * Controlled switch for "Local / air-gapped mode". When on, surfaces a subtle
 * "No network" indicator (FR-14). State is owned by the parent.
 */
export function LocalModeToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  const labelId = "local-mode-label";

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-2 py-1 transition-colors",
        checked
          ? "border-code bg-code-soft"
          : "border-border/70 bg-muted/30",
      )}
    >
      <span
        className={cn(
          "transition-colors",
          checked ? "text-code" : "text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {checked ? (
          <WifiOff className="size-4" />
        ) : (
          <ShieldCheck className="size-4" />
        )}
      </span>

      <div className="hidden flex-col leading-tight sm:flex">
        <span
          id={labelId}
          className={cn(
            "text-[11px] font-medium transition-colors",
            checked ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {checked ? "Air-gapped" : "Local mode"}
        </span>
        {checked ? (
          <span className="flex items-center gap-1 font-mono text-[9px] tracking-wide text-code/90 uppercase">
            <span className="inline-block size-1 rounded-full bg-code" />
            No network
          </span>
        ) : (
          <span className="font-mono text-[9px] tracking-wide text-muted-foreground/60 uppercase">
            Off
          </span>
        )}
      </div>

      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-labelledby={labelId}
        aria-label="Toggle local / air-gapped mode"
      />
    </div>
  );
}
