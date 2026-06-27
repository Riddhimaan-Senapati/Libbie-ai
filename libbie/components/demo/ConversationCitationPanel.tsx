"use client";

import * as React from "react";
import { motion } from "motion/react";
import {
  MessageSquare,
  GitPullRequest,
  Users,
  Mail,
  Star,
  type LucideIcon,
} from "lucide-react";

import { getConversation } from "@/lib/data";
import type { Conversation, ConversationKind } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ConversationCitationPanelProps {
  conversationIds: string[];
  /** When set (and > 0), scroll the pivotal message of the active conversation into view. */
  focusKey: number;
}

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

function Initials({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-conversation-soft text-[10px] font-semibold text-conversation">
      {initials}
    </span>
  );
}

function Message({
  msg,
  kind,
  pivotalRef,
}: {
  msg: Conversation["messages"][number];
  kind: ConversationKind;
  pivotalRef?: React.Ref<HTMLDivElement>;
}) {
  const emailLike = kind === "email";
  return (
    <motion.div
      ref={pivotalRef}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "flex gap-2",
        msg.pivotal && "scroll-mt-4"
      )}
    >
      <Initials name={msg.author} />
      <div
        className={cn(
          "min-w-0 flex-1 rounded-lg border px-3 py-2 transition-shadow",
          msg.pivotal
            ? "border-conversation/70 bg-conversation-soft shadow-[0_0_0_1px_var(--conversation),0_4px_24px_-6px_color-mix(in_oklch,var(--conversation)_60%,transparent)]"
            : "border-border bg-background/40",
          emailLike && !msg.pivotal && "bg-muted/30"
        )}
      >
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-semibold text-foreground">
            {msg.author}
          </span>
          {msg.role && (
            <span className="text-[10px] text-muted-foreground">{msg.role}</span>
          )}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
            {msg.time}
          </span>
          {msg.pivotal && (
            <span className="inline-flex items-center gap-1 rounded-md bg-conversation/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-conversation">
              <Star className="size-2.5 fill-current" aria-hidden />
              Justification
            </span>
          )}
        </div>
        <p
          className={cn(
            "text-[13px] leading-relaxed",
            msg.pivotal ? "text-foreground" : "text-foreground/80"
          )}
        >
          {msg.body}
        </p>
      </div>
    </motion.div>
  );
}

function ConversationCard({
  conversation,
  focusKey,
}: {
  conversation: Conversation;
  focusKey: number;
}) {
  const Icon = KIND_ICON[conversation.kind];
  const pivotalRef = React.useRef<HTMLDivElement>(null);
  let pivotalSeen = false;

  React.useEffect(() => {
    if (focusKey > 0 && pivotalRef.current) {
      pivotalRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusKey]);

  return (
    <div className="overflow-hidden rounded-lg border border-conversation/50 bg-conversation-soft/20">
      <div className="flex items-start gap-2 border-b border-conversation/40 bg-conversation-soft px-3 py-2">
        <Icon className="mt-0.5 size-3.5 shrink-0 text-conversation" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">
            {conversation.title}
          </p>
          <p className="truncate font-mono text-[10px] text-conversation/90">
            {conversation.source} · {conversation.date}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {conversation.participants.join(", ")}
          </p>
        </div>
        <span className="shrink-0 rounded-md bg-conversation/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-conversation">
          {KIND_LABEL[conversation.kind]}
        </span>
      </div>

      <div className="flex max-h-72 flex-col gap-2.5 overflow-auto p-3">
        {conversation.messages.map((m, i) => {
          const isFirstPivotal = m.pivotal && !pivotalSeen;
          if (m.pivotal) pivotalSeen = true;
          return (
            <Message
              key={i}
              msg={m}
              kind={conversation.kind}
              pivotalRef={isFirstPivotal ? pivotalRef : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

export function ConversationCitationPanel({
  conversationIds,
  focusKey,
}: ConversationCitationPanelProps) {
  const conversations = conversationIds
    .map((id) => getConversation(id))
    .filter((c): c is Conversation => Boolean(c));

  return (
    <motion.section
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="flex min-w-0 flex-col rounded-xl border border-conversation/40 bg-card/60 p-3"
      aria-label="Conversation citation"
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-conversation-soft text-conversation">
          <MessageSquare className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-conversation">
            Conversation
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            The decision that justified it
          </p>
        </div>
      </header>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {conversations.map((c) => (
          <ConversationCard key={c.id} conversation={c} focusKey={focusKey} />
        ))}
      </div>
    </motion.section>
  );
}
