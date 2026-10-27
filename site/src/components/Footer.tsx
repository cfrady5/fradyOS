import { site } from "@/lib/site";

/** Mono footer row: © year FRADY, city, LinkedIn handle, email. */
export function Footer() {
  return (
    <footer className="label grid grid-cols-2 gap-y-3 border-t border-hairline px-6 py-5 md:flex md:items-center md:justify-between md:px-14">
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
    </footer>
  );
}
