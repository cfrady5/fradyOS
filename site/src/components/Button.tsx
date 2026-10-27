import Link from "next/link";
import { cx } from "@/lib/cx";

type Props = { children: React.ReactNode; variant?: "primary" | "secondary"; href?: string; arrow?: boolean; className?: string; onClick?: () => void; type?: "button" | "submit" };

/** Square 48px buttons. Primary is ink on ground; secondary is a 1px border. Renders a real link when `href` is given. */
export function Button({ children, variant = "primary", href, arrow = variant === "primary", className, onClick, type = "button" }: Props) {
  const cls = cx(
    "inline-flex h-12 items-center justify-center gap-2.5 px-5 text-[15px] font-medium transition-colors",
    variant === "primary" ? "bg-ink text-ground hover:bg-lichen" : "border border-border-strong text-ink hover:border-body",
    className,
  );
  const inner = (
    <>
      {children}
      {arrow ? <span aria-hidden="true">→</span> : null}
    </>
  );
  if (href) {
    const external = /^(https?:|mailto:)/.test(href);
    return external ? (
      <a href={href} className={cls} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noopener noreferrer" : undefined}>
        {inner}
      </a>
    ) : (
      <Link href={href} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
