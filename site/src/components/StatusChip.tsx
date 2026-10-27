/** "OPEN TO NEW PROJECTS" chip: mono uppercase with a 7px lichen dot. */
export function StatusChip({ children }: { children: string }) {
  return (
    <span className="label inline-flex h-8 items-center gap-2.5 border border-border-strong px-3 text-label">
      <span aria-hidden="true" className="status-dot size-[7px] bg-lichen" />
      {children}
    </span>
  );
}
