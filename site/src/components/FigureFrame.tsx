import { Crosshairs } from "./Crosshairs";
import { cx } from "@/lib/cx";

/** Bordered figure with crosshair corners, "FIG. 0X" top-left and a mono caption bottom-right. */
export function FigureFrame({ index, caption, children, className, bodyClassName, bordered = true }: { index: string; caption: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; bordered?: boolean }) {
  return (
    <figure className={cx("relative", bordered && "border border-hairline", className)}>
      <Crosshairs />
      <span className="label pointer-events-none absolute top-3 left-3 z-10">FIG. {index}</span>
      <div className={cx("relative", bodyClassName)}>{children}</div>
      <figcaption className="label pointer-events-none absolute right-3 bottom-3 z-10 text-right">{caption}</figcaption>
    </figure>
  );
}
