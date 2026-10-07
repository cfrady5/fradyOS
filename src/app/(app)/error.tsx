"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl py-6">
      <EmptyState
        variant="page"
        icon={<AlertTriangle className="text-danger" />}
        title="Something went wrong"
        description={error.message || "An unexpected error occurred while loading this page."}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={reset}>Try again</Button>
            {error.digest ? <span className="text-text-3 index">ref {error.digest}</span> : null}
          </div>
        }
      />
    </div>
  );
}
