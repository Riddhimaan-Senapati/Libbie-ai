"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  FileCode2,
  MessageSquare,
  GitPullRequest,
  Users,
  Mail,
  Star,
  Plus,
  ShieldCheck,
  ChevronDown,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

import { getCodeFile, getConversation } from "@/lib/data";
import { LibbieAvatar } from "@/components/LibbieAvatar";
import type {
  Answer,
  CodeRef,
  Conversation,
  ConversationKind,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<ConversationKind, LucideIcon> = {
  chat: MessageSquare,
  pr: GitPullRequest,
  meeting: Users,
  email: Mail,
};
const KIND_LABEL: Record<ConversationKind, string> = {
  chat: "Chat",
  pr: "PR review",
  meeting: "Meeting",
  email: "Email",
};

const COMMENT_RE = /^\s*(\/\/|#)/;

type Hover = "code" | "conv" | null;

// ---- code citation card ------------------------------------------------------

function CodeCard({
  ref_,
  hover,
  setHover,
  onFocus,
}: {
  ref_: CodeRef;
  hover: Hover;
  setHover: (h: Hover) => void;
  onFocus: () => void;
}) {
  const file = getCodeFile(ref_.path);
  if (!file) return null;
  const lines = file.content.replace(/\n$/, "").split("\n");
  // show a small window around the cited range
  const pad = 2;
  const from = Math.max(1, ref_.lineStart - pad);
  const to = Math.min(lines.length, ref_.lineEnd + pad);

  const dim = hover === "conv";
  const raised = hover === "code";

  return (
    <button
      type="button"
      onMouseEnter={() => setHover("code")}
      onMouseLeave={() => setHover(null)}
      onClick={onFocus}
      className={cn(
        "block w-full overflow-hidden rounded-xl border text-left transition-all",
        "border-code/50 bg-code-soft/25",
        raised && "ring-2 ring-code/50",
        dim && "opacity-50",
      )}
      aria-label={`Code citation: ${ref_.path} lines ${ref_.lineStart} to ${ref_.lineEnd}. Focus on canvas.`}
    >
      <div className="flex items-center gap-2 border-b border-code/30 bg-code-soft/60 px-3 py-1.5">
        <FileCode2 className="size-3.5 shrink-0 text-code" aria-hidden />
        <span className="truncate font-mono text-[11px] text-code">{ref_.path}</span>
        <span className="ml-auto shrink-0 rounded bg-code/10 px-1.5 py-0.5 font-mono text-[10px] text-code/90">
          L{ref_.lineStart}
          {ref_.lineEnd !== ref_.lineStart ? `–${ref_.lineEnd}` : ""}
        </span>
      </div>
      <pre className="overflow-x-auto py-1.5 font-mono text-[11.5px] leading-relaxed">
        <code>
          {lines.slice(from - 1, to).map((line, idx) => {
            const lineNo = from + idx;
            const cited = lineNo >= ref_.lineStart && lineNo <= ref_.lineEnd;
            const isComment = COMMENT_RE.test(line);
            return (
              <div
                key={lineNo}
                className={cn(
                  "flex px-3",
                  cited && "bg-code/15 shadow-[inset_2px_0_0_var(--code)]",
                )}
              >
                <span
                  className={cn(
                    "mr-3 w-6 shrink-0 select-none text-right tabular-nums",
                    cited ? "text-code/90" : "text-muted-foreground/40",
                  )}
                >
                  {lineNo}
                </span>
                <span
                  className={cn(
                    "whitespace-pre",
                    cited
                      ? "text-foreground"
                      : isComment
                        ? "italic text-muted-foreground/45"
                        : "text-foreground/70",
                  )}
                >
                  {line || " "}
                </span>
              </div>
            );
          })}
        </code>
      </pre>
    </button>
  );
}

// ---- conversation citation card ----------------------------------------------

function ConvInitials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-conversation-soft text-[9px] font-semibold text-conversation">
      {initials}
    </span>
  );
}

function ConvCard({
  conv,
  hover,
  setHover,
}: {
  conv: Conversation;
  hover: Hover;
  setHover: (h: Hover) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const Icon = KIND_ICON[conv.kind];
  const pivotalIdx = conv.messages.findIndex((m) => m.pivotal);
  const shown = expanded
    ? conv.messages
    : conv.messages.filter((_, i) => i === pivotalIdx || pivotalIdx === -1);

  const dim = hover === "code";
  const raised = hover === "conv";

  return (
    <div
      onMouseEnter={() => setHover("conv")}
      onMouseLeave={() => setHover(null)}
      className={cn(
        "overflow-hidden rounded-xl border transition-all",
        "border-conversation/50 bg-conversation-soft/15",
        raised && "ring-2 ring-conversation/50",
        dim && "opacity-50",
      )}
    >
      <div className="flex items-start gap-2 border-b border-conversation/30 bg-conversation-soft/50 px-3 py-1.5">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-conversation" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11.5px] font-semibold text-foreground">{conv.title}</p>
          <p className="truncate font-mono text-[10px] text-conversation/90">
            {conv.source} · {conv.date}
          </p>
        </div>
        <span className="shrink-0 rounded bg-conversation/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-conversation">
          {KIND_LABEL[conv.kind]}
        </span>
      </div>

      <div className="flex flex-col gap-2 p-2.5">
        {shown.map((m, i) => (
          <div key={i} className="flex gap-2">
            <ConvInitials name={m.author} />
            <div
              className={cn(
                "min-w-0 flex-1 rounded-lg border px-2.5 py-1.5",
                m.pivotal
                  ? "border-conversation/60 bg-conversation-soft/70"
                  : "border-border bg-background/40",
              )}
            >
              <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2">
                <span className="text-[11px] font-semibold text-foreground">{m.author}</span>
                {m.role && (
                  <span className="text-[9.5px] text-muted-foreground">{m.role}</span>
                )}
                <span className="ml-auto font-mono text-[9px] text-muted-foreground/70">
                  {m.time}
                </span>
                {m.pivotal && (
                  <span className="inline-flex items-center gap-1 rounded bg-conversation/15 px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-conversation">
                    <Star className="size-2 fill-current" aria-hidden />
                    Justification
                  </span>
                )}
              </div>
              <p
                className={cn(
                  "text-[12px] leading-relaxed",
                  m.pivotal ? "text-foreground" : "text-foreground/80",
                )}
              >
                {m.body}
              </p>
            </div>
          </div>
        ))}

        {conv.messages.length > shown.length || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="self-start rounded-md px-1.5 py-0.5 text-[10.5px] font-medium text-conversation/90 transition-colors hover:bg-conversation/10"
          >
            {expanded
              ? "Collapse thread"
              : `Expand full thread (${conv.messages.length} messages)`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---- the answer surface ------------------------------------------------------

export function AnswerSurface({
  answer,
  view,
  onViewChange,
  onFocusCode,
  answeredLocally,
}: {
  answer: Answer;
  view: "technical" | "executive";
  onViewChange: (v: "technical" | "executive") => void;
  /** Click a code citation → focus it on the center canvas. */
  onFocusCode: (ref: CodeRef) => void;
  answeredLocally: boolean;
}) {
  const [hover, setHover] = React.useState<Hover>(null);
  const content = answer[view];
  const conv = getConversation(answer.conversationCitations[0]);
  const codeRef = answer.codeCitations[0];

  return (
    <motion.div
      key={answer.id + view}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-3"
    >
      {/* verdict */}
      <div className="flex gap-2.5">
        <LibbieAvatar size={30} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-foreground">Libbie</span>
            {answeredLocally && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary">
                <WifiOff className="size-2.5" aria-hidden />
                Simulated on-device · sample data
              </span>
            )}
            {/* technical / executive control */}
            <div className="ml-auto inline-flex rounded-full border border-border bg-muted/40 p-0.5">
              {(["technical", "executive"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => onViewChange(v)}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                    view === v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "technical" ? "for me" : "for my VP"}
                </button>
              ))}
            </div>
          </div>
          <p className="font-display text-[15px] leading-snug text-foreground">
            {content.summary}
          </p>
        </div>
      </div>

      {/* expandable detail */}
      <Detail body={content.body} />

      {/* evidence — dual citation fusion */}
      <div className="relative flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-3 text-primary" aria-hidden />
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Evidence
          </span>
        </div>

        {codeRef && (
          <CodeCard
            ref_={codeRef}
            hover={hover}
            setHover={setHover}
            onFocus={() => onFocusCode(codeRef)}
          />
        )}

        {/* fusion connector */}
        {codeRef && conv && (
          <div className="flex items-center gap-2 pl-1">
            <span className="h-4 w-px bg-gradient-to-b from-code/60 to-conversation/60" />
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full border bg-card transition-colors",
                hover
                  ? "border-primary/60 text-primary"
                  : "border-border text-muted-foreground",
              )}
            >
              <Plus className="size-3" aria-hidden />
            </span>
            <span className="text-[10px] text-muted-foreground">
              Both sources, same decision
            </span>
          </div>
        )}

        {conv && <ConvCard conv={conv} hover={hover} setHover={setHover} />}
      </div>
    </motion.div>
  );
}

function Detail({ body }: { body: string[] }) {
  const [open, setOpen] = React.useState(false);
  if (body.length === 0) return null;
  return (
    <div className="pl-[38px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary/90 transition-colors hover:text-primary"
      >
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
          aria-hidden
        />
        {open ? "Hide reasoning" : "Show full reasoning"}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-col gap-2 border-l-2 border-border pl-3">
              {body.map((p, i) => (
                <p key={i} className="text-[12.5px] leading-relaxed text-muted-foreground">
                  <InlineCode text={p} />
                </p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Render backtick `code` spans in mono without a markdown dep. */
function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code
            key={i}
            className="rounded bg-code-soft/60 px-1 py-0.5 font-mono text-[11.5px] text-code"
          >
            {part.slice(1, -1)}
          </code>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}
