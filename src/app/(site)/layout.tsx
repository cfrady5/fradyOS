import { tokensToCss } from "@/lib/site/tokens";

/** Public site: its own tokens, scoped under `.site` so the OS theme is untouched. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site bg-ground min-h-svh font-sans text-ink">
      <style dangerouslySetInnerHTML={{ __html: tokensToCss() }} />
      {children}
    </div>
  );
}
