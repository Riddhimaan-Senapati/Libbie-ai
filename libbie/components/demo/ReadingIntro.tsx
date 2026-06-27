"use client";

import * as React from "react";
import { motion } from "motion/react";

import { pipeline } from "@/lib/data";
import { LibbieAvatar } from "@/components/LibbieAvatar";
import { SampleDataBadge } from "@/components/demo/SampleDataBadge";

const READING_STATUSES = [
  `Reading ${pipeline.stats.files} files…`,
  `Tracing ${pipeline.stats.conversations.toLocaleString()} conversations…`,
  `Cross-referencing ${pipeline.stats.commits} commits…`,
] as const;

const DURATION_MS = 1500;

export function ReadingIntro({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    const each = DURATION_MS / READING_STATUSES.length;
    const timers = READING_STATUSES.map((_, i) =>
      setTimeout(() => setStep(i), i * each),
    );
    const done = setTimeout(onComplete, DURATION_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(done);
    };
  }, [onComplete]);

  return (
    <div className="relative flex min-h-[70vh] flex-col items-center justify-center px-6">
      <div className="bg-grid bg-grid-fade pointer-events-none absolute inset-0 opacity-30" aria-hidden />

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col items-center text-center"
      >
        <LibbieAvatar size={72} thinking />
        <h1 className="mt-6 font-display text-2xl text-foreground">Libbie is reading…</h1>

        <div className="mt-3 h-5">
          <motion.p
            key={step}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="font-mono text-[13px] text-muted-foreground"
          >
            {READING_STATUSES[step]}
          </motion.p>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <SampleDataBadge />
          <button
            type="button"
            onClick={onComplete}
            className="rounded-md px-2 py-1 text-[12px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Skip
          </button>
        </div>
      </motion.div>
    </div>
  );
}
