"use client";

import * as React from "react";
import { m as motion, AnimatePresence } from "motion/react";
import {
  FileText,
  Download,
  Loader2,
  Check,
  UserMinus,
  FolderTree,
  Boxes,
  Lightbulb,
  Code2,
  MessagesSquare,
  Target,
  FlaskConical,
} from "lucide-react";
import { toast } from "sonner";

import {
  pipeline,
  staleness,
  answers,
  getConversation,
} from "@/lib/data";
import type { Answer, StalenessItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

// --- generation steps --------------------------------------------------------

const STEPS = [
  "Consolidating purpose…",
  "Resolving environment & dependencies…",
  "Locating files…",
  "Reconstructing key reasoning…",
] as const;

const STEP_MS = 460;
const GENERATED_LABEL = new Date().toISOString().slice(0, 10);
const FILE_NAME = "germline-varcall-handover.md";

// --- markdown builder (also drives the download) -----------------------------

function buildMarkdown(): string {
  const deps = staleness.filter((s) => s.kind !== "reference-build");
  const ref = staleness.find((s) => s.kind === "reference-build");

  const lines: string[] = [];
  lines.push(`# Handover & Onboarding — ${pipeline.name}`);
  lines.push("");
  lines.push(`> ⚠️ Contains **sample data** (Libbie.ai demo).`);
  lines.push("");
  lines.push(`- **Pipeline:** ${pipeline.name} (${pipeline.family})`);
  lines.push(`- **Repository:** ${pipeline.repo}`);
  lines.push(`- **Original author:** ${pipeline.author.name}, ${pipeline.author.role}`);
  lines.push(`- **Departed:** ${pipeline.author.departed}`);
  lines.push(`- **Generated:** ${GENERATED_LABEL}`);
  lines.push(
    `- **Corpus:** ${pipeline.stats.files} files · ${pipeline.stats.conversations} conversations · ${pipeline.stats.commits} commits`,
  );
  lines.push("");

  lines.push(`## 1. Purpose`);
  lines.push("");
  lines.push(pipeline.description);
  lines.push("");

  lines.push(`## 2. Environment & pinned dependencies`);
  lines.push("");
  if (ref) {
    lines.push(`**Reference build:** ${ref.pinned} → current ${ref.current} (${ref.status}).`);
    lines.push(`> ${ref.caution}`);
    lines.push("");
  }
  lines.push(`| Dependency | Pinned | Current | Status | Source |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const d of deps) {
    lines.push(`| ${d.name} | \`${d.pinned}\` | \`${d.current}\` | ${d.status} | ${d.source} |`);
  }
  lines.push("");

  lines.push(`## 3. File locations`);
  lines.push("");
  for (const f of pipeline.files) {
    lines.push(`- \`${f.path}\` — ${f.description}`);
  }
  lines.push("");

  lines.push(`## 4. Key reasoning (reconstructed decisions)`);
  lines.push("");
  answers.forEach((a, i) => {
    lines.push(`### 4.${i + 1} ${a.question}`);
    lines.push("");
    lines.push(a.technical.summary);
    lines.push("");
    lines.push(`**Citations:**`);
    for (const c of a.codeCitations) {
      lines.push(`- Code: \`${c.path}:${c.lineStart}-${c.lineEnd}\` (${c.symbol})`);
    }
    for (const id of a.conversationCitations) {
      const conv = getConversation(id);
      if (conv) lines.push(`- Conversation: ${conv.source} — "${conv.title}" (${conv.date})`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

function downloadMarkdown(): void {
  const blob = new Blob([buildMarkdown()], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = FILE_NAME;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast.success("Handover document downloaded", { description: FILE_NAME });
}

// --- citation chips ----------------------------------------------------------

function ReasoningCard({ answer, index }: { answer: Answer; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      className="rounded-xl border border-border bg-card/50 p-4"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[0.7rem] text-muted-foreground">
          {index + 1}
        </span>
        <div className="min-w-0">
          <h4 className="font-display text-base leading-snug">{answer.question}</h4>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {answer.technical.summary}
          </p>

          <div className="mt-3 flex flex-col gap-1.5">
            {answer.codeCitations.map((c) => (
              <div
                key={`${c.path}-${c.lineStart}`}
                className="flex items-center gap-1.5 font-mono text-[0.7rem] text-code"
              >
                <Code2 className="size-3 shrink-0" />
                <span className="truncate">
                  {c.path}:{c.lineStart}
                  {c.lineEnd !== c.lineStart ? `-${c.lineEnd}` : ""}
                </span>
                <span className="text-muted-foreground">· {c.symbol}</span>
              </div>
            ))}
            {answer.conversationCitations.map((id) => {
              const conv = getConversation(id);
              if (!conv) return null;
              return (
                <div
                  key={id}
                  className="flex items-center gap-1.5 text-[0.7rem] text-conversation"
                >
                  <MessagesSquare className="size-3 shrink-0" />
                  <span className="truncate">{conv.source}</span>
                  <span className="truncate text-muted-foreground">· {conv.title}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// --- generation overlay ------------------------------------------------------

function GeneratingView({ activeStep }: { activeStep: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 px-6 py-16">
      <div className="relative flex size-16 items-center justify-center">
        <div className="glow-primary absolute inset-0 rounded-full" aria-hidden />
        <Loader2 className="size-10 animate-spin text-primary" />
      </div>
      <div className="w-full max-w-sm space-y-2">
        {STEPS.map((step, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          return (
            <div
              key={step}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                active && "bg-muted/60 text-foreground",
                done && "text-muted-foreground",
                !active && !done && "text-muted-foreground/40",
              )}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {done ? (
                  <Check className="size-3.5 text-ok" />
                ) : active ? (
                  <Loader2 className="size-3.5 animate-spin text-primary" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              {step}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- the assembled document --------------------------------------------------

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function SectionHeading({
  icon,
  num,
  children,
}: {
  icon: React.ReactNode;
  num: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border pb-2">
      <span className="flex size-7 items-center justify-center rounded-lg bg-code-soft text-code">
        {icon}
      </span>
      <h3 className="font-display text-lg">
        <span className="mr-2 font-mono text-sm text-muted-foreground">{num}</span>
        {children}
      </h3>
    </div>
  );
}

function DepTable({ deps, refItem }: { deps: StalenessItem[]; refItem?: StalenessItem }) {
  return (
    <div className="space-y-3">
      {refItem && (
        <div
          className="rounded-lg border p-3"
          style={{
            borderColor: "color-mix(in oklch, var(--danger) 35%, transparent)",
            backgroundColor: "color-mix(in oklch, var(--danger) 8%, transparent)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">{refItem.name}</span>
            <span className="font-mono text-xs">
              <span className="text-foreground">{refItem.pinned}</span>
              <span className="mx-1.5 text-danger">→</span>
              <span className="text-muted-foreground">{refItem.current}</span>
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{refItem.caution}</p>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[0.7rem] tracking-wide text-muted-foreground uppercase">
              <th className="px-3 py-2 font-medium">Dependency</th>
              <th className="px-3 py-2 font-medium">Pinned</th>
              <th className="px-3 py-2 font-medium">Current</th>
              <th className="px-3 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {deps.map((d) => (
              <tr key={d.name} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2 text-foreground">{d.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-foreground">{d.pinned}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{d.current}</td>
                <td className="px-3 py-2 font-mono text-[0.7rem] text-muted-foreground/70">
                  {d.source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HandoverDocument() {
  const ref = staleness.find((s) => s.kind === "reference-build");
  const deps = staleness.filter((s) => s.kind !== "reference-build");

  return (
    <motion.article
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35 }}
      className="space-y-8 px-1 pb-2"
    >
      {/* Title block */}
      <header className="space-y-4 rounded-xl border border-border bg-card/40 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-conversation/40 bg-conversation-soft px-2 py-0.5 text-[0.65rem] font-medium text-conversation">
              <FlaskConical className="size-2.5" /> Sample data
            </span>
            <h2 className="mt-2 font-display text-2xl leading-tight">
              Handover &amp; Onboarding
            </h2>
            <p className="font-mono text-sm text-muted-foreground">{pipeline.name}</p>
          </div>
          <FileText className="size-8 shrink-0 text-muted-foreground/40" />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-3">
          <MetaRow label="Family" value={pipeline.family} />
          <MetaRow label="Repository" value={<span className="font-mono text-xs">{pipeline.repo}</span>} />
          <MetaRow label="Generated" value={<span className="font-mono">{GENERATED_LABEL}</span>} />
        </dl>
      </header>

      {/* 1. Purpose */}
      <section className="space-y-3">
        <SectionHeading icon={<Target className="size-4" />} num={1}>
          Purpose
        </SectionHeading>
        <p className="text-sm leading-relaxed text-muted-foreground">{pipeline.description}</p>
      </section>

      {/* 2. Author & departure */}
      <section className="space-y-3">
        <SectionHeading icon={<UserMinus className="size-4" />} num={2}>
          Original author
        </SectionHeading>
        <div className="flex items-center gap-3 rounded-lg border border-conversation/30 bg-conversation-soft p-3">
          <div>
            <div className="text-sm font-medium text-foreground">{pipeline.author.name}</div>
            <div className="text-xs text-muted-foreground">{pipeline.author.role}</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[0.65rem] tracking-wide text-muted-foreground uppercase">
              Departed
            </div>
            <div className="text-sm text-conversation">{pipeline.author.departed}</div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground/80">
          No handover document was written at departure. The reasoning below was reconstructed by
          Libbie.ai from code, conversations and domain knowledge.
        </p>
      </section>

      {/* 3. Environment & deps */}
      <section className="space-y-3">
        <SectionHeading icon={<Boxes className="size-4" />} num={3}>
          Environment &amp; pinned dependencies
        </SectionHeading>
        <DepTable deps={deps} refItem={ref} />
      </section>

      {/* 4. File locations */}
      <section className="space-y-3">
        <SectionHeading icon={<FolderTree className="size-4" />} num={4}>
          File locations
        </SectionHeading>
        <ul className="space-y-1.5">
          {pipeline.files.map((f) => (
            <li
              key={f.path}
              className="flex flex-col gap-0.5 rounded-lg border border-border bg-card/40 px-3 py-2 sm:flex-row sm:items-center sm:gap-3"
            >
              <span className="font-mono text-xs text-code">{f.path}</span>
              <span className="text-xs text-muted-foreground">{f.description}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 5. Key reasoning */}
      <section className="space-y-3">
        <SectionHeading icon={<Lightbulb className="size-4" />} num={5}>
          Key reasoning
        </SectionHeading>
        <div className="space-y-3">
          {answers.map((a, i) => (
            <ReasoningCard key={a.id} answer={a} index={i} />
          ))}
        </div>
      </section>

      <footer className="border-t border-border pt-4 text-center text-[0.7rem] text-muted-foreground/70">
        Generated by Libbie.ai · {GENERATED_LABEL} · Contains sample data
      </footer>
    </motion.article>
  );
}

// --- exported dialog ---------------------------------------------------------

export function HandoverDialog() {
  const [open, setOpen] = React.useState(false);
  const [phase, setPhase] = React.useState<"generating" | "done">("generating");
  const [activeStep, setActiveStep] = React.useState(0);

  // Reset to the generating state when the dialog opens (adjust state during
  // render rather than in an effect to avoid an extra render pass).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPhase("generating");
      setActiveStep(0);
    }
  }

  React.useEffect(() => {
    if (!open) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    STEPS.forEach((_, i) => {
      timers.push(setTimeout(() => setActiveStep(i), i * STEP_MS));
    });
    timers.push(
      setTimeout(() => {
        setActiveStep(STEPS.length);
        setPhase("done");
      }, STEPS.length * STEP_MS),
    );

    return () => timers.forEach(clearTimeout);
  }, [open]);

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <FileText className="size-4" />
        Generate handover document
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className="flex max-h-[88vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="min-w-0">
              <DialogTitle className="font-display text-base">
                Handover document
              </DialogTitle>
              <DialogDescription className="text-xs">
                {phase === "generating"
                  ? "Reconstructing institutional memory…"
                  : "Reconstructed from code + conversations · sample data"}
              </DialogDescription>
            </div>
            {phase === "done" && (
              <Button size="sm" onClick={downloadMarkdown} className="mr-8 gap-1.5">
                <Download className="size-3.5" />
                Download
              </Button>
            )}
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="p-5">
              <AnimatePresence mode="wait">
                {phase === "generating" ? (
                  <motion.div
                    key="gen"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <GeneratingView activeStep={activeStep} />
                  </motion.div>
                ) : (
                  <motion.div key="doc">
                    <HandoverDocument />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
