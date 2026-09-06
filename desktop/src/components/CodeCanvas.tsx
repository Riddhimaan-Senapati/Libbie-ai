import * as React from "react";
import { FileCode2 } from "lucide-react";

import type { CodeFile, CodeRef } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface CanvasFocus {
  lineStart: number;
  lineEnd: number;
  symbol?: string;
  /** Bump to re-trigger scroll/glow even for the same line. */
  nonce: number;
}

export function refToFocus(ref: CodeRef, nonce: number): CanvasFocus {
  return { lineStart: ref.lineStart, lineEnd: ref.lineEnd, symbol: ref.symbol, nonce };
}

export const CodeCanvas = React.memo(function CodeCanvas({
  file,
  focus,
  onLineClick,
}: {
  file: CodeFile;
  focus: CanvasFocus | null;
  onLineClick?: (line: number) => void;
}) {
  const lines = React.useMemo(() => file.content.split("\n"), [file.content]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lineRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());

  // Auto-scroll to and glow the cited line when focus changes.
  React.useEffect(() => {
    if (!focus) return;
    const el = lineRefs.current.get(focus.lineStart);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);

  const isCited = (n: number) =>
    focus != null && n >= focus.lineStart && n <= focus.lineEnd;

  return (
    <div className="panel selectable flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
      {/* file header */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <FileCode2 className="size-4 text-primary" aria-hidden />
        <span className="font-mono text-[12.5px] text-foreground">{file.path}</span>
        <span className="ml-auto truncate text-[11px] text-muted-foreground">
          {file.description}
        </span>
      </div>

      {/* code body */}
      <div ref={scrollRef} className="scroll-soft min-h-0 flex-1 overflow-auto py-2">
        <div className="min-w-max font-mono text-[12.5px] leading-[1.65]">
          {lines.map((line, i) => {
            const n = i + 1;
            const cited = isCited(n);
            return (
              <div
                key={n}
                ref={(el) => {
                  if (el) lineRefs.current.set(n, el);
                  else lineRefs.current.delete(n);
                }}
                onClick={() => onLineClick?.(n)}
                className={cn(
                  "group relative flex cursor-default gap-4 px-4",
                  cited ? "bg-primary/10" : "hover:bg-muted/50",
                )}
              >
                {cited && (
                  <span
                    key={focus?.nonce}
                    className="animate-cite-marker absolute inset-y-0 left-0 w-[3px] bg-primary"
                    aria-hidden
                  />
                )}
                <span
                  className={cn(
                    "w-10 shrink-0 select-none text-right tabular-nums",
                    cited ? "text-primary/70" : "text-muted-foreground/50",
                  )}
                >
                  {n}
                </span>
                <span
                  className={cn(
                    "whitespace-pre text-foreground/90",
                    cited && "font-medium text-foreground",
                  )}
                >
                  {line || " "}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

