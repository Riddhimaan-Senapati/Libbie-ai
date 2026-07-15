"use client";

import { useEffect, useReducer, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence, type Variants } from "motion/react";
import { ArrowRight, FileCode2, MessagesSquare, CornerDownLeft, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { LibbieAvatar } from "@/components/LibbieAvatar";
import { getAnswer, getConversation, getCodeFile, libbie } from "@/lib/data";

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const item: Variants = {
  hidden: { y: 18, opacity: 0 },
  show: { y: 0, opacity: 1, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

// Ground the looping micro-demo in the real GRCh37 example.
const ANSWER = getAnswer("ans-grch37");
const CONVERSATION = getConversation("conv-grch37-chat");
const CODE_FILE = getCodeFile("conf/params.config");

/** Editorial hero with the signature looping "Ask Libbie" micro-demo as centerpiece. */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid bg-grid-fade opacity-70" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px] glow-primary" aria-hidden />

      <div className="mx-auto max-w-6xl px-5 pb-24 pt-20 sm:px-8 sm:pt-28 lg:pt-32">
        <motion.div variants={container} initial="hidden" animate="show" className="mx-auto max-w-3xl text-center">
          <motion.div variants={item} className="mb-7 flex justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              <LibbieAvatar size={18} />
              {libbie.name} · {libbie.role}
            </span>
          </motion.div>

          <motion.h1
            variants={item}
            className="text-balance font-display text-5xl font-normal leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-[4.75rem]"
          >
            Libbie remembers{" "}
            <span className="relative whitespace-nowrap text-primary">
              why
              <span className="absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-primary/60" aria-hidden />
            </span>
            .
          </motion.h1>

          <motion.p
            variants={item}
            className="mx-auto mt-7 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            Meet Libbie — the colleague who remembers why every pipeline was built this way.
            She&apos;s read every line of code and every conversation, and answers with receipts.
          </motion.p>

          <motion.div variants={item} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/demo"
              className={cn(buttonVariants({ variant: "default", size: "lg" }), "group h-12 gap-2 rounded-full px-7 text-sm")}
            >
              Meet Libbie
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <a
              href="#how"
              className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "h-12 rounded-full px-7 text-sm")}
            >
              How she works
            </a>
          </motion.div>
        </motion.div>

        {/* The signature looping micro-demo — centerpiece */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mt-16 max-w-3xl"
        >
          <div className="rounded-3xl bg-gradient-to-b from-accent to-tint p-3 sm:p-4">
            <AskLibbieDemo />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// --- Looping micro-demo ------------------------------------------------------

type Phase = "typing" | "thinking" | "answer";

interface DemoState {
  cycle: number;
  phase: Phase;
  typed: number;
}

type DemoAction =
  | { type: "type" }
  | { type: "think" }
  | { type: "answer" }
  | { type: "restart" };

function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "type":
      return { ...state, typed: state.typed + 1 };
    case "think":
      return { ...state, phase: "thinking" };
    case "answer":
      return { ...state, phase: "answer" };
    case "restart":
      return { cycle: state.cycle + 1, phase: "typing", typed: 0 };
  }
}

function AskLibbieDemo() {
  const question = ANSWER?.question ?? "Why was this pipeline built on GRCh37 instead of GRCh38?";
  const [state, dispatch] = useReducer(reducer, { cycle: 0, phase: "typing", typed: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const t = timers.current;
    if (state.phase === "typing") {
      if (state.typed < question.length) {
        t.push(setTimeout(() => dispatch({ type: "type" }), 38));
      } else {
        t.push(setTimeout(() => dispatch({ type: "think" }), 600));
      }
    } else if (state.phase === "thinking") {
      t.push(setTimeout(() => dispatch({ type: "answer" }), 1400));
    } else {
      // Hold the answer, then loop.
      t.push(setTimeout(() => dispatch({ type: "restart" }), 6200));
    }
    return () => {
      t.forEach(clearTimeout);
      timers.current = [];
    };
  }, [state.phase, state.typed, question.length]);

  const showAnswer = state.phase === "answer";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-code via-primary to-conversation" aria-hidden />

      {/* Window chrome */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <LibbieAvatar size={22} showStatus />
          <span className="text-xs font-medium text-foreground">Ask {libbie.name}</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Live</span>
      </div>

      {/* ⌘K input row */}
      <div className="flex items-center gap-3 border-b border-border bg-background/40 px-4 py-3.5">
        <kbd className="hidden shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
          ⌘K
        </kbd>
        <p className="flex-1 truncate text-left font-sans text-sm text-foreground">
          {question.slice(0, state.typed)}
          {state.phase === "typing" && (
            <span className="ml-0.5 inline-block h-4 w-px translate-y-0.5 animate-pulse bg-primary align-middle" aria-hidden />
          )}
        </p>
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-md border text-muted-foreground transition-colors",
            state.phase === "typing" && state.typed >= question.length
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border",
          )}
          aria-hidden
        >
          <CornerDownLeft className="size-3" />
        </span>
      </div>

      {/* Answer surface */}
      <div className="min-h-[260px] px-4 py-4 sm:px-5">
        <AnimatePresence mode="wait">
          {!showAnswer ? (
            <motion.div
              key={`pending-${state.cycle}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex items-center gap-3 pt-2"
            >
              <LibbieAvatar size={30} thinking={state.phase === "thinking"} />
              <span className="text-sm text-muted-foreground">
                {state.phase === "thinking" ? libbie.thinkingLines[1] : "Listening…"}
              </span>
            </motion.div>
          ) : (
            <Verdict key={`answer-${state.cycle}`} question={question} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const answerStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.13, delayChildren: 0.05 } },
};
const answerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

function Verdict({ question }: { question: string }) {
  void question;
  const codeRef = ANSWER?.codeCitations[0];
  const pivotal = CONVERSATION?.messages.find((m) => m.pivotal) ?? CONVERSATION?.messages[0];
  const verdict =
    "Short version: it's GRCh37 on purpose, for cohort concordance. Here's the line, and here's where the team agreed to it.";

  // The exact cited code line.
  const codeLine =
    codeRef && CODE_FILE ? CODE_FILE.content.split("\n")[codeRef.lineStart - 1] ?? "" : "";

  return (
    <motion.div variants={answerStagger} initial="hidden" animate="show">
      {/* Verdict in Libbie's voice */}
      <motion.div variants={answerItem} className="flex items-start gap-3">
        <LibbieAvatar size={30} showStatus className="mt-0.5" />
        <p className="text-pretty text-sm leading-relaxed text-foreground">{verdict}</p>
      </motion.div>

      {/* The two converging citation cards */}
      <motion.div
        variants={answerItem}
        className="mt-4 grid grid-cols-1 items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]"
      >
        {/* Code (teal) */}
        <div className="rounded-xl border border-code bg-code-soft p-3 text-left">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-code">
            <FileCode2 className="size-3.5" aria-hidden />
            {codeRef?.path}
          </div>
          <pre className="overflow-x-auto font-mono text-[12px] leading-relaxed text-foreground">
            <code>{codeLine.trim()}</code>
          </pre>
        </div>

        {/* Fusion connector */}
        <div className="flex items-center justify-center">
          <span className="grid size-7 place-items-center rounded-full border border-border bg-card text-primary" aria-hidden>
            <Plus className="size-3.5" />
          </span>
        </div>

        {/* Conversation (amber) */}
        <div className="rounded-xl border border-conversation bg-conversation-soft p-3 text-left">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-conversation">
            <MessagesSquare className="size-3.5" aria-hidden />
            {CONVERSATION?.source}
          </div>
          <p className="line-clamp-3 text-[12px] leading-relaxed text-foreground">
            {pivotal?.author}: “{(pivotal?.body ?? "").split(".")[0]}.”
          </p>
        </div>
      </motion.div>

      <motion.p variants={answerItem} className="mt-3 text-center text-[11px] text-muted-foreground">
        Both sources, same decision · cited to code and conversation
      </motion.p>
    </motion.div>
  );
}
