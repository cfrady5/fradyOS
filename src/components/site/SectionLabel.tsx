/** "01 / HOW I WORK" style section label. */
export function SectionLabel({ index, children, id }: { index: string; children: string; id?: string }) {
  return (
    <p id={id} className="label">
      <span className="text-label">{index}</span>
      <span className="mx-2 text-crosshair" aria-hidden="true">/</span>
      <span>{children}</span>
    </p>
  );
}
