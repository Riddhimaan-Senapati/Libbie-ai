import { Loader2, Play, Square, Cpu } from "lucide-react";
import type { EngineStatus } from "@/lib/tauri";
import { cn } from "@/lib/utils";

export function EngineStatusPill({
  status,
  busy,
  onStart,
  onStop,
}: {
  status: EngineStatus;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const dot = status.healthy
    ? "bg-ok"
    : status.running || busy
      ? "bg-warn"
      : "bg-muted-foreground/40";

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-2.5 pr-1.5 text-[11px]">
      <span className="relative flex size-2">
        {(status.running || busy) && !status.healthy && (
          <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", dot)} />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", dot)} />
      </span>
      <Cpu className="size-3 text-muted-foreground" aria-hidden />
      <span className="max-w-[180px] truncate text-muted-foreground" title={status.message}>
        {busy ? "Working…" : status.message}
      </span>
      {status.healthy ? (
        <button
          type="button"
          onClick={onStop}
          disabled={busy}
          aria-label="Stop engine"
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-danger disabled:opacity-40"
        >
          <Square className="size-3" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          aria-label="Start engine"
          className="rounded-full p-1 text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Play className="size-3" aria-hidden />}
        </button>
      )}
    </div>
  );
}
