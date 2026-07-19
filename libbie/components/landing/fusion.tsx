"use client";

import { motion, type Variants } from "motion/react";
import { FileCode2, MessagesSquare, Quote, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { LibbieAvatar } from "@/components/LibbieAvatar";
import { getAnswer, getConversation, getCodeFile } from "@/lib/data";
import { Reveal, SectionHeading } from "@/components/landing/reveal";

// Ground the trust backbone in the real GRCh37 reference-build example.
const ANSWER = getAnswer("ans-grch37");
const CONVERSATION = getConversation("conv-grch37-chat");
const CODE_FILE = getCodeFile("conf/params.config");

/** Pulls the cited code lines out of the full file content (1-based, inclusive). */
function citedSnippet(): { line: number; text: string }[] {
  if (!ANSWER || !CODE_FILE) return [];
  const ref = ANSWER.codeCitations[0];
  const lines = CODE_FILE.content.split("\n");
  const start = Math.max(1, ref.lineStart - 1);
  const end = Math.min(lines.length, ref.lineEnd + 1);
  const out: { line: number; text: string }[] = [];
  for (let n = start; n <= end; n++) out.push({ line: n, text: lines[n - 1] ?? "" });
  return out;
}

const cardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 16 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "She reads code and conversations",
    body: "Libbie indexes the repository alongside its Slack threads, PR reviews, meeting notes and email, then links each decision to the line it explains.",
  },
  {
    n: "02",
    title: "You ask her anything",
    body: "Ask “why GRCh37?” the way you'd ask the person who left, without a query language or hours digging through history.",
  },
  {
    n: "03",
    title: "She answers, with receipts",
    body: "A one-line verdict, then the dual citation (code and conversation), written in technical or executive form.",
  },
];

/** How she answers: the dual-citation fusion as the trust backbone. */
export function HowSheAnswers() {
  if (!ANSWER || !CONVERSATION || !CODE_FILE) return null;

  const codeRef = ANSWER.codeCitations[0];
  const pivotal = CONVERSATION.messages.find((m) => m.pivotal) ?? CONVERSATION.messages[0];
  const snippet = citedSnippet();

  return (
    <section id="how" className="relative overflow-hidden border-t border-border bg-tint py-24 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid bg-grid-fade opacity-50" aria-hidden />

      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <SectionHeading
            align="center"
            eyebrow="How she answers"
            title={
              <>
                Every answer fuses <span className="text-code">code</span> and{" "}
                <span className="text-conversation">conversation</span>.
              </>
            }
            description="The dual citation is how Libbie earns your trust: the line that does the work, plus the conversation that justified it, both pointing at the same intent."
          />
        </Reveal>

        {/* Three steps */}
        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.07}>
              <article className="flex h-full flex-col gap-2.5 rounded-xl border border-border bg-card p-5">
                <span className="font-mono text-xs text-primary">{s.n}</span>
                <h3 className="text-sm font-semibold tracking-tight text-foreground">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </article>
            </Reveal>
          ))}
        </div>

        {/* The question */}
        <Reveal delay={0.1} className="mx-auto mt-12 max-w-2xl">
          <div className="rounded-xl border border-border bg-card/70 p-5 text-center shadow-sm backdrop-blur">
            <p className="mb-1.5 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Asked in plain language
            </p>
            <p className="font-display text-xl text-foreground sm:text-2xl">“{ANSWER.question}”</p>
          </div>
        </Reveal>

        {/* Two converging sources */}
        <motion.div
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-100px" }}
          transition={{ staggerChildren: 0.12 }}
          className="mt-10 grid grid-cols-1 items-stretch gap-5 lg:grid-cols-[1fr_auto_1fr]"
        >
          {/* Code source card */}
          <motion.article variants={cardVariants} className="overflow-hidden rounded-xl border border-code bg-card">
            <header className="flex items-center justify-between gap-2 border-b border-code/30 bg-code-soft px-4 py-3">
              <div className="flex items-center gap-2 text-code">
                <FileCode2 className="size-4" aria-hidden />
                <span className="font-mono text-xs">{codeRef.path}</span>
              </div>
              <span className="rounded-full border border-code/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-code">
                Code
              </span>
            </header>
            <div className="overflow-x-auto p-4">
              <pre className="font-mono text-[13px] leading-relaxed">
                <code>
                  {snippet.map(({ line, text }) => {
                    const isCited = line >= codeRef.lineStart && line <= codeRef.lineEnd;
                    return (
                      <div key={line} className={cn("-mx-2 flex gap-3 rounded px-2", isCited && "bg-code-soft")}>
                        <span className="w-5 shrink-0 select-none text-right text-muted-foreground/50">{line}</span>
                        <span className={cn("whitespace-pre text-muted-foreground", isCited && "text-foreground")}>
                          {text || " "}
                        </span>
                      </div>
                    );
                  })}
                </code>
              </pre>
            </div>
            <footer className="border-t border-border px-4 py-2.5 font-mono text-[11px] text-code">
              cite · {codeRef.symbol}
            </footer>
          </motion.article>

          {/* Fusion connector */}
          <div className="flex items-center justify-center lg:flex-col">
            <span className="hidden h-full w-px bg-gradient-to-b from-code/40 via-border to-conversation/40 lg:block" aria-hidden />
            <span className="my-2 grid size-9 shrink-0 place-items-center rounded-full border border-border bg-card text-primary shadow-sm" aria-hidden>
              <Plus className="size-4" />
            </span>
            <span className="hidden h-full w-px bg-gradient-to-b from-conversation/40 via-border to-code/40 lg:block" aria-hidden />
          </div>

          {/* Conversation source card */}
          <motion.article variants={cardVariants} className="overflow-hidden rounded-xl border border-conversation bg-card">
            <header className="flex items-center justify-between gap-2 border-b border-conversation/30 bg-conversation-soft px-4 py-3">
              <div className="flex items-center gap-2 text-conversation">
                <MessagesSquare className="size-4" aria-hidden />
                <span className="font-mono text-xs">{CONVERSATION.source}</span>
              </div>
              <span className="rounded-full border border-conversation/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-conversation">
                Conversation
              </span>
            </header>
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-full bg-conversation-soft font-mono text-[11px] font-semibold text-conversation">
                  {pivotal.author.split(" ").map((w) => w[0]).join("")}
                </span>
                <div className="leading-tight">
                  <p className="text-sm font-medium text-foreground">{pivotal.author}</p>
                  {pivotal.role ? <p className="text-[11px] text-muted-foreground">{pivotal.role}</p> : null}
                </div>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">{CONVERSATION.date}</span>
              </div>
              <div className="relative rounded-lg border border-conversation/30 bg-conversation-soft p-3">
                <Quote className="absolute right-2 top-2 size-4 text-conversation/40" aria-hidden />
                <p className="pr-5 text-sm leading-relaxed text-foreground">{pivotal.body}</p>
              </div>
            </div>
            <footer className="border-t border-border px-4 py-2.5 font-mono text-[11px] text-conversation">
              cite · {CONVERSATION.title}
            </footer>
          </motion.article>
        </motion.div>

        {/* Libbie's fused verdict */}
        <Reveal delay={0.15} className="mx-auto mt-6 max-w-3xl">
          <article className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-8">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-code via-primary to-conversation" aria-hidden />
            <div className="mb-4 flex items-start gap-3">
              <LibbieAvatar size={30} showStatus className="mt-0.5" />
              <p className="text-base font-medium leading-relaxed text-foreground">{ANSWER.technical.summary}</p>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{ANSWER.technical.body[1]}</p>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <span className="text-xs text-muted-foreground">Both sources, same decision:</span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-code bg-code-soft px-2 py-1 font-mono text-[11px] text-code">
                <FileCode2 className="size-3" aria-hidden />
                {codeRef.path}:{codeRef.lineStart}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-conversation bg-conversation-soft px-2 py-1 font-mono text-[11px] text-conversation">
                <MessagesSquare className="size-3" aria-hidden />
                {CONVERSATION.source}
              </span>
            </div>
          </article>
        </Reveal>
      </div>
    </section>
  );
}
