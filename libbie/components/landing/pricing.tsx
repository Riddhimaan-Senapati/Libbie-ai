"use client";

import { Check, Sparkles } from "lucide-react";

import { freemium } from "@/lib/data";
import { Reveal, SectionHeading } from "@/components/landing/reveal";

const FREE_FEATURES: string[] = [
  `${freemium.limit} questions answered / month`,
  "Dual-cited code + conversation provenance",
  "Technical & executive answer views",
  "Connect one GitHub repo, Slack, or mailbox",
];

const ENTERPRISE_FEATURES: string[] = [
  "Unlimited questions across every pipeline",
  "On-prem and air-gapped, with nothing leaving your machine",
  "Bring your own model: local, OpenAI-compatible, or Anthropic",
  "Connect GitHub, Slack, and email; explore the full provenance graph",
  "Token and cost tracking, with priority support",
];

/** Pricing: a Free tier (freemium numbers) and a paid Enterprise / on-prem tier. */
export function Pricing() {
  return (
    <section id="pricing" className="relative border-t border-border bg-tint py-24 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <SectionHeading
            align="center"
            eyebrow="Pricing"
            title="Start free. Bring Libbie in-house when it matters."
            description="Ask Libbie at no cost. Move her on-prem when your code and conversations are too valuable to leave your environment."
          />
        </Reveal>

        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-1 items-stretch gap-5 lg:grid-cols-2">
          {/* Free tier */}
          <Reveal delay={0.05}>
            <div className="flex h-full flex-col rounded-2xl border border-border bg-card p-7">
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold tracking-tight text-foreground">Free</h3>
                <span className="font-mono text-xs text-muted-foreground">{freemium.resetLabel}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">For getting to know Libbie on a single pipeline.</p>
              <p className="mt-5 font-display text-4xl font-semibold text-foreground">
                $0
                <span className="ml-1 align-middle text-base font-normal text-muted-foreground">/ month</span>
              </p>

              {/* Quiet account state */}
              <p className="mt-4 font-mono text-[11px] text-muted-foreground">
                {freemium.used} of {freemium.limit} questions used this month
              </p>

              <ul className="mt-6 space-y-3">
                {FREE_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="mt-7 h-11 w-full rounded-full border border-border bg-background text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Start free
              </button>
            </div>
          </Reveal>

          {/* Enterprise tier */}
          <Reveal delay={0.12}>
            <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-primary/50 bg-card p-7">
              <div className="pointer-events-none absolute inset-0 -z-10 glow-primary opacity-40" aria-hidden />
              <div className="flex items-baseline justify-between">
                <h3 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                  Enterprise
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <Sparkles className="size-3" aria-hidden />
                    On-prem
                  </span>
                </h3>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                For regulated teams that keep code and conversations in-house.
              </p>
              <p className="mt-5 font-display text-4xl font-semibold text-foreground">Custom</p>
              <p className="mt-1 text-xs text-muted-foreground">Volume & deployment-based pricing.</p>

              <ul className="mt-6 space-y-3">
                {ENTERPRISE_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                className="mt-7 h-11 w-full rounded-full bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
              >
                Talk to sales
              </button>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
