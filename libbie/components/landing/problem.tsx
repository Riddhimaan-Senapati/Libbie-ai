import { Clock, FileCode2, MessagesSquare, Users } from "lucide-react";

import { LibbieAvatar } from "@/components/LibbieAvatar";
import { libbie, proactiveNudge, pipeline } from "@/lib/data";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

const TRAITS: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <MessagesSquare className="size-5" aria-hidden />,
    title: "Proactive, not a search box",
    body:
      "She flags the load-bearing decisions that have gone stale before you ask, with the thread that explains each one already attached.",
  },
  {
    icon: <FileCode2 className="size-5" aria-hidden />,
    title: "Cites code and conversation",
    body:
      "Every answer leads with a one-line verdict, then shows the exact line of code and the human conversation that justified it.",
  },
  {
    icon: <Users className="size-5" aria-hidden />,
    title: "Speaks to both audiences",
    body:
      "The same reconstructed reasoning, written for an engineer or for a VP, without making you re-explain it.",
  },
  {
    icon: <Clock className="size-5" aria-hidden />,
    title: "Honest about staleness",
    body:
      `When ${pipeline.author.name} left in ${pipeline.author.departed} the rationale behind ${pipeline.stats.commits} commits went with her. Libbie keeps it, and tells you when it's drifting.`,
  },
];

/** Meet Libbie — her persona and voice as an ambient chief of staff. */
export function MeetLibbie() {
  return (
    <section id="meet" className="relative border-t border-border py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[1fr_1.05fr]">
          <Reveal>
            <div>
              <SectionHeading
                eyebrow="Meet Libbie"
                title="A chief of staff who has read everything."
                description="Libbie is the colleague who never makes you feel behind. She leads with the answer, names the people who made the call, and shows where it came from."
              />

              {/* Libbie's own voice */}
              <div className="mt-8 rounded-2xl border border-border bg-card/70 p-5 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2.5">
                  <LibbieAvatar size={32} showStatus />
                  <div className="leading-tight">
                    <p className="text-sm font-medium text-foreground">{libbie.name}</p>
                    <p className="font-mono text-[11px] text-ok">{libbie.idleStatus}</p>
                  </div>
                </div>
                <p className="mt-3 text-pretty text-sm leading-relaxed text-foreground">
                  “{libbie.greeting}”
                </p>
              </div>

              {/* The signature proactive nudge */}
              <div className="mt-4 overflow-hidden rounded-2xl border border-conversation/50 bg-conversation-soft">
                <div className="flex items-center gap-2 border-b border-conversation/30 px-4 py-2.5 text-conversation">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                    Pinned by Libbie · before you asked
                  </span>
                </div>
                <div className="px-4 py-3.5">
                  <p className="text-sm font-medium leading-snug text-foreground">{proactiveNudge.title}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{proactiveNudge.body}</p>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2">
              {TRAITS.map((t) => (
                <article key={t.title} className="flex h-full flex-col gap-3 bg-card p-6">
                  <span className="grid size-10 place-items-center rounded-lg border border-border bg-muted text-primary">
                    {t.icon}
                  </span>
                  <h3 className="text-base font-semibold tracking-tight text-foreground">{t.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{t.body}</p>
                </article>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
