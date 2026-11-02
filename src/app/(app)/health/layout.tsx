import type { Metadata } from "next";
import { PageHeader } from "@/components/app/items";
import { NAV_GROUPS } from "@/components/app/nav";
import { HealthNav } from "@/components/health/bits";

export const metadata: Metadata = { title: { default: "Health", template: "%s · Health" } };

const BODY = NAV_GROUPS.find((g) => g.key === "health");

export default function HealthLayout({ children }: LayoutProps<"/health">) {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Health"
        description="Sleep, resting heart rate, HRV, strain and workouts read straight from your strap over Bluetooth, with FRADY's own baselines, scores and detections on top. Nothing talks to WHOOP's cloud."
        eyebrow={
          <>
            {BODY?.index ? <span className="index">{BODY.index}</span> : null}
            <span>{BODY?.label ?? "Body"}</span>
          </>
        }
        className="mb-4 md:mb-4"
      />
      <HealthNav />
      {children}
    </div>
  );
}
