import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Libbie's presence mark — a soft, premium orb with a calm "thinking" state.
 * Ported verbatim from the web app so her identity is consistent across
 * surfaces.
 */
export function LibbieAvatar({
  size = 36,
  thinking = false,
  showStatus = false,
  className,
}: {
  size?: number;
  thinking?: boolean;
  showStatus?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* squircle base */}
      <span
        className="absolute inset-0 rounded-[30%] border border-primary/25"
        style={{
          background:
            "radial-gradient(120% 120% at 30% 20%, color-mix(in oklch, var(--primary) 26%, var(--card)), var(--card) 70%)",
          boxShadow: "inset 0 1px 0 0 color-mix(in oklch, white 8%, transparent)",
        }}
      />
      {/* thinking ring */}
      {thinking && (
        <motion.span
          className="absolute rounded-full"
          style={{
            inset: size * 0.12,
            background:
              "conic-gradient(from 0deg, transparent, color-mix(in oklch, var(--primary) 60%, transparent), transparent 60%)",
            maskImage: "radial-gradient(closest-side, transparent 64%, #000 66%)",
            WebkitMaskImage: "radial-gradient(closest-side, transparent 64%, #000 66%)",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
        />
      )}
      {/* core orb */}
      <motion.span
        className="relative rounded-full bg-primary"
        style={{
          width: size * 0.42,
          height: size * 0.42,
          boxShadow: "0 0 12px 1px color-mix(in oklch, var(--primary) 55%, transparent)",
        }}
        animate={thinking ? { scale: [1, 0.82, 1], opacity: [1, 0.7, 1] } : { scale: 1, opacity: 1 }}
        transition={
          thinking
            ? { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.3 }
        }
      />
      {showStatus && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-ok ring-2 ring-background" />
      )}
    </span>
  );
}
