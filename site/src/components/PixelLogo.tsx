/** Pixel "f" mark: a 6x8 bitmap drawn as crisp SVG squares. */
const ROWS = ["..###.", ".#....", ".#....", "####..", ".#....", ".#....", ".#....", ".#...."];

export function PixelLogo({ className, color = "var(--ground)" }: { className?: string; color?: string }) {
  const rects: { x: number; y: number }[] = [];
  ROWS.forEach((row, y) => row.split("").forEach((c, x) => c === "#" && rects.push({ x, y })));
  return (
    <svg viewBox="0 0 6 8" width="18" height="24" aria-hidden="true" className={className} shapeRendering="crispEdges">
      {rects.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width="1" height="1" fill={color} />
      ))}
    </svg>
  );
}
