/** "+" glyphs on the four corners of a featured frame. */
export function Crosshairs() {
  const pos = ["-top-[9px] -left-[5px]", "-top-[9px] -right-[5px]", "-bottom-[9px] -left-[5px]", "-bottom-[9px] -right-[5px]"];
  return (
    <>
      {pos.map((p) => (
        <span key={p} aria-hidden="true" className={`pointer-events-none absolute ${p} font-mono text-[13px] leading-none text-crosshair select-none`}>
          +
        </span>
      ))}
    </>
  );
}
