import { cn } from "@/lib/utils";

/**
 * The Libbie.ai brand logo lockup. Set the height via className (e.g. `h-6`);
 * width scales automatically. The SVG is bundled locally (no network).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/libbie-logo.svg"
      alt="Libbie.ai"
      draggable={false}
      className={cn("w-auto select-none", className)}
    />
  );
}
