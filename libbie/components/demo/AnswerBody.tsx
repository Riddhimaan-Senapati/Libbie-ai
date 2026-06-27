"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Wrench, Briefcase, FileCode2, MessageSquare } from "lucide-react";

import type { Answer, CodeRef } from "@/lib/types";
import { cn } from "@/lib/utils";

type Audience = "technical" | "executive";

interface AnswerBodyProps {
  answer: Answer;
  answeredLocally: boolean;
  /** Focus the Nth code citation in the code panel. */
  onFocusCode: (index: number) => void;
  /** Focus the pivotal conversation message. */
  onFocusConversation: () => void;
}

export function AnswerBody({
  answer,
  answeredLocally,
  onFocusCode,
  onFocusConversation,
}: AnswerBodyProps) {
  const [audience, setAudience] = React.useState<Audience>("technical");
  const view = answer[audience];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-xl text-foreground sm:text-2xl">
          {answer.question}
        </h2>
        {answeredLocally && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            Answered locally
          </span>
        )}
      </div>

      {/* Audience segmented control */}
      <div
        role="tablist"
        aria-label="Answer audience"
        className="inline-flex w-fit rounded-lg border border-border bg-muted/50 p-0.5"
      >
        {(
          [
            { id: "technical" as const, label: "Technical", Icon: Wrench },
            { id: "executive" as const, label: "Executive", Icon: Briefcase },
          ]
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={audience === id}
            onClick={() => setAudience(id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
              audience === id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {audience === id && (
              <motion.span
                layoutId="audience-pill"
                className="absolute inset-0 rounded-md bg-background shadow-sm"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <Icon className="relative size-3.5" aria-hidden />
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={audience}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22 }}
          className="flex flex-col gap-3"
        >
          <p
            className={cn(
              "rounded-lg border-l-2 py-1.5 pl-3 text-[15px] leading-relaxed text-foreground",
              audience === "technical"
                ? "border-code"
                : "border-conversation"
            )}
          >
            {view.summary}
          </p>
          <div className="flex flex-col gap-2.5">
            {view.body.map((para, i) => (
              <p
                key={i}
                className="text-[13.5px] leading-relaxed text-muted-foreground"
              >
                {para}
              </p>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Click-to-source references */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Grounded in
        </p>
        <div className="flex flex-wrap gap-1.5">
          {answer.codeCitations.map((c: CodeRef, i) => (
            <button
              key={`code-${i}`}
              type="button"
              onClick={() => onFocusCode(i)}
              className="inline-flex items-center gap-1.5 rounded-md border border-code/50 bg-code-soft px-2 py-0.5 font-mono text-[11px] text-code transition-colors hover:border-code"
            >
              <FileCode2 className="size-3" aria-hidden />
              {c.symbol}
            </button>
          ))}
          <button
            type="button"
            onClick={onFocusConversation}
            className="inline-flex items-center gap-1.5 rounded-md border border-conversation/50 bg-conversation-soft px-2 py-0.5 text-[11px] text-conversation transition-colors hover:border-conversation"
          >
            <MessageSquare className="size-3" aria-hidden />
            Jump to the decision
          </button>
        </div>
      </div>
    </div>
  );
}
