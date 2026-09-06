import * as React from "react";
import { m as motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  PanelRightClose,
  ListChecks,
  Presentation,
  Sparkles,
  FileText,
} from "lucide-react";

import { libbie, proactiveNudge } from "@/lib/data";
import type { CodeRef } from "@/lib/types";
import type { Retrieved } from "@/lib/rag";
import { LibbieAvatar } from "@/components/LibbieAvatar";
import { AnswerSurface } from "@/components/AnswerSurface";
import { cn } from "@/lib/utils";

export interface AnswerSession {
  question: string;
  /** True once the first streamed token landed (verdict text lives in verdictStore). */
  started: boolean;
  streaming: boolean;
  retrieved: Retrieved;
  answeredLocally: boolean;
}

export const LibbieRail = React.memo(function LibbieRail({
  session,
  view,
  onViewChange,
  statusLine,
  engineReady,
  engineLabel,
  onAskNudge,
  onFocusCode,
  onCollapse,
  onShowStale,
  onExplainForExec,
  onDraftHandover,
}: {
  session: AnswerSession | null;
  view: "technical" | "executive";
  onViewChange: (v: "technical" | "executive") => void;
  statusLine: string;
  engineReady: boolean;
  engineLabel?: string;
  onAskNudge: () => void;
  onFocusCode: (ref: CodeRef) => void;
  onCollapse: () => void;
  onShowStale: () => void;
  onExplainForExec: () => void;
  onDraftHandover: () => void;
}) {
  const showIntro = !session;
  const thinking = !!session?.streaming && !session.started;

  const actions = [
    { label: "Show me the other stale decisions", Icon: ListChecks, onClick: onShowStale, disabled: false },
    { label: "Draft a handover doc", Icon: FileText, onClick: onDraftHandover, disabled: false },
    { label: "Explain this for an exec", Icon: Presentation, onClick: onExplainForExec, disabled: !session },
  ];

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-card/30">
      {/* header */}
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <LibbieAvatar size={36} thinking={!!session?.streaming} showStatus={engineReady} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{libbie.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{statusLine}</p>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse Libbie"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelRightClose className="size-4" aria-hidden />
        </button>
      </header>

      <div className="scroll-soft min-h-0 flex-1 overflow-auto px-4 py-4">
        {/* greeting + proactive nudge before first question */}
        {showIntro && (
          <>
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mb-4 text-[13px] leading-relaxed text-muted-foreground"
            >
              {libbie.greeting}
            </motion.p>

            <motion.button
              type="button"
              onClick={onAskNudge}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="group relative block w-full overflow-hidden rounded-xl border border-danger/40 bg-gradient-to-br from-danger/10 to-card p-4 text-left transition-all hover:border-danger/60"
            >
              <span className="pointer-events-none absolute inset-0 opacity-60" aria-hidden>
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
                  <ArrowRight
                    className="size-3.5 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </div>
            </motion.button>
          </>
        )}

        {/* thinking (no tokens yet) */}
        <AnimatePresence>
          {thinking && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-card/50 px-4 py-3"
            >
              <LibbieAvatar size={26} thinking />
              <p className="text-[12.5px] text-muted-foreground">{statusLine}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* streaming / final answer */}
        {session && (session.started || !session.streaming) && (
          <AnswerSurface
            question={session.question}
            streaming={session.streaming}
            retrieved={session.retrieved}
            view={view}
            onViewChange={onViewChange}
            onFocusCode={onFocusCode}
            answeredLocally={session.answeredLocally}
            engineLabel={engineLabel}
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
          {actions.map(({ label, Icon, onClick, disabled }) => (
            <button
              key={label}
              type="button"
              disabled={disabled}
              onClick={onClick}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-left text-[12px] transition-colors",
                disabled
                  ? "cursor-not-allowed opacity-40"
                  : "text-foreground/85 hover:border-primary/40 hover:bg-primary/5 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0 text-primary" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </footer>
    </aside>
  );
});

/** Collapsed-rail floating orb. */
export function LibbieOrb({ onClick, proactive }: { onClick: () => void; proactive: boolean }) {
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
