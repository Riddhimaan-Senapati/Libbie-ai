"use client";

import { Lock, Zap } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { freemium } from "@/lib/data";
import { cn } from "@/lib/utils";

/**
 * Visible freemium usage counter + a locked, non-functional Enterprise upgrade
 * affordance (MR-1, MR-3). Compact enough to live in the app header.
 */
export function FreemiumCounter({ className }: { className?: string }) {
  const { used, limit, resetLabel } = freemium;
  const pct = Math.min(100, Math.round((used / limit) * 100));

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div
        className="hidden min-w-[120px] flex-col gap-1 sm:flex"
        aria-label={`${used} of ${limit} free queries used. ${resetLabel}.`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Zap aria-hidden="true" className="size-3 text-primary" />
            <span className="font-mono tabular-nums text-foreground">{used}</span>
            <span className="text-muted-foreground/70">/ {limit}</span>
            <span className="text-muted-foreground/60">free</span>
          </span>
        </div>
        <Progress
          value={pct}
          aria-hidden="true"
          className="h-1"
        />
      </div>

      <TooltipProvider delay={150}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  toast("On-prem / air-gapped deployment is an Enterprise feature.", {
                    description:
                      "Unlimited queries behind your own firewall. Talk to us about a self-hosted Libbie.ai.",
                  })
                }
                className="gap-1.5 border-border/70 text-muted-foreground hover:text-foreground"
              >
                <Lock aria-hidden="true" className="text-conversation" />
                <span className="hidden md:inline">On-prem</span>
                <span className="hidden font-mono text-[10px] tracking-wide text-muted-foreground/70 uppercase lg:inline">
                  Enterprise
                </span>
              </Button>
            }
          />
          <TooltipContent>
            Unlock unlimited, air-gapped queries — Enterprise
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
