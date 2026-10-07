import { cn } from "@/lib/utils";

/** Brand mark: "frady" in foreground, "OS" in the primary accent. */
export function Wordmark({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span className={cn("inline-flex items-baseline font-semibold tracking-tight select-none", size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base", className)} aria-label="FRADY OS">
      <span>frady</span>
      <span className="text-brand-soft">OS</span>
    </span>
  );
}
