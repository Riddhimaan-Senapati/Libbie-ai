"use client";

import { SampleDataBadge } from "@/components/demo/SampleDataBadge";

export default function DemoError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <SampleDataBadge />
        <h1 className="font-display text-2xl text-foreground">The sample workspace could not load</h1>
        <p className="text-sm text-muted-foreground">No customer data is shown on this page. Try loading the sample again.</p>
        <button type="button" onClick={reset} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Try again</button>
      </div>
    </main>
  );
}
