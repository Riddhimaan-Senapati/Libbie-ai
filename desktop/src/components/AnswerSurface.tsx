import * as React from "react";
import { m as motion } from "motion/react";
import {
  Code2,
  MessageSquareText,
  Plus,
  ShieldCheck,
  WifiOff,
  ChevronRight,
} from "lucide-react";

import type { CodeRef } from "@/lib/types";
import type { Retrieved } from "@/lib/rag";
import { getCodeFile } from "@/lib/data";
import { verdictStore } from "@/lib/verdictStore";
import { cn } from "@/lib/utils";
import { LibbieAvatar } from "@/components/LibbieAvatar";

const KIND_LABEL: Record<string, string> = {
  chat: "Slack",
  pr: "Pull request",
  meeting: "Meeting",
  email: "Email",
};

export function AnswerSurface({
  question,
  streaming,
  retrieved,
  view,
  onViewChange,
  onFocusCode,
  answeredLocally,
  engineLabel,
}: {
  question: string;
  streaming: boolean;
  retrieved: Retrieved;
  view: "technical" | "executive";
  onViewChange: (v: "technical" | "executive") => void;
  onFocusCode: (ref: CodeRef) => void;
  answeredLocally: boolean;
  engineLabel?: string;
}) {
  const [openConv, setOpenConv] = React.useState<string | null>(
    retrieved.conversations[0]?.id ?? null,
  );
  // The streamed text lives in the verdict store, so tokens re-render only
  // this paragraph, not the workspace around it.
  const verdict = React.useSyncExternalStore(verdictStore.subscribe, verdictStore.get);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="selectable"
    >
      {/* the question, quiet */}
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        You asked
      </p>
      <p className="mb-4 text-[13px] font-medium text-foreground">{question}</p>

      {/* verdict — Libbie's voice, types in as tokens stream */}
      <div className="mb-4 flex gap-2.5">
        <LibbieAvatar size={28} thinking={streaming} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">
            {verdict}
            {streaming && (
              <motion.span
                className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-primary"
                animate={{ opacity: [1, 0.2, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            )}
          </p>
        </div>
      </div>

      {/* audience toggle + local tag */}
      <div className="mb-3 flex items-center gap-2">
        <div className="inline-flex rounded-full border border-border bg-muted/40 p-0.5 text-[11px]">
          {(["technical", "executive"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              className={cn(
                "rounded-full px-2.5 py-1 font-medium transition-colors",
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "technical" ? "For me" : "For my VP"}
            </button>
          ))}
        </div>
        {answeredLocally && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[10.5px] font-medium text-primary">
            <WifiOff className="size-3" aria-hidden />
            Answered locally{engineLabel ? ` · ${engineLabel}` : ""}
          </span>
        )}
      </div>

      {/* dual citation — the trust backbone */}
      {!streaming && (
        <div className="space-y-2">
          {/* code side (teal/blue) */}
          {retrieved.code.map((ref, i) => {
            const file = getCodeFile(ref.path);
            const snippet = file
              ? (file.content.split("\n")[ref.lineStart - 1] ?? "").trim()
              : "";
            return (
              <button
                key={`${ref.path}-${i}`}
                type="button"
                onClick={() => onFocusCode(ref)}
                className="group block w-full rounded-lg border border-code bg-code-soft p-3 text-left transition-colors hover:border-code/70"
              >
                <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-code">
                  <Code2 className="size-3.5" aria-hidden />
                  Code · {ref.symbol}
                  <ChevronRight className="ml-auto size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {ref.path}:{ref.lineStart}
                </p>
                {snippet && (
                  <p className="mt-1 truncate font-mono text-[11.5px] text-foreground/90">
                    {snippet}
                  </p>
                )}
              </button>
            );
          })}

          {/* fusion connector */}
          {retrieved.code.length > 0 && retrieved.conversations.length > 0 && (
            <div className="flex items-center justify-center gap-2 py-0.5 text-[10px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span className="inline-flex items-center gap-1">
                <Plus className="size-3" aria-hidden /> same decision
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
          )}

          {/* conversation side (amber) */}
          {retrieved.conversations.map((conv) => {
            const open = openConv === conv.id;
            const pivotal = conv.messages.find((m) => m.pivotal) ?? conv.messages[0];
            return (
              <div
                key={conv.id}
                className="rounded-lg border border-conversation bg-conversation-soft p-3"
              >
                <button
                  type="button"
                  onClick={() => setOpenConv(open ? null : conv.id)}
                  className="block w-full text-left"
                >
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-conversation">
                    <MessageSquareText className="size-3.5" aria-hidden />
                    {KIND_LABEL[conv.kind] ?? "Conversation"}
                    <ChevronRight
                      className={cn(
                        "ml-auto size-3.5 transition-transform",
                        open && "rotate-90",
                      )}
                      aria-hidden
                    />
                  </div>
                  <p className="truncate text-[11.5px] font-medium text-foreground">
                    {conv.title}
                  </p>
                  <p className="truncate text-[10.5px] text-muted-foreground">
                    {conv.source} · {conv.date}
                  </p>
                </button>

                {/* pivotal message elevated */}
                <div className="mt-2 rounded-md bg-background/60 p-2">
                  <p className="text-[10.5px] font-medium text-conversation">
                    {pivotal.author}
                    {pivotal.role ? ` · ${pivotal.role}` : ""}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-foreground/90">
                    {pivotal.body}
                  </p>
                </div>

                {open && conv.messages.length > 1 && (
                  <div className="mt-2 space-y-2 border-t border-conversation/20 pt-2">
                    {conv.messages
                      .filter((m) => m !== pivotal)
                      .map((m, i) => (
                        <div key={i}>
                          <p className="text-[10px] font-medium text-muted-foreground">
                            {m.author}
                            {m.role ? ` · ${m.role}` : ""} · {m.time}
                          </p>
                          <p className="text-[11.5px] leading-relaxed text-foreground/80">
                            {m.body}
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* confidence line */}
          <div className="flex items-center gap-1.5 pt-1 text-[10.5px] text-muted-foreground">
            <ShieldCheck className="size-3.5 text-ok" aria-hidden />
            {retrieved.code.length > 0 && retrieved.conversations.length > 0
              ? "Both sources agree · "
              : ""}
            <span className="font-medium text-foreground">
              {Math.round(retrieved.confidence * 100)}% confidence
            </span>
            <span className="ml-1 text-muted-foreground/70">
              · {retrieved.mode === "vector" ? "semantic vector search" : "keyword search"}
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}
