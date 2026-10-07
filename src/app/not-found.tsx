import Link from "next/link";
import { Wordmark } from "@/components/app/wordmark";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="bg-surface-0 flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <Wordmark size="md" />
      <p className="index">404</p>
      <h1 className="text-title text-text-1">Not found</h1>
      <p className="text-text-2 max-w-sm text-sm">That page or record doesn&apos;t exist, or it belongs to another workspace.</p>
      <Button asChild variant="outline" size="sm">
        <Link href="/">Back to Today</Link>
      </Button>
    </main>
  );
}
