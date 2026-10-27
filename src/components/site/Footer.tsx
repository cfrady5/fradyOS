import Link from "next/link";
import { site } from "@/lib/site/copy";

/** Mono footer row: © year FRADY, city, LinkedIn handle, email, and the portal into FRADY OS. */
export function Footer() {
  return (
    <footer className="label grid grid-cols-2 items-center gap-x-6 gap-y-4 border-t border-hairline px-6 py-5 md:flex md:justify-between md:px-14">
      <span>
        © {site.year} {site.name}
      </span>
      <span className="text-right md:text-left">{site.city}</span>
      <a href={`https://www.linkedin.com/in/${site.linkedin}`} className="transition-colors hover:text-ink" rel="noopener noreferrer" target="_blank">
        LinkedIn / {site.linkedin}
      </a>
      <a href={`mailto:${site.email}`} className="text-right transition-colors hover:text-ink md:text-left">
        {site.email}
      </a>
      <Link href="/today" className="col-span-2 flex h-10 items-center justify-center gap-2 border border-border-strong text-ink transition-colors hover:border-lichen hover:text-lichen md:col-span-1 md:px-4">
        Portal <span aria-hidden="true">→</span>
      </Link>
    </footer>
  );
}
