"use client";

import Link from "next/link";
import { Hexagon } from "lucide-react";

import { FreemiumCounter } from "@/components/demo/FreemiumCounter";
import { LocalModeToggle } from "@/components/demo/LocalModeToggle";
import { SampleDataBadge } from "@/components/demo/SampleDataBadge";
import { Separator } from "@/components/ui/separator";
import { brand, pipeline } from "@/lib/data";

/**
 * Sticky, glassy top navigation for the demo app. Fully controlled — owns no
 * state; local-mode is lifted to the parent.
 */
export function AppHeader({
  localMode,
  onLocalModeChange,
}: {
  localMode: boolean;
  onLocalModeChange: (v: boolean) => void;
}) {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6">
        {/* Left — wordmark */}
        <Link
          href="/"
          aria-label={`${brand.name} home`}
          className="group flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="relative grid size-7 place-items-center rounded-md border border-code/40 bg-code-soft">
            <Hexagon
              aria-hidden="true"
              className="size-4 text-code transition-transform group-hover:rotate-[30deg]"
            />
            <span className="absolute size-1 rounded-full bg-conversation" />
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-foreground">
            {brand.name}
          </span>
        </Link>

        {/* Center — connected codebase */}
        <div className="hidden flex-1 items-center justify-center md:flex">
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-3 py-1">
            <span className="relative flex size-2 items-center justify-center">
              <span className="absolute inline-flex size-2 animate-ping rounded-full bg-ok/60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-ok" />
            </span>
            <span className="text-[11px] text-muted-foreground">Connected</span>
            <Separator
              orientation="vertical"
              className="mx-0.5 !h-3.5"
            />
            <span className="font-mono text-[11px] text-foreground">
              <span className="text-muted-foreground">{pipeline.repo}</span>
            </span>
          </div>
        </div>

        {/* Right — controls */}
        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3 md:ml-0">
          <SampleDataBadge className="hidden lg:inline-flex" />
          <FreemiumCounter />
          <Separator orientation="vertical" className="!h-6" />
          <LocalModeToggle
            checked={localMode}
            onCheckedChange={onLocalModeChange}
          />
        </div>
      </div>
    </header>
  );
}
