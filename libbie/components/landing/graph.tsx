import { Reveal } from "@/components/landing/reveal";
import { SectionHeading } from "@/components/landing/section-heading";

const KINDS: { label: string; dot: string }[] = [
  { label: "Code & files", dot: "bg-code" },
  { label: "Conversations", dot: "bg-conversation" },
  { label: "Decisions", dot: "bg-primary" },
  { label: "Jobs & parameters", dot: "bg-muted-foreground" },
  { label: "Papers & findings", dot: "bg-ok" },
];

/** The provenance graph: typed nodes, committed vs inferred edges, explorable. */
export function GraphSection() {
  return (
    <section id="graph" className="relative overflow-hidden border-t border-border bg-tint py-24 sm:py-28">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid bg-grid-fade opacity-50" aria-hidden />

      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <SectionHeading
            align="center"
            eyebrow="Provenance graph"
            title="Every link, laid out as a graph you can walk."
            description="Libbie turns your code, jobs, conversations, and papers into typed nodes and draws the edges between them. Links she has confirmed are solid; the ones she is still inferring stay dashed, so you can tell what's settled from what's a lead."
          />
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {KINDS.map((k) => (
              <span key={k.label} className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <span className={`size-2.5 rounded-full ${k.dot}`} aria-hidden />
                {k.label}
              </span>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.15}>
          <figure className="mt-8">
            <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/desktop-graph.png"
                alt="Libbie's provenance graph: colored nodes for files, messages, decisions, and parameters, joined by solid committed edges and dashed inferred edges."
                width={1262}
                height={568}
                loading="lazy"
                decoding="async"
                className="w-full"
              />
            </div>
            <figcaption className="mt-3 text-center text-xs text-muted-foreground">
              Filter by node kind or edge type, and click any node to see what connects to it. Shown with sample data.
            </figcaption>
          </figure>
        </Reveal>
      </div>
    </section>
  );
}
