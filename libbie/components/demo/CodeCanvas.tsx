"use client";

import * as React from "react";
import { FileCode2, AlertTriangle } from "lucide-react";

import { getCodeFile, staleness } from "@/lib/data";
import type { CodeFile, CodeRef } from "@/lib/types";
import { cn } from "@/lib/utils";

const COMMENT_RE = /^\s*(\/\/|#)/;

/** A cited highlight target on the canvas (path + 1-based inclusive line range). */
export interface CanvasFocus {
  path: string;
  lineStart: number;
  lineEnd: number;
  /** Bumped each time a focus is requested so re-selecting the same line re-scrolls. */
  nonce: number;
}

/**
 * Inline staleness hints on canvas lines. The labels derive from the staleness
 * fixture (single source of truth, shared with the risk panel), so "X available"
 * can't drift from the version the risk panel reports. The regexes anchor on
 * the demo files' own content.
 */
const HINT_LABEL_OVERRIDES: Record<string, string> = {
  // The fixture carries the version, not the end-of-life judgment.
  Python: "EOL · 3.12 current",
};

function hintLabel(itemName: string): string {
  const it = staleness.find((s) => s.name === itemName);
  if (!it) return "";
  return HINT_LABEL_OVERRIDES[itemName] ?? `${it.current.split(" ")[0]} available`;
}

const STALE_HINTS: { match: RegExp; label: string }[] = [
  { match: /genome\s*=\s*'GRCh37'/, label: hintLabel("Reference build") },
  { match: /gatk_version\s*=\s*'4\.1\.9\.0'/, label: hintLabel("GATK") },
  { match: /gatk4=/, label: hintLabel("GATK") },
  { match: /bwa=/, label: hintLabel("BWA") },
  { match: /samtools=/, label: hintLabel("samtools") },
  { match: /bcftools=/, label: hintLabel("bcftools") },
  { match: /picard=/, label: hintLabel("Picard") },
  { match: /python=/, label: hintLabel("Python") },
];

function staleHint(line: string): string | null {
  for (const h of STALE_HINTS) if (h.match.test(line)) return h.label;
  return null;
}

export function CodeCanvas({
  file,
  focus,
  onLineClick,
}: {
  file: CodeFile;
  focus: CanvasFocus | null;
  /** Clicking a line is a valid ask trigger — we surface the symbol/path up. */
  onLineClick?: (ref: { path: string; line: number }) => void;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lineRef = React.useRef<HTMLDivElement>(null);

  const lines = React.useMemo(
    () => file.content.replace(/\n$/, "").split("\n"),
    [file.content],
  );

  const activeFocus = focus && focus.path === file.path ? focus : null;

  React.useEffect(() => {
    if (activeFocus && lineRef.current) {
      lineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // re-run when the focus nonce changes (re-asking the same line)
  }, [activeFocus, activeFocus?.lineStart, activeFocus?.nonce]);

  const stalePoints = staleness.length;

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card/50"
      aria-label={`Source file ${file.path}`}
    >
      {/* file-path header */}
      <header className="flex items-center gap-2 border-b border-border bg-background/40 px-4 py-2.5">
        <FileCode2 className="size-4 shrink-0 text-code" aria-hidden />
        <span className="truncate font-mono text-xs text-foreground">{file.path}</span>
        <span className="ml-auto hidden truncate text-[11px] text-muted-foreground sm:block">
          {file.description}
        </span>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <pre className="w-max min-w-full py-2 font-mono text-[12.5px] leading-relaxed">
          <code>
            {lines.map((line, i) => {
              const lineNo = i + 1;
              const cited =
                !!activeFocus &&
                lineNo >= activeFocus.lineStart &&
                lineNo <= activeFocus.lineEnd;
              const isFirstCited = cited && lineNo === activeFocus!.lineStart;
              const isComment = COMMENT_RE.test(line);
              const hint = staleHint(line);

              return (
                <div
                  key={isFirstCited ? `cited-${activeFocus!.nonce}` : lineNo}
                  ref={isFirstCited ? lineRef : undefined}
                  onClick={() => onLineClick?.({ path: file.path, line: lineNo })}
                  className={cn(
                    "group flex cursor-pointer px-4 transition-colors hover:bg-foreground/[0.03]",
                    cited && "bg-code/15 shadow-[inset_2px_0_0_var(--code)]",
                    isFirstCited && "animate-cite-flash",
                  )}
                >
                  <span
                    className={cn(
                      "mr-4 w-7 shrink-0 select-none text-right tabular-nums",
                      cited ? "text-code/90" : "text-muted-foreground/40",
                    )}
                  >
                    {lineNo}
                  </span>
                  <span
                    className={cn(
                      "whitespace-pre",
                      cited
                        ? "text-foreground"
                        : isComment
                          ? "italic text-muted-foreground/45"
                          : "text-foreground/75",
                    )}
                  >
                    {line || " "}
                  </span>
                  {hint && (
                    <span className="ml-3 inline-flex shrink-0 items-center gap-1 self-center rounded-full border border-warn/30 bg-warn/10 px-1.5 py-px text-[9px] font-medium text-warn opacity-70 transition-opacity group-hover:opacity-100">
                      <AlertTriangle className="size-2.5" aria-hidden />
                      {hint}
                    </span>
                  )}
                </div>
              );
            })}
          </code>
        </pre>
      </div>

      <footer className="flex items-center justify-between border-t border-border bg-background/40 px-4 py-1.5 font-mono text-[10px] text-muted-foreground/70">
        <span>{file.language}</span>
        <span className="flex items-center gap-1 text-warn/80">
          <AlertTriangle className="size-2.5" aria-hidden />
          {stalePoints} staleness signals across the pipeline
        </span>
      </footer>
    </section>
  );
}

/** Resolve a CodeRef into a canvas focus, ignoring stale lookups. */
export function refToFocus(ref: CodeRef, nonce: number): CanvasFocus {
  const file = getCodeFile(ref.path);
  return {
    path: ref.path,
    lineStart: file ? ref.lineStart : 1,
    lineEnd: file ? ref.lineEnd : 1,
    nonce,
  };
}
