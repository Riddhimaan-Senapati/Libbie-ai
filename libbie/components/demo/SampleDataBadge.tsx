import { FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Small, tasteful pill marking authored sample data (NFR-6). Reusable across the app.
 */
export function SampleDataBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-border/70 bg-muted/40 px-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase",
        className,
      )}
    >
      <FlaskConical aria-hidden="true" className="text-conversation" />
      Sample data
    </Badge>
  );
}
