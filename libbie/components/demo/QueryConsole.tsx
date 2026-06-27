"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, CornerDownLeft, Sparkles, Info } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Answer } from "@/lib/types";
import { cn } from "@/lib/utils";

interface QueryConsoleProps {
  answers: Answer[];
  selectedId: string | null;
  onSelect: (answer: Answer) => void;
}

export function QueryConsole({ answers, selectedId, onSelect }: QueryConsoleProps) {
  const [text, setText] = React.useState("");
  const [noMatch, setNoMatch] = React.useState(false);

  function matchAnswer(query: string): Answer | undefined {
    const q = query.trim().toLowerCase();
    if (!q) return undefined;
    return answers.find(
      (a) =>
        a.question.toLowerCase().includes(q) ||
        a.chip.toLowerCase().includes(q) ||
        q.includes(a.chip.toLowerCase())
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const match = matchAnswer(text);
    if (match) {
      setNoMatch(false);
      setText("");
      onSelect(match);
    } else {
      setNoMatch(true);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (noMatch) setNoMatch(false);
            }}
            placeholder="Ask why a parameter was chosen…"
            aria-label="Ask a question about the pipeline"
            className="h-9 pl-8"
          />
        </div>
        <Button type="submit" size="sm" className="h-9 gap-1.5">
          Ask
          <CornerDownLeft className="size-3.5" aria-hidden />
        </Button>
      </form>

      <AnimatePresence>
        {noMatch && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-2 overflow-hidden rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-[13px] text-foreground"
          >
            <Info className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <span>
              I can answer these for the loaded pipeline — pick one to see the
              reconstructed intent with its code and conversation sources.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Sparkles className="size-3 text-primary" aria-hidden />
          Suggested questions
        </p>
        <div className="flex flex-wrap gap-2">
          {answers.map((a) => {
            const active = a.id === selectedId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setNoMatch(false);
                  onSelect(a);
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-all",
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border bg-card text-foreground/80 hover:border-primary/50 hover:bg-primary/5 hover:text-foreground"
                )}
              >
                {a.chip}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
