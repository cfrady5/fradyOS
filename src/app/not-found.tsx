import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-muted-foreground text-sm">That page or record doesn&apos;t exist, or it belongs to another workspace.</p>
      <Link href="/" className="text-primary text-sm hover:underline">Back to Today</Link>
    </main>
  );
}
