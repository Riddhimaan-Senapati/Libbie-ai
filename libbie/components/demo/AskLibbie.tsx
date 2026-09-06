"use client";

import * as React from "react";
import { m as motion, AnimatePresence } from "motion/react";
import { Search, CornerDownLeft, Sparkles } from "lucide-react";

import { answers } from "@/lib/data";
import { LibbieAvatar } from "@/components/LibbieAvatar";
import type { Answer } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Loose substring match across chip + question. */
function matchAnswers(query: string): Answer[] {
  const q = query.trim().toLowerCase();
  if (!q) return answers;
  const tokens = q.split(/\s+/);
  return answers.filter((a) => {
    const hay = `${a.chip} ${a.question}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

export function AskLibbie({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (answer: Answer) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);

  const results = React.useMemo(() => matchAnswers(query), [query]);
  const noMatch = query.trim().length > 0 && results.length === 0;

  // global ⌘K / Ctrl+K
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (e.key === "Escape" && open) onOpenChange(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Reset the palette state when it opens (adjust state during render rather
  // than in an effect to avoid an extra render pass).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setActive(0);
    }
  }

  React.useEffect(() => {
    if (!open) return;
    // focus after mount
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  // Lock body scroll while the palette is open.
  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Save/restore focus to the element that was focused before opening.
  React.useEffect(() => {
    if (!open) return;
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Basic focus trap: keep Tab/Shift+Tab cycling within the palette.
  function onDialogKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey) {
      if (activeEl === first || !root.contains(activeEl)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (activeEl === last || !root.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Reset the highlighted result whenever the query changes.
  const [prevQuery, setPrevQuery] = React.useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setActive(0);
  }

  function choose(a: Answer | undefined) {
    if (!a) return;
    onSelect(a);
    onOpenChange(false);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <button
            type="button"
            aria-label="Close Ask Libbie"
            onClick={() => onOpenChange(false)}
            className="absolute inset-0 bg-foreground/10 backdrop-blur-sm"
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Ask Libbie"
            onKeyDown={onDialogKeyDown}
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="relative z-10 mx-4 w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl ring-1 ring-foreground/10"
          >
            {/* input */}
            <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
              <LibbieAvatar size={26} thinking={query.trim().length > 0} />
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Ask Libbie why something was built this way…"
                className="h-7 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                aria-label="Ask Libbie a question"
              />
              <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
                ESC
              </kbd>
            </div>

            {/* results */}
            <div className="max-h-[50vh] overflow-auto p-2">
              {noMatch ? (
                <div className="px-3 py-3">
                  <div className="flex items-start gap-2.5">
                    <LibbieAvatar size={26} className="mt-0.5" />
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      I don&apos;t have that one rehearsed yet, but here&apos;s what I can
                      answer about this pipeline with full receipts:
                    </p>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {answers.map((a, i) => (
                      <ResultRow
                        key={a.id}
                        answer={a}
                        active={i === active}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(a)}
                      />
                    ))}
                  </ul>
                </div>
              ) : (
                <ul className="space-y-1">
                  {results.map((a, i) => (
                    <ResultRow
                      key={a.id}
                      answer={a}
                      active={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(a)}
                    />
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10.5px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Sparkles className="size-3 text-primary" aria-hidden />
                Libbie answers with code + conversation citations
              </span>
              <span className="flex items-center gap-1">
                <CornerDownLeft className="size-3" aria-hidden /> to ask
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ResultRow({
  answer,
  active,
  onClick,
  onMouseEnter,
}: {
  answer: Answer;
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
          active ? "bg-primary/10" : "hover:bg-muted/60",
        )}
      >
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            active ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          <Search className="size-3" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {answer.chip}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {answer.question}
          </span>
        </span>
        {answer.isLocal && (
          <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
            on-device
          </span>
        )}
      </button>
    </li>
  );
}
