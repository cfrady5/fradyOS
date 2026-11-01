import "server-only";
import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { getIntelData, type IntelData } from "@/lib/data/intel";
import { computeBaselines } from "@/lib/intel/baselines";
import { fillCalendar } from "@/lib/intel/summaries";
import { DEFAULT_RULE_SETTINGS, type EngineContext } from "@/lib/intel/types";

export const meta = (title: string): Metadata => ({ title });

/** Loads the workspace and intelligence data, and rebuilds an engine context for view helpers. */
export async function loadIntelPage() {
  const ws = await requireWorkspace();
  const intel = await getIntelData(ws.userId, ws.today);
  const days = fillCalendar(intel.days, ws.today, 180);
  const ctx: EngineContext = { days, today: ws.today, baselines: computeBaselines(days), behaviors: intel.behaviors, settings: { ...DEFAULT_RULE_SETTINGS, disabled: new Set(intel.rulesDisabled) }, timezone: ws.timezone };
  return { ws, intel, ctx };
}

export function eventsFor(intel: IntelData, engines: string[], opts: { includeStatus?: boolean } = {}) {
  return intel.events.filter((e) => engines.includes(e.engine) && e.status !== "resolved" && (opts.includeStatus || e.kind !== "status"));
}
