import Link from "next/link";
import { ArrowRight, FlaskConical } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { LibbieAvatar } from "@/components/LibbieAvatar";
import { Logo } from "@/components/Logo";
import { brand, pipeline } from "@/lib/data";
import { Reveal } from "@/components/landing/reveal";

const FOOTER_LINKS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "How she answers", href: "#how" },
      { label: "Sources", href: "#sources" },
      { label: "Provenance graph", href: "#graph" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    heading: "Deployment",
    links: [
      { label: "Runs your way", href: "#runs" },
      { label: "Local & air-gapped", href: "#runs" },
      { label: "Meet Libbie", href: "/demo" },
    ],
  },
];

/** Final call-to-action and the product footer (includes NFR-6 sample-data note). */
export function CtaFooter() {
  return (
    <>
      <section className="relative overflow-hidden border-t border-border py-24 sm:py-28">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-grid bg-grid-fade" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[500px] glow-primary" aria-hidden />

        <Reveal className="mx-auto max-w-3xl px-5 text-center sm:px-8">
          <div className="mb-7 flex justify-center">
            <LibbieAvatar size={48} showStatus />
          </div>
          <h2 className="text-balance font-display text-4xl font-normal leading-[1.08] tracking-tight text-foreground sm:text-5xl">
            Libbie remembers why. So you don&apos;t have to.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
            Watch her reconstruct the intent behind a real germline variant-calling pipeline,
            cited to the code and the conversation behind it.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/demo"
              className={cn(buttonVariants({ variant: "default", size: "lg" }), "group h-12 gap-2 rounded-full px-7 text-sm")}
            >
              Meet Libbie
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <a
              href="#pricing"
              className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "h-12 rounded-full px-7 text-sm")}
            >
              View pricing
            </a>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
            <div className="col-span-2 sm:col-span-2">
              <Link href="/" className="flex items-center" aria-label={`${brand.name} home`}>
                <Logo className="h-7" />
              </Link>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
                The colleague who remembers why every pipeline was built this way.
              </p>

              {/* NFR-6: clearly-visible sample-data note */}
              <div className="mt-5 inline-flex items-start gap-2 rounded-lg border border-conversation/40 bg-conversation-soft px-3 py-2 text-xs text-conversation">
                <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  Demo uses authored sample data. The {pipeline.repo} pipeline and its conversations
                  are illustrative.
                </span>
              </div>
            </div>

            {FOOTER_LINKS.map((group) => (
              <div key={group.heading}>
                <h3 className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  {group.heading}
                </h3>
                <ul className="space-y-2.5">
                  {group.links.map((link) => (
                    <li key={`${group.heading}-${link.label}`}>
                      {link.href.startsWith("/") ? (
                        <Link href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                          {link.label}
                        </Link>
                      ) : (
                        <a href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} {brand.name}. Sample data for demonstration only.</p>
            <p className="font-mono">Built on an open-source stack · Next.js · React · TypeScript · Tailwind</p>
          </div>
        </div>
      </footer>
    </>
  );
}
