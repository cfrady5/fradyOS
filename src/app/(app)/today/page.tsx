import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/data/workspace";
import { getTodayData } from "@/lib/data/today";
import { listProjects } from "@/lib/data/projects";
import { getFinanceData } from "@/lib/data/finance";
import { runProjection } from "@/lib/finance/engine";
import { formatDate } from "@/lib/dates";
import { TodayView, type Standing } from "./today-view";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const ws = await requireWorkspace();
  const [data, projects, finance] = await Promise.all([
    getTodayData(ws.userId, ws.today),
    listProjects(ws.userId, ws.today, { status: "active" }),
    getFinanceData().catch(() => null),
  ]);

  let financeStanding: Standing["finance"] = null;
  if (finance && !finance.isEmpty) {
    const p = runProjection({ ...finance.inputs, months: 120 });
    const history = finance.history;
    const prev = history.length >= 2 ? history[history.length - 2].netWorth : null;
    const synced = finance.accounts.filter((a) => a.external_provider === "plaid" && a.last_synced_at).map((a) => a.last_synced_at as string).sort();
    financeStanding = {
      netWorth: p.start.netWorth,
      netWorthDelta: prev != null ? p.start.netWorth - prev : null,
      freeCashFlow: p.cashFlow.free,
      unallocated: p.cashFlow.unallocated,
      debt: p.start.debt,
      debtFreeDate: p.debtFreeDate,
      debtFreeMonth: p.debtFreeMonth,
      firstShortfallDate: p.firstShortfallMonth != null ? p.points[p.firstShortfallMonth].date : null,
      lastSyncedAt: synced.length ? synced[synced.length - 1] : null,
      goals: p.goals
        .filter((g) => g.status !== "completed")
        .slice(0, 3)
        .map((g) => ({ id: g.id, name: g.name, progressPct: g.progressPct, status: g.status, projectedDate: g.projectedDate, targetDate: g.targetDate, startAmount: g.startAmount, targetAmount: g.targetAmount })),
    };
  }

  const active = projects.filter((p) => p.status === "active");
  const standing: Standing = {
    finance: financeStanding,
    projects: {
      active: active.length,
      overdue: active.reduce((s, p) => s + p.overdue_count, 0),
      waiting: active.reduce((s, p) => s + p.waiting_count, 0),
      upcoming: [...active]
        .sort((a, b) => (a.target_date ?? "9999") < (b.target_date ?? "9999") ? -1 : 1)
        .slice(0, 3)
        .map((p) => ({ id: p.id, name: p.name, target_date: p.target_date, task_done: p.task_done, task_total: p.task_total, overdue_count: p.overdue_count, next_action: p.next_action, area: p.work_area ? { name: p.work_area.name, color: p.work_area.color } : null })),
    },
  };

  const firstName = ws.profile.display_name?.split(" ")[0];
  return <TodayView data={data} standing={standing} greeting={`${greeting()}${firstName ? `, ${firstName}` : ""}`} dateLabel={formatDate(ws.today, "long")} />;
}

function greeting() {
  // Cosmetic only: approximate the user's local hour from the server clock (Indiana is UTC-4/-5).
  const h = new Date().getUTCHours();
  const local = (h + 24 - 4) % 24;
  if (local < 12) return "Good morning";
  if (local < 17) return "Good afternoon";
  return "Good evening";
}
