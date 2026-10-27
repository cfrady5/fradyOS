import Link from "next/link";
import { PixelLogo } from "./PixelLogo";
import { site } from "@/lib/site/copy";

const LINKS: [string, string][] = [
  ["Work", "/work"],
  ["Ventures", "/ventures"],
  ["Writing", "/writing"],
  ["About", "/about"],
];

/** Floating, centred navigation: logo square, text links (hidden on phones) and the email button. */
export function Nav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-5 z-50 flex justify-center px-4">
      <nav aria-label="Primary" className="pointer-events-auto flex items-center gap-0.5 border border-border-strong bg-ground/85 p-1.5 backdrop-blur-md">
        <Link href="/" aria-label="FRADY home" className="flex size-10 shrink-0 items-center justify-center bg-ink">
          <PixelLogo />
        </Link>
        <ul className="hidden items-center md:flex">
          {LINKS.map(([label, href]) => (
            <li key={href}>
              <Link href={href} className="block px-3.5 py-2 text-[15px] text-body transition-colors hover:text-ink">
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <a href={`mailto:${site.email}`} className="ml-1 flex h-10 items-center bg-ink px-3.5 font-mono text-[12px] tracking-[0.04em] text-ground transition-colors hover:bg-lichen">
          {site.email}
        </a>
      </nav>
    </header>
  );
}
