"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  FileCode2,
  GitBranch,
  MessagesSquare,
  Package,
  SkipForward,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { brand, pipeline, scanItems } from "@/lib/data";
import { cn } from "@/lib/utils";
import type { ScanItem } from "@/lib/types";

const PHASES = [
  "Indexing artifacts",
  "Parsing conversations",
  "Linking code ↔ conversation",
  "Building queryable memory",
] as const;

const TOTAL_MS = 3800;
const TICK_MS = 40;

const KIND_STYLE: Record<
  ScanItem["kind"],
  { icon: typeof FileCode2; color: string; ring: string; label: string }
> = {
  file: {
    icon: FileCode2,
    color: "text-code",
    ring: "border-code bg-code-soft",
    label: "code",
  },
  conversation: {
    icon: MessagesSquare,
    color: "text-conversation",
    ring: "border-conversation bg-conversation-soft",
    label: "conversation",
  },
  version: {
    icon: Package,
    color: "text-muted-foreground",
    ring: "border-border/70 bg-muted/40",
    label: "version",
  },
};

interface Counter {
  key: string;
  label: string;
  target: number;
  icon: typeof FileCode2;
  color: string;
}

/**
 * DR-5 — the "scanning at scale" entry beat. Streams authored scan items past a
 * scanning beam while counters tick up to the pipeline stats, then calls
 * onComplete(). A Skip button completes immediately.
 */
export function ScanningIntro({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState(0);
  const startRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  const counters: Counter[] = [
    {
      key: "files",
      label: "Files",
      target: pipeline.stats.files,
      icon: FileCode2,
      color: "text-code",
    },
    {
      key: "conversations",
      label: "Conversations",
      target: pipeline.stats.conversations,
      icon: MessagesSquare,
      color: "text-conversation",
    },
    {
      key: "commits",
      label: "Commits",
      target: pipeline.stats.commits,
      icon: GitBranch,
      color: "text-muted-foreground",
    },
  ];

  // Drive the master timeline.
  useEffect(() => {
    let raf = 0;
    const step = (now: number) => {
      if (startRef.current === null) startRef.current = now;
      const elapsed = now - startRef.current;
      const pct = Math.min(100, (elapsed / TOTAL_MS) * 100);
      setProgress(pct);
      setPhase(
        Math.min(PHASES.length - 1, Math.floor((pct / 100) * PHASES.length)),
      );

      if (pct >= 100) {
        if (!doneRef.current) {
          doneRef.current = true;
          // brief settle before handing off
          window.setTimeout(() => onComplete(), 280);
        }
        return;
      }
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [onComplete]);

  const handleSkip = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onComplete();
  };

  // Eased fraction for counters (ease-out so they decelerate into the target).
  const frac = progress / 100;
  const eased = 1 - Math.pow(1 - frac, 3);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      aria-label="Indexing codebase"
      aria-live="polite"
      className="relative w-full overflow-hidden rounded-xl border border-border panel"
    >
      {/* Atmosphere */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid bg-grid-fade opacity-60" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-64 glow-primary" />

      <div className="relative z-10 grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.1fr_1fr] lg:gap-12">
        {/* Left — status + counters */}
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-md border border-code/40 bg-code-soft">
              <Sparkles aria-hidden="true" className="size-4 text-code" />
            </span>
            <span className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
              {brand.name} · connecting
            </span>
          </div>

          <h2 className="mt-5 font-display text-2xl tracking-tight text-foreground sm:text-3xl">
            Connecting{" "}
            <span className="font-mono text-xl text-code sm:text-2xl">
              {pipeline.repo}
            </span>
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Indexing artifacts and fusing code with the conversations that justified
            it — building one queryable memory of the pipeline.
          </p>

          {/* Phase label */}
          <div className="mt-6 h-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={phase}
                initial={{ y: 8, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -8, opacity: 0 }}
                transition={{ duration: 0.28 }}
                className="flex items-center gap-2"
              >
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-1.5 animate-ping rounded-full bg-primary/70" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                </span>
                <span className="text-sm font-medium text-foreground">
                  {PHASES[phase]}
                </span>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Progress */}
          <div className="mt-3 flex items-center gap-3">
            <Progress value={progress} className="h-1.5 flex-1" />
            <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>

          {/* Counters */}
          <div className="mt-7 grid grid-cols-3 gap-3">
            {counters.map((c) => {
              const value = Math.round(c.target * eased);
              const Icon = c.icon;
              return (
                <div
                  key={c.key}
                  className="rounded-lg border border-border/70 bg-card/60 p-3"
                >
                  <Icon aria-hidden="true" className={cn("size-4", c.color)} />
                  <div className="mt-2 font-mono text-2xl tabular-nums text-foreground">
                    {value.toLocaleString()}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {c.label}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-7">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSkip}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <SkipForward aria-hidden="true" />
              Skip
            </Button>
          </div>
        </div>

        {/* Right — scanning stream */}
        <div className="relative">
          <div className="relative h-full min-h-[320px] overflow-hidden rounded-lg border border-border/70 bg-background/40">
            {/* Scanning beam */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-primary to-transparent shadow-[0_0_18px_2px_var(--color-primary)] animate-scanbeam"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-b from-background/60 via-transparent to-background/80"
            />

            {/* Streaming items */}
            <div className="absolute inset-0 overflow-hidden">
              <motion.ul
                aria-hidden="true"
                className="flex flex-col gap-2 p-3"
                animate={{ y: ["0%", "-50%"] }}
                transition={{
                  duration: 7,
                  ease: "linear",
                  repeat: Infinity,
                }}
              >
                {[...scanItems, ...scanItems].map((item, i) => {
                  const s = KIND_STYLE[item.kind];
                  const Icon = s.icon;
                  return (
                    <li
                      key={`${item.label}-${i}`}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md border bg-card/50 px-3 py-2",
                        s.ring,
                      )}
                    >
                      <Icon className={cn("size-3.5 shrink-0", s.color)} />
                      <span className="truncate font-mono text-xs text-foreground">
                        {item.label}
                      </span>
                      <span
                        className={cn(
                          "ml-auto shrink-0 font-mono text-[9px] tracking-wide uppercase",
                          s.color,
                        )}
                      >
                        {s.label}
                      </span>
                    </li>
                  );
                })}
              </motion.ul>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
