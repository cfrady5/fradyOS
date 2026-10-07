import { Skeleton } from "@/components/ui/skeleton";

/** Route-level skeleton: mirrors a page header, a metric strip and a short list of rows. */
export default function Loading() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="border-line-1 bg-surface-1 grid grid-cols-2 gap-px overflow-hidden rounded-lg border md:grid-cols-4 [&>*]:bg-surface-1 [&>*]:px-4 [&>*]:py-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-[18px] rounded-full" />
            <Skeleton className="h-4 flex-1" style={{ maxWidth: `${62 - i * 6}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
