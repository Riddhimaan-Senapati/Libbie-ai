import { SampleDataBadge } from "@/components/demo/SampleDataBadge";

/** Lightweight route boundary while the sample workspace code is loading. */
export default function DemoLoading() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <SampleDataBadge />
        <div className="size-7 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="Loading sample workspace" />
        <p className="text-sm text-muted-foreground">Loading the sample workspace…</p>
      </div>
    </main>
  );
}
