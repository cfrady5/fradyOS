import { Crosshairs } from "./Crosshairs";
import { cn } from "@/lib/utils";

/** Frame for an interactive pixel figure, with crosshair corners. */
export function FigureFrame({ children, className, bodyClassName, bordered = true }: { children: React.ReactNode; className?: string; bodyClassName?: string; bordered?: boolean }) {
  return (
    <figure className={cn("relative", bordered && "border border-hairline", className)}>
      <Crosshairs />
      <div className={cn("relative", bodyClassName)}>{children}</div>
    </figure>
  );
}
