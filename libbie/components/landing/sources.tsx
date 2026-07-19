"use client";

import { GitBranch, Mail, MessagesSquare } from "lucide-react";

import { Reveal, SectionHeading } from "@/components/landing/reveal";

const SOURCES: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <GitBranch className="size-5" aria-hidden />,
    title: "GitHub repositories",
    body:
      "Connect your account and index any repo you can reach, including private and org-owned ones. Libbie reads the code, commits, and pull-request history.",
  },
  {
    icon: <MessagesSquare className="size-5" aria-hidden />,
    title: "Slack",
    body:
      "Pick the channels and DMs that matter and pull them in. The thread where a call was made becomes part of Libbie's memory.",
  },
  {
    icon: <Mail className="size-5" aria-hidden />,
    title: "Email",
    body:
      "Connect Gmail or any IMAP mailbox, read-only, and choose the labels to index. The rationale that lived in an email stops being lost.",
  },
];

/** Connect your sources: the real ingestion story (GitHub, Slack, email → memory). */
export function Sources() {
  return (
    <section id="sources" className="relative border-t border-border py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <SectionHeading
            eyebrow="Your real work"
            title="She reads the sources you already use."
            description="Point Libbie at your GitHub repositories, Slack, and email. She indexes the code and the conversations around it into a local store, then ties each decision back to where it was made."
          />
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {SOURCES.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.07}>
              <article className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-6">
                <span className="grid size-10 place-items-center rounded-lg border border-border bg-muted text-primary">
                  {s.icon}
                </span>
                <h3 className="text-base font-semibold tracking-tight text-foreground">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </article>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.1}>
          <figure className="mt-12">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/desktop-connectors.png"
                alt="Libbie desktop settings showing the Hugging Face model download, Connect GitHub, and Slack connectors."
                width={1262}
                height={568}
                className="w-full"
              />
            </div>
            <figcaption className="mt-3 text-center text-xs text-muted-foreground">
              The desktop app, connecting sources and downloading a model. Shown with sample data.
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
