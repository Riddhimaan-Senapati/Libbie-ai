"use client";

import { CheckCircle2, Lock, ServerCog, ShieldCheck } from "lucide-react";

import { LibbieAvatar } from "@/components/LibbieAvatar";
import { localAnswer } from "@/lib/data";
import { Reveal, SectionHeading } from "@/components/landing/reveal";

const GUARANTEES: string[] = [
  "Local models by default (llama.cpp, or vLLM on Linux + NVIDIA), with no network egress",
  "Or bring your own key for OpenAI-compatible providers and Anthropic",
  "Download a chat model straight from Hugging Face, inside the app",
  "A running count of tokens per call and session, with an estimated cost for cloud models",
  "Air-gapped deployment for regulated pharma and biotech, where data can't leave the building",
];

const LOCAL = localAnswer();

/** Runs your way: local by default, or any cloud provider you point her at. */
export function AirGapped() {
  return (
    <section id="runs" className="relative overflow-hidden border-t border-border py-24 sm:py-28">
      <div className="pointer-events-none absolute right-0 top-0 -z-10 h-[400px] w-[400px] glow-primary opacity-50" aria-hidden />

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-5 sm:px-8 lg:grid-cols-2">
        <Reveal>
          <div>
            <SectionHeading
              eyebrow="Runs your way"
              title="On your machine, or on any model you choose."
              description="By default Libbie runs local models with nothing leaving your machine, which is what regulated pharma and biotech R&D need. When you'd rather use a hosted model, point her at any cloud provider with your own key."
            />
            <ul className="mt-8 space-y-3">
              {GUARANTEES.map((g) => (
                <li key={g} className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
                  <span className="text-sm leading-relaxed text-foreground">{g}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={0.12}>
          <div className="rounded-3xl bg-gradient-to-b from-accent to-tint p-3 sm:p-4">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" aria-hidden />

            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <LibbieAvatar size={34} showStatus />
                <div className="leading-tight">
                  <p className="text-sm font-medium text-foreground">Libbie</p>
                  <p className="font-mono text-[11px] text-ok">Answering on-device · no network</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-2.5 py-1 font-mono text-[11px] text-ok">
                <Lock className="size-3" aria-hidden />
                Answered locally
              </span>
            </div>

            <h3 className="text-xl font-semibold tracking-tight text-foreground">Runs in your secure enclave</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {LOCAL
                ? `Sensitive questions like “${LOCAL.chip}” are answered by Libbie's local model path, entirely on-prem, with the same dual-cited provenance.`
                : "Sensitive questions are answered by Libbie's local model path, entirely on-prem, with the same dual-cited provenance."}
            </p>

            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-6">
              {[
                { icon: <ShieldCheck className="size-4" aria-hidden />, label: "On-device", sub: "local model" },
                { icon: <Lock className="size-4" aria-hidden />, label: "Zero egress", sub: "by design" },
                { icon: <ServerCog className="size-4" aria-hidden />, label: "Self-hosted", sub: "your infra" },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg border border-border bg-muted/40 p-3 text-center">
                  <span className="mb-1.5 inline-grid place-items-center text-primary">{stat.icon}</span>
                  <p className="text-xs font-semibold text-foreground">{stat.label}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{stat.sub}</p>
                </div>
              ))}
            </div>
          </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
