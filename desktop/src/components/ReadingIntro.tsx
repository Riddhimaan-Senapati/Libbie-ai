import * as React from "react";
import { motion } from "motion/react";

import { pipeline, libbie } from "@/lib/data";
import { LibbieAvatar } from "@/components/LibbieAvatar";
import { Logo } from "@/components/Logo";

const LINES = [
  "Reading the pipeline, end to end…",
  "Fusing code with the conversations behind it…",
  "Building your queryable memory…",
];

/** A brief "Libbie is reading…" moment over the corpus stats, then continue. */
export function ReadingIntro({ onDone }: { onDone: () => void }) {
  const [line, setLine] = React.useState(0);

  React.useEffect(() => {
    const t1 = setTimeout(() => setLine(1), 650);
    const t2 = setTimeout(() => setLine(2), 1300);
    const t3 = setTimeout(onDone, 2050);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [onDone]);

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-background">
      <div className="bg-grid bg-grid-fade absolute inset-0 opacity-70" aria-hidden />
      <div className="glow-primary absolute inset-x-0 top-0 h-1/2" aria-hidden />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex flex-col items-center text-center"
      >
        <Logo className="mb-8 h-7" />
        <LibbieAvatar size={72} thinking showStatus />

        <motion.p
          key={line}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="mt-6 text-[15px] font-medium text-foreground"
        >
          {LINES[line]}
        </motion.p>

        <div className="mt-6 flex items-center gap-6 font-mono text-[12px] text-muted-foreground">
          <Stat n={pipeline.stats.files} label="files" />
          <Stat n={pipeline.stats.conversations} label="conversations" />
          <Stat n={pipeline.stats.commits} label="commits" />
        </div>

        <p className="mt-8 max-w-sm text-[12px] leading-relaxed text-muted-foreground/80">
          {libbie.role}
        </p>

        <button
          type="button"
          onClick={onDone}
          className="mt-6 text-[12px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Skip
        </button>
      </motion.div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex flex-col items-center">
      <span className="text-lg font-semibold text-primary">{n.toLocaleString()}</span>
      <span className="text-[10.5px] uppercase tracking-wide">{label}</span>
    </span>
  );
}
