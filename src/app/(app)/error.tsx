"use client";

import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-start gap-3 py-10">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground text-sm">{error.message || "An unexpected error occurred while loading this page."}</p>
      {error.digest ? <p className="text-muted-foreground text-xs">Reference: {error.digest}</p> : null}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
