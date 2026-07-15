"use client";

import * as React from "react";
import { motion } from "motion/react";
import { FileCode2, CornerDownRight } from "lucide-react";

import { getCodeFile } from "@/lib/data";
import type { CodeRef } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CodeCitationPanelProps {
  citations: CodeRef[];
  /** Index of the citation to focus/scroll to (e.g. when a symbol chip is clicked). */
  focusIndex: number | null;
  onFocusHandled?: () => void;
}

const COMMENT_RE = /^\s*(\/\/|#)/;

/** A single line-numbered, highlighted code file rendered for one citation. */
function CitedFile({
  citation,
  active,
  scrollKey,
}: {
  citation: CodeRef;
  active: boolean;
  scrollKey: number;
}) {
  const file = getCodeFile(citation.path);
  const lineRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (active && lineRef.current) {
      lineRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [active, scrollKey]);

  if (!file) return null;

  const lines = file.content.replace(/\n$/, "").split("\n");

  return (
    <div className="overflow-hidden rounded-lg border border-code/60 bg-code-soft/40">
      <div className="flex items-center gap-2 border-b border-code/40 bg-code-soft px-3 py-2">
        <FileCode2 className="size-3.5 shrink-0 text-code" aria-hidden />
        <span className="font-mono text-xs text-code">{citation.path}</span>
        <span className="ml-auto rounded-md bg-code/10 px-1.5 py-0.5 font-mono text-[10px] text-code/90">
          L{citation.lineStart}
          {citation.lineEnd !== citation.lineStart ? `–${citation.lineEnd}` : ""}
        </span>
      </div>

      <div className="max-h-72 overflow-auto">
        <pre className="py-2 font-mono text-[12.5px] leading-relaxed">
          <code>
            {lines.map((line, i) => {
              const lineNo = i + 1;
              const cited =
                lineNo >= citation.lineStart && lineNo <= citation.lineEnd;
              const isComment = COMMENT_RE.test(line);
              return (
                <div
                  key={lineNo}
                  ref={cited && lineNo === citation.lineStart ? lineRef : undefined}
                  className={cn(
                    "group flex px-3 transition-colors",
                    cited &&
                      "bg-code/15 shadow-[inset_2px_0_0_var(--code)] [--code-glow:var(--code)]"
                  )}
                >
                  <span
                    className={cn(
                      "mr-3 w-7 shrink-0 select-none text-right tabular-nums",
                      cited ? "text-code/90" : "text-muted-foreground/40"
                    )}
                  >
                    {lineNo}
                  </span>
                  <span
                    className={cn(
                      "whitespace-pre-wrap break-words",
                      cited
                        ? "text-foreground"
                        : isComment
                          ? "text-muted-foreground/45 italic"
                          : "text-foreground/75"
                    )}
                  >
                    {line || " "}
                  </span>
                </div>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}

export function CodeCitationPanel({
  citations,
  focusIndex,
  onFocusHandled,
}: CodeCitationPanelProps) {
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [scrollKey, setScrollKey] = React.useState(0);

  // Reset to the first citation whenever the set of citations changes, and jump
  // to a parent-requested focus index — both handled by adjusting state during
  // render rather than in an effect to avoid extra render passes.
  const [prevCitations, setPrevCitations] = React.useState(citations);
  if (citations !== prevCitations) {
    setPrevCitations(citations);
    setActiveIdx(0);
  }

  const [prevFocusIndex, setPrevFocusIndex] = React.useState(focusIndex);
  if (focusIndex !== prevFocusIndex) {
    setPrevFocusIndex(focusIndex);
    if (focusIndex != null && focusIndex >= 0 && focusIndex < citations.length) {
      setActiveIdx(focusIndex);
      setScrollKey((k) => k + 1);
    }
  }

  // Acknowledge the parent's focus request once it has been applied.
  React.useEffect(() => {
    if (focusIndex != null && focusIndex >= 0 && focusIndex < citations.length) {
      onFocusHandled?.();
    }
  }, [focusIndex, citations.length, onFocusHandled]);

  return (
    <motion.section
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="flex min-w-0 flex-col rounded-xl border border-code/40 bg-card/60 p-3"
      aria-label="Code citation"
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-code-soft text-code">
          <FileCode2 className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-code">
            Code
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            The exact line in the pipeline
          </p>
        </div>
      </header>

      {citations.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {citations.map((c, i) => (
            <button
              key={`${c.path}-${c.symbol}-${i}`}
              type="button"
              onClick={() => {
                setActiveIdx(i);
                setScrollKey((k) => k + 1);
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors",
                i === activeIdx
                  ? "border-code/70 bg-code-soft text-code"
                  : "border-border bg-transparent text-muted-foreground hover:border-code/40 hover:text-code"
              )}
            >
              <CornerDownRight className="size-3" aria-hidden />
              {c.symbol}
            </button>
          ))}
        </div>
      )}

      <div className="min-w-0 flex-1">
        {citations.map((c, i) => (
          <div key={`${c.path}-${i}`} className={i === activeIdx ? "block" : "hidden"}>
            <CitedFile citation={c} active={i === activeIdx} scrollKey={scrollKey} />
          </div>
        ))}
      </div>
    </motion.section>
  );
}
