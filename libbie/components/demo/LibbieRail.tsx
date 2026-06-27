"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  PanelRightClose,
  ListChecks,
  FileText,
  Presentation,
  Sparkles,
  WifiOff,
} from "lucide-react";

import { libbie, proactiveNudge, getAnswer } from "@/lib/data";
import { LibbieAvatar } from "@/components/LibbieAvatar";
import { AnswerSurface } from "@/components/demo/AnswerSurface";
import type { Answer, CodeRef } from "@/lib/types";
import { cn } from "@/lib/utils";

const SUGGESTED_ICONS = [ListChecks, FileText, Presentation];

export function LibbieRail({
  answer,
  view,
  onViewChange,
  thinking,
  thinkingLine,
  localStatus,
  answeredLocally,
  onAskNudge,
  onFocusCode,
  onCollapse,
  onShowStale,
  onDraftHandover,
  onExplainForExec,
  handoverSlot,
}: {
  answer: Answer | null;
  view: "technical" | "executive";
  onViewChange: (v: "technical" | "executive") => void;
  thinking: boolean;
  thinkingLine: string;
  /** When set, Libbie shows the on-device status line during the local-mode delay. */
  localStatus: string | null;
  answeredLocally: boolean;
  onAskNudge: () => void;
  onFocusCode: (ref: CodeRef) => void;
  onCollapse: () => void;
  onShowStale: () => void;
  onDraftHandover: () => void;
  onExplainForExec: () => void;
  /** The HandoverDialog (rendered by the page) hooked to onDraftHandover via ref isn't
   *  needed — instead the page passes a node we render in the actions row. */
  handoverSlot?: React.ReactNode;
}) {
  const nudgeAnswer = getAnswer(proactiveNudge.answerId);
  const showNudge = !answer && !thinking;

  const actionHandlers = [onShowStale, onDraftHandover, onExplainForExec];

  return (
    <motion.aside
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="flex w-full flex-col border-t border-border bg-card/30 lg:h-full lg:overflow-hidden lg:border-t-0 lg:border-l"
      aria-label="Libbie copilot"
    >
      {/* header — avatar + status */}
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <LibbieAvatar size={36} thinking={thinking} showStatus />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{libbie.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {localStatus ?? (thinking ? thinkingLine : libbie.idleStatus)}
          </p>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse Libbie rail"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="size-4" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 px-4 py-4 lg:flex-1 lg:overflow-auto">
        {/* greeting (before first question) */}
        {showNudge && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mb-4 text-[13px] leading-relaxed text-muted-foreground"
          >
            {libbie.greeting}
          </motion.p>
        )}

        {/* proactively pinned risk — the signature moment */}
        <AnimatePresence>
          {showNudge && nudgeAnswer && (
            <motion.button
              type="button"
              onClick={onAskNudge}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.45, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="group relative block w-full overflow-hidden rounded-xl border border-danger/40 bg-gradient-to-br from-danger/10 to-card p-4 text-left transition-all hover:border-danger/60"
            >
              <span
                className="pointer-events-none absolute inset-0 opacity-60"
                aria-hidden
              >
                <span className="grain absolute inset-0" />
              </span>
              <div className="relative">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-md bg-danger/15 text-danger">
                    <AlertTriangle className="size-3.5" aria-hidden />
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-danger">
                    Libbie flagged this before you asked
                  </span>
                </div>
                <p className="text-[13px] font-semibold leading-snug text-foreground">
                  {proactiveNudge.title}
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  {proactiveNudge.body}
                </p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-primary">
                  Ask Libbie why
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </div>
            </motion.button>
          )}
        </AnimatePresence>

        {/* thinking state */}
        <AnimatePresence>
          {thinking && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-card/50 px-4 py-3"
            >
              <LibbieAvatar size={26} thinking />
              <p className="text-[12.5px] text-muted-foreground">
                {localStatus ? (
                  <span className="inline-flex items-center gap-1.5 text-primary">
                    <WifiOff className="size-3.5" aria-hidden />
                    {localStatus}
                  </span>
                ) : (
                  thinkingLine
                )}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* answer stream */}
        {answer && !thinking && (
          <AnswerSurface
            answer={answer}
            view={view}
            onViewChange={onViewChange}
            onFocusCode={onFocusCode}
            answeredLocally={answeredLocally}
          />
        )}
      </div>

      {/* suggested next actions */}
      <footer className="border-t border-border px-4 py-3">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Sparkles className="size-3 text-primary" aria-hidden />
          Suggested next
        </p>
        <div className="flex flex-col gap-1.5">
          {libbie.suggestedActions.map((label, i) => {
            const Icon = SUGGESTED_ICONS[i] ?? Sparkles;
            // "Draft a handover doc" is rendered via the handover slot when provided
            if (i === 1 && handoverSlot) {
              return <React.Fragment key={label}>{handoverSlot}</React.Fragment>;
            }
            const disabled = i === 2 && !answer; // exec view needs an active answer
            return (
              <button
                key={label}
                type="button"
                disabled={disabled}
                onClick={actionHandlers[i]}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-left text-[12px] text-foreground/85 transition-colors",
                  disabled
                    ? "cursor-not-allowed opacity-40"
                    : "hover:border-primary/40 hover:bg-primary/5 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0 text-primary" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      </footer>
    </motion.aside>
  );
}

/** The collapsed-rail floating orb. Pulses gently when Libbie has something proactive. */
export function LibbieOrb({
  onClick,
  proactive,
}: {
  onClick: () => void;
  proactive: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label="Open Libbie"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 24 }}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-border bg-card/90 py-2 pl-2 pr-3.5 shadow-xl backdrop-blur"
    >
      <span className="relative">
        {proactive && (
          <motion.span
            className="absolute inset-0 rounded-full bg-primary/30"
            animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
            aria-hidden
          />
        )}
        <LibbieAvatar size={32} thinking={proactive} showStatus />
      </span>
      <span className="text-[12.5px] font-medium text-foreground">
        {proactive ? "Libbie flagged a risk" : "Ask Libbie"}
      </span>
    </motion.button>
  );
}
