import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, CornerDownLeft, Sparkles } from "lucide-react";

import { answers } from "@/lib/data";
import { cn } from "@/lib/utils";

export function AskLibbie({
  open,
  onOpenChange,
  onAsk,
  disabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAsk: (question: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const suggestions = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = answers.map((a) => ({ chip: a.chip, question: a.question }));
    if (!q) return pool;
    return pool.filter(
      (s) => s.chip.toLowerCase().includes(q) || s.question.toLowerCase().includes(q),
    );
  }, [query]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // focus after mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const submit = (question: string) => {
    if (!question.trim()) return;
    onOpenChange(false);
    onAsk(question.trim());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onOpenChange(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Prefer a highlighted suggestion; otherwise ask the free-form query.
      const picked = suggestions[active]?.question;
      submit(query.trim() ? query : picked ?? "");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[16vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
            aria-hidden
          />

          <motion.div
            role="dialog"
            aria-label="Ask Libbie"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="panel relative w-full max-w-xl overflow-hidden rounded-2xl"
          >
            {/* input */}
            <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
              <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Ask Libbie why anything was built this way…"
                className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
              />
              <kbd className="hidden items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:flex">
                <CornerDownLeft className="size-3" aria-hidden /> ask
              </kbd>
            </div>

            {/* suggestions */}
            <div className="scroll-soft max-h-[46vh] overflow-y-auto p-2">
              <p className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {query.trim() ? "Press enter to ask this" : "Try one of these"}
              </p>
              {suggestions.map((s, i) => (
                <button
                  key={s.question}
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => submit(s.question)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                    i === active ? "bg-primary/10 text-foreground" : "text-foreground/80",
                  )}
                >
                  <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">{s.chip}</span>
                </button>
              ))}
              {query.trim() && (
                <button
                  type="button"
                  onClick={() => submit(query)}
                  className="mt-1 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-primary/40 px-2.5 py-2 text-left text-[13px] text-primary"
                >
                  <CornerDownLeft className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">Ask: "{query.trim()}"</span>
                </button>
              )}
            </div>

            {disabled && (
              <div className="border-t border-border bg-warn/10 px-4 py-2 text-[11px] text-warn">
                The local engine isn't ready yet — start it from the status bar or Settings.
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
