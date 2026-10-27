/**
 * Live-sites showcase. `preview: "live"` embeds the site in a scaled iframe when the card scrolls
 * into view; switch a site to `"link"` if it refuses to be framed (X-Frame-Options / CSP), and the
 * card shows a styled placeholder with the open link instead.
 */
export type SiteGroup = "primary" | "event";

export type ShowcaseSite = {
  slug: string;
  name: string;
  url: string;
  group: SiteGroup;
  preview: "live" | "link";
};

export const sites: ShowcaseSite[] = [
  { slug: "ari", name: "ARI", url: "https://www.theari.us/", group: "primary", preview: "live" },
  { slug: "ram", name: "RAM", url: "https://www.theari.us/ram/", group: "primary", preview: "live" },
  { slug: "heartland-bioworks", name: "Heartland BioWorks", url: "https://www.heartlandbioworks.com/", group: "primary", preview: "live" },
  { slug: "scitech-connect", name: "SciTech Connect", url: "https://www.scitechconnect.us/scitech-fradyupdate/home", group: "primary", preview: "live" },
  { slug: "main-hub", name: "MAIN Hub", url: "https://main-hub-mock.vercel.app/", group: "primary", preview: "live" },
  { slug: "pgc", name: "PGC", url: "https://www.pgc.capital/", group: "primary", preview: "live" },
  { slug: "uas-test-site", name: "UAS Test Site", url: "https://uas-test-site.vercel.app/", group: "primary", preview: "live" },
  { slug: "darpa-connect", name: "DARPAConnect", url: "https://darpa-connect.vercel.app/", group: "primary", preview: "live" },
  { slug: "mdis", name: "MDIS", url: "https://www.midwestdefenseinnovationsummit.com/", group: "primary", preview: "live" },
  { slug: "hbw-groundbreaking", name: "HBW Groundbreaking", url: "https://events.bizzabo.com/863867", group: "event", preview: "live" },
  { slug: "crane-congressional-breakfast", name: "Crane Congressional Breakfast", url: "https://events.bizzabo.com/CraneCongressionalBreakfast2026", group: "event", preview: "live" },
  { slug: "crane-congressional-reception", name: "Crane Congressional Reception", url: "https://events.bizzabo.com/CraneCongressionalReception-Breakfast2026", group: "event", preview: "live" },
  { slug: "hbw-lunch-and-learn", name: "HBW Lunch & Learn", url: "https://events.bizzabo.com/921636", group: "event", preview: "live" },
  { slug: "scitechconnect-jackson", name: "SciTechConnect Jackson", url: "https://events.bizzabo.com/SciTechConnectJackson", group: "event", preview: "live" },
  { slug: "darpa-colorado", name: "DARPA Colorado", url: "https://events.bizzabo.com/DARPA-Colorado", group: "event", preview: "live" },
  { slug: "uas-test-site-ribbon-cutting", name: "UAS Test Site Ribbon Cutting", url: "https://events.bizzabo.com/UAS-TestSite-RC", group: "event", preview: "live" },
  { slug: "uwbg-market-id", name: "UWBG Market ID Event", url: "https://events.bizzabo.com/scmc-uwbg-market-identification-event", group: "event", preview: "live" },
];

export const GROUP_LABEL: Record<SiteGroup, string> = { primary: "Website", event: "Bizzabo event" };

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
