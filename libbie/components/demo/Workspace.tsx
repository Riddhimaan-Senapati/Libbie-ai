"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Database,
  FileCode2,
  MessageSquare,
  ShieldCheck,
  WifiOff,
  UserMinus,
  GitBranch,
  ArrowRight,
  Loader2,
} from "lucide-react";

import { pipeline, answers } from "@/lib/data";
import type { Answer } from "@/lib/types";
import { cn } from "@/lib/utils";

import { QueryConsole } from "./QueryConsole";
import { AnswerBody } from "./AnswerBody";
import { CodeCitationPanel } from "./CodeCitationPanel";
import { ConversationCitationPanel } from "./ConversationCitationPanel";

type Phase = "idle" | "retrieving" | "local" | "revealed";

function SampleDataPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      <span className="size-1.5 rounded-full bg-warn" aria-hidden />
      Sample data
    </span>
  );
}

/** Network/cloud retrieval loader (~700ms). */
function RetrievingState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="panel relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-xl px-6 py-16"
    >
      <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-40" aria-hidden />
      <div className="animate-scanbeam pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" aria-hidden />
      <div className="relative flex items-center gap-4">
        <motion.span
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ duration: 1, repeat: Infinity }}
          className="flex size-10 items-center justify-center rounded-lg border border-code/50 bg-code-soft text-code"
        >
          <FileCode2 className="size-5" aria-hidden />
        </motion.span>
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity }}
          className="h-px w-10 bg-gradient-to-r from-code to-conversation"
          aria-hidden
        />
        <span className="flex size-9 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
          <Loader2 className="size-4 animate-spin" aria-hidden />
        </span>
        <motion.div
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: 0.3 }}
          className="h-px w-10 bg-gradient-to-r from-conversation to-code"
          aria-hidden
        />
        <motion.span
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ duration: 1, repeat: Infinity, delay: 0.5 }}
          className="flex size-10 items-center justify-center rounded-lg border border-conversation/50 bg-conversation-soft text-conversation"
        >
          <MessageSquare className="size-5" aria-hidden />
        </motion.span>
      </div>
      <p className="relative font-display text-lg text-foreground">
        Reconstructing intent…
      </p>
      <p className="relative text-xs text-muted-foreground">
        Searching code and conversations for the decision behind this parameter
      </p>
    </motion.div>
  );
}

/** Air-gapped local-model loader (~1.2s). */
function LocalState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="panel relative flex flex-col items-center justify-center gap-4 overflow-hidden rounded-xl px-6 py-16"
    >
      <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-40" aria-hidden />
      <div className="relative flex items-center gap-3">
        <motion.span
          animate={{ boxShadow: [
            "0 0 0 0 color-mix(in oklch, var(--primary) 40%, transparent)",
            "0 0 0 10px transparent",
          ] }}
          transition={{ duration: 1.4, repeat: Infinity }}
          className="flex size-12 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 text-primary"
        >
          <ShieldCheck className="size-6" aria-hidden />
        </motion.span>
        <span className="flex size-9 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
          <WifiOff className="size-4" aria-hidden />
        </span>
      </div>
      <p className="relative font-display text-lg text-foreground">
        Running local model · air-gapped
      </p>
      <div className="relative flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
        Reconstructing intent on-device
      </div>
      <p className="relative inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-[11px] font-medium text-primary">
        <WifiOff className="size-3" aria-hidden />
        Runs offline. Nothing leaves your environment
      </p>
    </motion.div>
  );
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel relative flex flex-col items-center justify-center gap-5 overflow-hidden rounded-xl px-6 py-16 text-center"
    >
      <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-30" aria-hidden />
      <div className="relative flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl border border-code/50 bg-code-soft text-code">
          <FileCode2 className="size-5" aria-hidden />
        </span>
        <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex size-11 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary glow-primary">
          <Database className="size-5" aria-hidden />
        </span>
        <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex size-11 items-center justify-center rounded-xl border border-conversation/50 bg-conversation-soft text-conversation">
          <MessageSquare className="size-5" aria-hidden />
        </span>
      </div>
      <div className="relative max-w-md space-y-2">
        <h2 className="font-display text-2xl text-foreground">
          Ask why it was built this way
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Pick a question to reconstruct the intent behind a pipeline parameter,
          grounded side by side in the exact code and the conversation that
          justified it.
        </p>
      </div>
      <div className="relative flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-lg border border-border bg-background/50 px-4 py-2.5 text-xs">
        <span className="inline-flex items-center gap-1.5 font-mono text-foreground">
          <GitBranch className="size-3.5 text-primary" aria-hidden />
          {pipeline.repo}
        </span>
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <UserMinus className="size-3.5 text-warn" aria-hidden />
          {pipeline.author.name} departed {pipeline.author.departed} · no handover
          doc
        </span>
      </div>
    </motion.div>
  );
}

export function Workspace({ localMode }: { localMode: boolean }) {
  const [selected, setSelected] = React.useState<Answer | null>(null);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [answeredLocally, setAnsweredLocally] = React.useState(false);
  const [codeFocus, setCodeFocus] = React.useState<number | null>(null);
  const [convFocus, setConvFocus] = React.useState(0);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function handleSelect(answer: Answer) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setSelected(answer);
    setCodeFocus(null);
    setConvFocus(0);

    const runLocal = localMode && Boolean(answer.isLocal);
    setAnsweredLocally(runLocal);
    setPhase(runLocal ? "local" : "retrieving");

    timerRef.current = setTimeout(
      () => setPhase("revealed"),
      runLocal ? 1200 : 700
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Console header */}
      <div className="panel rounded-xl p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Database className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-sm font-medium text-foreground">
              {pipeline.name}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {pipeline.family}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {localMode && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                <ShieldCheck className="size-3" aria-hidden />
                Local mode
              </span>
            )}
            <SampleDataPill />
          </div>
        </div>
        <QueryConsole
          answers={answers}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
        />
      </div>

      {/* Result area */}
      <AnimatePresence mode="wait">
        {phase === "idle" && (
          <motion.div key="idle" exit={{ opacity: 0 }}>
            <EmptyState />
          </motion.div>
        )}

        {phase === "retrieving" && (
          <motion.div key="retrieving">
            <RetrievingState />
          </motion.div>
        )}

        {phase === "local" && (
          <motion.div key="local">
            <LocalState />
          </motion.div>
        )}

        {phase === "revealed" && selected && (
          <motion.div
            key={`revealed-${selected.id}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-6"
          >
            <div className="panel rounded-xl p-5 sm:p-6">
              <AnswerBody
                answer={selected}
                answeredLocally={answeredLocally}
                onFocusCode={(i) => setCodeFocus(i)}
                onFocusConversation={() => setConvFocus((k) => k + 1)}
              />
            </div>

            {/* Dual citations — the centerpiece */}
            <div className="relative">
              <div
                className="pointer-events-none absolute -top-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-card px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                aria-hidden
              >
                Sources converge
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <CodeCitationPanel
                  citations={selected.codeCitations}
                  focusIndex={codeFocus}
                  onFocusHandled={() => setCodeFocus(null)}
                />
                <ConversationCitationPanel
                  conversationIds={selected.conversationCitations}
                  focusKey={convFocus}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
