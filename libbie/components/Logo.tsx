import { cn } from "@/lib/utils";

/**
 * The Libbie.ai brand logo lockup (node-mark + "libbie" wordmark).
 * Set the height via className (e.g. `h-7`); width scales automatically.
 */
export function Logo({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/libbie-logo.svg"
      alt="Libbie.ai"
      draggable={false}
      className={cn("w-auto select-none", className)}
    />
  );
}
