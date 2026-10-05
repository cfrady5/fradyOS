/** Demo data for FRADYOS_PREVIEW mode. Dates are relative to today so every screen has content. */
import { addDays, todayIn, DEFAULT_TIMEZONE, startOfMonth, addMonths } from "@/lib/dates";

export const PREVIEW_USER = { id: "00000000-0000-4000-8000-000000000001", email: "cjfrady5@gmail.com" };

type Row = Record<string, unknown>;

export function seedTables(): Record<string, Row[]> {
  const uid = PREVIEW_USER.id;
  const today = todayIn(DEFAULT_TIMEZONE);
  const d = (n: number) => addDays(today, n);
  const iso = (n: number, h = 9) => new Date(Date.parse(`${d(n)}T${String(h).padStart(2, "0")}:00:00-04:00`)).toISOString();
  const ts = { created_at: iso(-60), updated_at: iso(-1) };

  const areas = [
    { id: "wa-ari", user_id: uid, name: "ARI", color: "#4f7dff", sort_order: 0, is_archived: false, created_at: iso(-90) },
    { id: "wa-nm", user_id: uid, name: "Northwestern Mutual", color: "#8eab98", sort_order: 1, is_archived: false, created_at: iso(-90) },
    { id: "wa-personal", user_id: uid, name: "Personal", color: "#e3b341", sort_order: 2, is_archived: false, created_at: iso(-90) },
  ];

  const project = (id: string, name: string, area: string, status: string, priority: string, target: string | null, next: string | null, extra: Row = {}): Row => ({ id, user_id: uid, work_area_id: area, name, description: null, links: [], status, priority, target_date: target, next_action: next, notes: null, completed_at: status === "completed" ? iso(-3) : null, ...ts, ...extra });
  const projects = [
    project("pr-fall-tour", "Fall campus tour", "wa-ari", "active", "high", d(21), "Confirm AV vendor for Bloomington stop"),
    project("pr-newsletter", "Monthly newsletter relaunch", "wa-ari", "active", "normal", d(12), "Draft the October issue outline"),
    project("pr-website", "Website refresh", "wa-ari", "planned", "normal", d(60), "Collect three agency quotes"),
    project("pr-cfp", "CFP certification", "wa-nm", "active", "high", d(120), "Finish module 4 practice exam"),
    project("pr-clients", "Q4 client reviews", "wa-nm", "active", "normal", d(40), "Schedule the first eight reviews"),
    project("pr-apartment", "Move to the new apartment", "wa-personal", "active", "normal", d(28), "Book the movers"),
    project("pr-ef", "Goal: 6-month emergency fund", "wa-personal", "active", "normal", d(240), "Automate the $650 transfer"),
    project("pr-done", "Summer intern program", "wa-ari", "completed", "normal", d(-10), null),
  ];

  let n = 0;
  const task = (title: string, extra: Row): Row => ({
    id: `t-${++n}`,
    user_id: uid,
    work_area_id: null,
    project_id: null,
    event_id: null,
    title,
    description: null,
    status: "todo",
    priority: "normal",
    planned_date: null,
    due_date: null,
    due_time: null,
    estimated_minutes: null,
    links: [],
    notes: null,
    recurrence: null,
    recurrence_parent_id: null,
    focus_rank: null,
    sort_order: n,
    waiting_person: null,
    waiting_need: null,
    waiting_requested_date: null,
    waiting_expected_date: null,
    waiting_followup_date: null,
    waiting_last_followup_date: null,
    waiting_notes: null,
    waiting_received_at: null,
    template_item_id: null,
    anchor_date: null,
    offset_days: null,
    date_overridden: false,
    completed_at: null,
    ...ts,
    ...extra,
  });
  const tasks = [
    task("Confirm AV vendor for Bloomington stop", { work_area_id: "wa-ari", project_id: "pr-fall-tour", event_id: "ev-bloomington", status: "in_progress", priority: "high", due_date: today, due_time: "15:00", focus_rank: 1, estimated_minutes: 45 }),
    task("Finish module 4 practice exam", { work_area_id: "wa-nm", project_id: "pr-cfp", status: "todo", priority: "high", planned_date: today, due_date: d(2), focus_rank: 2, estimated_minutes: 90 }),
    task("Draft the October newsletter outline", { work_area_id: "wa-ari", project_id: "pr-newsletter", status: "todo", due_date: d(1), focus_rank: 3, estimated_minutes: 60 }),
    task("Send sponsor recap to Lauren", { work_area_id: "wa-ari", project_id: "pr-fall-tour", status: "todo", priority: "urgent", due_date: d(-2) }),
    task("Renew parking permit", { work_area_id: "wa-personal", status: "todo", due_date: d(-1) }),
    task("Book the movers", { work_area_id: "wa-personal", project_id: "pr-apartment", status: "todo", priority: "high", due_date: today }),
    task("Prep slides for Monday standup", { work_area_id: "wa-ari", status: "todo", planned_date: today, due_date: d(3), estimated_minutes: 30 }),
    task("Call landlord about lease end date", { work_area_id: "wa-personal", project_id: "pr-apartment", status: "todo", due_date: d(1) }),
    task("Review Q4 client list with Sam", { work_area_id: "wa-nm", project_id: "pr-clients", status: "todo", due_date: d(2), due_time: "10:30" }),
    task("Order tour banners", { work_area_id: "wa-ari", project_id: "pr-fall-tour", event_id: "ev-bloomington", status: "todo", due_date: d(4) }),
    task("Write LinkedIn post about tour kickoff", { work_area_id: "wa-ari", project_id: "pr-fall-tour", status: "todo", due_date: d(5) }),
    task("Collect agency quotes", { work_area_id: "wa-ari", project_id: "pr-website", status: "todo", due_date: d(6) }),
    task("Pay estimated taxes", { work_area_id: "wa-personal", status: "todo", priority: "high", due_date: d(9), recurrence: { freq: "monthly", interval: 3, basis: "due" } }),
    task("Vendor contract back from legal", { work_area_id: "wa-ari", project_id: "pr-fall-tour", status: "waiting", waiting_person: "Priya (Legal)", waiting_need: "Signed AV contract", waiting_requested_date: d(-7), waiting_expected_date: d(-1), waiting_followup_date: today }),
    task("Headshots from the photographer", { work_area_id: "wa-ari", project_id: "pr-newsletter", status: "waiting", waiting_person: "Marcus", waiting_need: "Edited headshots", waiting_requested_date: d(-4), waiting_expected_date: d(3), waiting_followup_date: d(2) }),
    task("Insurance quote for the new place", { work_area_id: "wa-personal", project_id: "pr-apartment", status: "waiting", waiting_person: "State Farm agent", waiting_need: "Renters quote", waiting_requested_date: d(-3), waiting_expected_date: d(1), waiting_followup_date: d(1) }),
    task("Triage: idea for alumni mixer", { status: "inbox" }),
    task("Triage: look into Notion → OS import", { status: "inbox" }),
    task("Automate the $650 emergency fund transfer", { work_area_id: "wa-personal", project_id: "pr-ef", status: "todo", due_date: d(14) }),
    task("Submit intern program report", { work_area_id: "wa-ari", project_id: "pr-done", status: "completed", completed_at: iso(-1, 16) }),
    task("Confirm Indy stop venue", { work_area_id: "wa-ari", project_id: "pr-fall-tour", event_id: "ev-indy", status: "completed", completed_at: iso(-2, 11) }),
    task("Pay rent", { work_area_id: "wa-personal", status: "completed", completed_at: iso(-3, 9), recurrence: { freq: "monthly", interval: 1, basis: "due" } }),
    task("Set up CFP study calendar", { work_area_id: "wa-nm", project_id: "pr-cfp", status: "completed", completed_at: iso(-4, 20) }),
    task("Email speakers about travel", { work_area_id: "wa-ari", project_id: "pr-fall-tour", event_id: "ev-indy", status: "todo", due_date: d(8) }),
    task("Design social tiles for Indy", { work_area_id: "wa-ari", event_id: "ev-indy", status: "in_progress", due_date: d(11) }),
  ];

  const subtasks = [
    { id: "st-1", task_id: "t-1", user_id: uid, title: "Compare the two quotes", is_done: true, sort_order: 0, created_at: iso(-5) },
    { id: "st-2", task_id: "t-1", user_id: uid, title: "Confirm load-in time", is_done: false, sort_order: 1, created_at: iso(-5) },
    { id: "st-3", task_id: "t-1", user_id: uid, title: "Send deposit", is_done: false, sort_order: 2, created_at: iso(-5) },
    { id: "st-4", task_id: "t-6", user_id: uid, title: "Get two more quotes", is_done: true, sort_order: 0, created_at: iso(-5) },
    { id: "st-5", task_id: "t-6", user_id: uid, title: "Pick a date", is_done: false, sort_order: 1, created_at: iso(-5) },
  ];

  const event = (id: string, name: string, start: string, end: string | null, extra: Row = {}): Row => ({
    id, user_id: uid, work_area_id: "wa-ari", project_id: "pr-fall-tour", name, start_date: start, end_date: end, start_time: null, location: null, program: null, owner: null, status: "Confirmed", website_url: null, notes: null, local_notes: null, source: "monday", monday_board_id: "123", monday_item_id: id, monday_item_url: "https://monday.com", monday_group: "Fall 2026", monday_state: "active", monday_synced_at: iso(0, 7), monday_raw: null, sync_flag: "none", sync_flag_reason: null, sync_flag_at: null, review_dismissed_at: null, previous_start_date: null, previous_end_date: null, dates_changed_at: null, is_archived: false, ...ts, ...extra,
  });
  const events = [
    event("ev-bloomington", "Fall tour · Bloomington", d(6), d(6), { location: "IU Memorial Union", start_time: "18:00", program: "Campus tour", owner: "Caleb" }),
    event("ev-indy", "Fall tour · Indianapolis", d(13), d(13), { location: "Butler University", start_time: "18:00", program: "Campus tour", owner: "Caleb" }),
    event("ev-alumni", "Alumni mixer", d(24), d(24), { location: "Downtown Indy", start_time: "19:00", source: "manual", monday_board_id: null, monday_item_id: null, monday_item_url: null, monday_group: null, monday_state: null, monday_synced_at: null, project_id: null }),
    event("ev-west", "Fall tour · West Lafayette", d(27), d(27), { location: "Purdue Memorial Union", start_time: "18:00", program: "Campus tour", sync_flag: "canceled", sync_flag_reason: "Status changed to Canceled on Monday.com", sync_flag_at: iso(-1) }),
    event("ev-past", "Summer intern showcase", d(-12), d(-12), { location: "HQ", project_id: "pr-done", source: "manual", monday_board_id: null, monday_item_id: null, monday_item_url: null, monday_group: null, monday_state: null, monday_synced_at: null }),
  ];

  const post = (id: string, title: string, extra: Row): Row => ({
    id, user_id: uid, work_area_id: "wa-ari", project_id: "pr-fall-tour", event_id: null, title, brand: "ARI", platform: "linkedin", draft_due_date: null, approval_due_date: null, publish_date: null, publish_time: null, status: "drafting", approver: "Lauren", followup_date: null, caption: null, assets: [], published_url: null, notes: null, template_item_id: null, anchor_date: null, offset_days: null, date_overridden: false, monday_board_id: null, monday_item_id: null, monday_item_url: null, monday_synced_at: null, monday_pushed_at: null, monday_push_error: null, monday_removed_at: null, monday_raw: null, published_at: null, ...ts, ...extra,
  });
  const socialPosts = [
    post("sp-1", "Bloomington stop announcement", { event_id: "ev-bloomington", status: "awaiting_approval", draft_due_date: d(-1), approval_due_date: d(1), publish_date: d(3), publish_time: "09:00" }),
    post("sp-2", "Bloomington recap reel", { event_id: "ev-bloomington", platform: "instagram", status: "idea", draft_due_date: d(7), approval_due_date: d(8), publish_date: d(9) }),
    post("sp-3", "Indy stop announcement", { event_id: "ev-indy", status: "drafting", draft_due_date: d(5), approval_due_date: d(8), publish_date: d(10) }),
    post("sp-4", "October newsletter teaser", { project_id: "pr-newsletter", platform: "email", status: "ready", publish_date: d(4) }),
    post("sp-5", "Intern showcase photos", { project_id: "pr-done", platform: "instagram", status: "published", publish_date: d(-11), published_at: iso(-11, 12) }),
  ];

  const notifications = [
    { id: "nt-1", user_id: uid, kind: "overdue", title: "Send sponsor recap to Lauren is 2 days overdue", body: "Fall campus tour", href: "/tasks?task=t-4", entity_type: "task", entity_id: "t-4", dedupe_key: "overdue:t-4", due_date: d(-2), read_at: null, emailed_at: null, created_at: iso(0, 6) },
    { id: "nt-2", user_id: uid, kind: "followup", title: "Follow up with Priya (Legal) today", body: "Vendor contract back from legal", href: "/waiting", entity_type: "task", entity_id: "t-14", dedupe_key: "followup:t-14", due_date: today, read_at: null, emailed_at: null, created_at: iso(0, 6) },
    { id: "nt-3", user_id: uid, kind: "social", title: "Approval due tomorrow: Bloomington stop announcement", body: null, href: "/calendar?post=sp-1", entity_type: "social", entity_id: "sp-1", dedupe_key: "social:sp-1:approval", due_date: d(1), read_at: null, emailed_at: null, created_at: iso(0, 6) },
  ];

  const templates = [{ id: "tpl-1", user_id: uid, name: "Campus tour stop", description: "Prep checklist and social plan for a tour stop.", is_default: true, ...ts }];
  const templateItems = [
    { id: "tpi-1", template_id: "tpl-1", user_id: uid, kind: "task", title: "Confirm venue and AV", description: null, offset_days: -21, platform: null, brand: null, draft_lead_days: null, approval_lead_days: null, sort_order: 0 },
    { id: "tpi-2", template_id: "tpl-1", user_id: uid, kind: "task", title: "Order banners and swag", description: null, offset_days: -14, platform: null, brand: null, draft_lead_days: null, approval_lead_days: null, sort_order: 1 },
    { id: "tpi-3", template_id: "tpl-1", user_id: uid, kind: "social", title: "Stop announcement", description: null, offset_days: -7, platform: "linkedin", brand: "ARI", draft_lead_days: 4, approval_lead_days: 2, sort_order: 2 },
    { id: "tpi-4", template_id: "tpl-1", user_id: uid, kind: "social", title: "Recap post", description: null, offset_days: 2, platform: "instagram", brand: "ARI", draft_lead_days: 1, approval_lead_days: 1, sort_order: 3 },
  ];

  const mondayConnections = [
    { id: "mc-1", user_id: uid, purpose: "events", board_id: "123", board_name: "ARI Events 2026", board_url: "https://monday.com/boards/123", column_map: { name: "__name__", start: "date", status: "status", location: "text" }, columns_snapshot: [], canceled_labels: ["canceled", "cancelled"], group_id: null, status_map: {}, auto_sync_enabled: true, webhook_ids: ["w1"], last_webhook_at: iso(0, 7), last_sync_started_at: iso(0, 7), last_success_at: iso(0, 7), last_error: null, last_result: { items_seen: 45, created: 0, updated: 2, unchanged: 43, dates_changed: 1, flagged_canceled: 1, flagged_removed: 0, duration_ms: 1840 }, ...ts },
  ];
  const mondayRuns = [
    { id: "mr-1", user_id: uid, connection_id: "mc-1", purpose: "events", trigger: "webhook", started_at: iso(0, 7), finished_at: iso(0, 7), status: "success", result: mondayConnections[0].last_result, error: null },
    { id: "mr-2", user_id: uid, connection_id: "mc-1", purpose: "events", trigger: "scheduled", started_at: iso(-1, 7), finished_at: iso(-1, 7), status: "success", result: { items_seen: 45, created: 1, updated: 0, unchanged: 44, dates_changed: 0, flagged_canceled: 0, flagged_removed: 0, duration_ms: 1620 }, error: null },
  ];

  const finProfile = { user_id: uid, monthly_income: 5400, income_growth_pct: 3, fixed_expenses: 1850, variable_expenses: 1100, investment_return_pct: 7, savings_apy_pct: 4.1, emergency_fund_months: 6, surplus_destination: "savings", debt_strategy: "avalanche", extra_debt_payment: 250, assumptions: {}, ...ts };
  const acct = (id: string, name: string, type: string, balance: number, extra: Row = {}): Row => ({ id, user_id: uid, name, account_type: type, institution: null, balance, interest_rate: null, minimum_payment: null, monthly_contribution: 0, include_in_net_worth: true, external_provider: null, external_account_id: null, plaid_item_id: null, external_subtype: null, external_mask: null, official_name: null, available_balance: null, last_synced_at: null, sync_error: null, notes: null, last_updated: d(-2), is_archived: false, ...ts, ...extra });
  const accounts = [
    acct("fa-chk", "Chase Total Checking ••4821", "checking", 3240.18, { institution: "Chase", external_provider: "plaid", external_account_id: "plaid-chk", plaid_item_id: "item-chase", external_mask: "4821", available_balance: 3105.4, last_synced_at: iso(0, 6), last_updated: today }),
    acct("fa-sav", "Ally Savings ••0093", "savings", 9800, { institution: "Ally", interest_rate: 4.1, monthly_contribution: 650, external_provider: "plaid", external_account_id: "plaid-sav", plaid_item_id: "item-chase", external_mask: "0093", last_synced_at: iso(0, 6), last_updated: today }),
    acct("fa-401k", "NM 401(k)", "retirement", 18450, { institution: "Northwestern Mutual", monthly_contribution: 400 }),
    acct("fa-brk", "Fidelity brokerage", "brokerage", 6120, { institution: "Fidelity", monthly_contribution: 150 }),
    acct("fa-card", "Chase Sapphire ••7710", "credit_card", 2140.55, { institution: "Chase", interest_rate: 24.99, minimum_payment: 65, external_provider: "plaid", external_account_id: "plaid-card", plaid_item_id: "item-chase", external_mask: "7710", last_synced_at: iso(0, 6), last_updated: today }),
    acct("fa-student", "Federal student loan", "student_loan", 14800, { institution: "MOHELA", interest_rate: 5.5, minimum_payment: 165 }),
    acct("fa-auto", "Civic auto loan", "auto_loan", 9350, { institution: "Honda Financial", interest_rate: 6.2, minimum_payment: 310 }),
  ];
  const debts = [
    { id: "fd-1", user_id: uid, account_id: "fa-card", original_balance: 3200, actual_payment: 150, custom_order: 0, notes: null, ...ts },
    { id: "fd-2", user_id: uid, account_id: "fa-student", original_balance: 22000, actual_payment: 165, custom_order: 1, notes: null, ...ts },
    { id: "fd-3", user_id: uid, account_id: "fa-auto", original_balance: 18500, actual_payment: 310, custom_order: 2, notes: null, ...ts },
  ];
  const snapshots: Row[] = [];
  const nwSeries: [string, number][] = [["fa-chk", 2100], ["fa-sav", 6200], ["fa-401k", 15400], ["fa-brk", 5000], ["fa-card", 3100], ["fa-student", 15900], ["fa-auto", 11200]];
  for (let m = 6; m >= 0; m--) {
    const date = addMonths(startOfMonth(today), -m);
    for (const [acc, base] of nwSeries) {
      const target = Number(accounts.find((a) => a.id === acc)!.balance);
      const bal = Math.round((base + ((target - base) * (6 - m)) / 6) * 100) / 100;
      snapshots.push({ id: `snap-${acc}-${m}`, user_id: uid, account_id: acc, snapshot_date: m === 0 ? today : date, balance: bal, created_at: iso(-m * 30) });
    }
  }
  const goals = [
    { id: "fg-ef", user_id: uid, name: "6-month emergency fund", category: "emergency_fund", target_amount: 0, current_amount: 0, linked_account_id: "fa-sav", target_date: addMonths(today, 10), priority: 0, monthly_contribution: 0, status: "active", linked_project_id: "pr-ef", notes: null, completed_at: null, ...ts },
    { id: "fg-card", user_id: uid, name: "Kill the Sapphire balance", category: "debt_payoff", target_amount: 0, current_amount: 0, linked_account_id: "fa-card", target_date: addMonths(today, 6), priority: 1, monthly_contribution: 100, status: "active", linked_project_id: null, notes: null, completed_at: null, ...ts },
    { id: "fg-move", user_id: uid, name: "Moving costs + deposit", category: "home", target_amount: 4500, current_amount: 2900, linked_account_id: null, target_date: d(28), priority: 2, monthly_contribution: 800, status: "active", linked_project_id: "pr-apartment", notes: null, completed_at: null, ...ts },
    { id: "fg-trip", user_id: uid, name: "Japan trip", category: "travel", target_amount: 5000, current_amount: 600, linked_account_id: null, target_date: addMonths(today, 14), priority: 3, monthly_contribution: 150, status: "active", linked_project_id: null, notes: null, completed_at: null, ...ts },
    { id: "fg-100k", user_id: uid, name: "Net worth $100k", category: "net_worth", target_amount: 100000, current_amount: 0, linked_account_id: null, target_date: addMonths(today, 48), priority: 4, monthly_contribution: 0, status: "active", linked_project_id: null, notes: null, completed_at: null, ...ts },
  ];
  const scenarios = [
    { id: "fs-1", user_id: uid, name: "Move downtown + raise", description: "Rent up $400 from month 2, raise of $600 from month 6.", assumptions: { changes: [{ kind: "expense", label: "Rent +$400/mo", amountMonthly: 400, startMonth: 2 }, { kind: "income", label: "Raise +$600/mo", amountMonthly: 600, startMonth: 6 }] }, is_favorite: true, ...ts },
    { id: "fs-2", user_id: uid, name: "Grad school 2027", description: null, assumptions: { changes: [{ kind: "expense", label: "Tuition $2,000/mo", amountMonthly: 2000, startMonth: 12, endMonth: 35 }, { kind: "income", label: "Income after degree +$1,500/mo", amountMonthly: 1500, startMonth: 36 }] }, is_favorite: false, ...ts },
  ];
  const milestones = [
    { id: "fm-1", user_id: uid, title: "Move into the new apartment", milestone_type: "life_event", target_date: d(28), projected_date: null, amount: 4500, linked_goal_id: "fg-move", linked_event_id: null, is_done: false, notes: null, sort_order: 0, ...ts },
    { id: "fm-2", user_id: uid, title: "CFP exam", milestone_type: "life_event", target_date: addMonths(today, 4), projected_date: null, amount: 925, linked_goal_id: null, linked_event_id: null, is_done: false, notes: null, sort_order: 1, ...ts },
    { id: "fm-3", user_id: uid, title: "Japan trip", milestone_type: "life_event", target_date: addMonths(today, 14), projected_date: null, amount: 5000, linked_goal_id: "fg-trip", linked_event_id: null, is_done: false, notes: null, sort_order: 2, ...ts },
  ];
  const cats = ["Housing:expense:1350:RENT_AND_UTILITIES_RENT", "Utilities:expense:180:RENT_AND_UTILITIES", "Transportation:expense:220:TRANSPORTATION", "Food:expense:420:FOOD_AND_DRINK_GROCERIES", "Restaurants:expense:200:FOOD_AND_DRINK", "Entertainment:expense:120:ENTERTAINMENT", "Shopping:expense:150:GENERAL_MERCHANDISE", "Insurance:expense:140:GENERAL_SERVICES_INSURANCE", "Debt payments:debt:625:LOAN_PAYMENTS", "Savings:savings:650:", "Investing:investing:550:", "Travel:expense:100:TRAVEL", "Subscriptions:expense:60:", "Other:expense:100:MEDICAL"];
  const categories = cats.map((c, i) => {
    const [name, kind, budgeted, plaid] = c.split(":");
    return { id: `bc-${i}`, user_id: uid, name, kind, budgeted: Number(budgeted), sort_order: i, is_archived: false, plaid_categories: plaid ? [plaid] : [], created_at: iso(-60) };
  });
  const month = startOfMonth(today);
  const actuals = [
    { id: "ba-1", user_id: uid, category_id: "bc-0", month, actual: 1350, notes: null, ...ts },
    { id: "ba-2", user_id: uid, category_id: "bc-4", month, actual: 238.5, notes: null, ...ts },
  ];
  const txRows: Row[] = [];
  let tn = 0;
  const tx = (date: string, amount: number, name: string, primary: string, detailed: string, accountId = "fa-chk", type?: string) =>
    txRows.push({ id: `tx-${++tn}`, user_id: uid, account_id: accountId, transaction_date: date, description: name, category_id: categories.find((c) => (c.plaid_categories as string[]).some((p) => detailed.startsWith(p)))?.id ?? null, amount, transaction_type: type ?? (amount > 0 ? "income" : "expense"), external_id: `ext-${tn}`, pending: false, merchant_name: name, category_primary: primary, category_detailed: detailed, plaid_item_id: "item-chase", ...ts });
  for (let m = 3; m >= 0; m--) {
    const base = addMonths(startOfMonth(today), -m);
    tx(addDays(base, 0), 2700, "ARI payroll", "INCOME", "INCOME_WAGES");
    tx(addDays(base, 14), 2700, "ARI payroll", "INCOME", "INCOME_WAGES");
    tx(addDays(base, 1), -1350, "Harrison Lofts rent", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT");
    tx(addDays(base, 3), -92.4, "Duke Energy", "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY");
    tx(addDays(base, 5), -118.2, "Kroger", "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", "fa-card");
    tx(addDays(base, 9), -64.8, "Shell", "TRANSPORTATION", "TRANSPORTATION_GAS", "fa-card");
    tx(addDays(base, 11), -46.5, "Bluebeard", "FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT", "fa-card");
    tx(addDays(base, 15), -150, "Chase card payment", "LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "fa-chk", "payment");
    tx(addDays(base, 16), -650, "Transfer to Ally", "TRANSFER_OUT", "TRANSFER_OUT_SAVINGS", "fa-chk", "transfer");
    tx(addDays(base, 20), -210, "Target", "GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_SUPERSTORES", "fa-card");
  }
  const plaidItems = [{ id: "pi-1", user_id: uid, item_id: "item-chase", institution_id: "ins_56", institution_name: "Chase", environment: "sandbox", status: "active", error_code: null, error_message: null, products: ["transactions"], transactions_cursor: "c-1", last_synced_at: iso(0, 6), last_webhook_at: iso(0, 5), consent_expires_at: null, ...ts }];
  const plaidRuns = [{ id: "pr-1", user_id: uid, item_id: "item-chase", trigger: "webhook", started_at: iso(0, 6), finished_at: iso(0, 6), status: "success", result: { accounts_seen: 3, accounts_created: 0, accounts_updated: 3, transactions_added: 4, transactions_modified: 0, transactions_removed: 0, liabilities: false, realtime: false, warnings: [] }, error: null }];

  return {
    profiles: [{ id: uid, display_name: "Caleb Frady", timezone: DEFAULT_TIMEZONE, week_starts_on: 1, reminder_days_before_due: 2, reminder_days_before_social: 2, reminder_days_before_event: 7, email_reminders_enabled: false, notifications_generated_at: iso(0, 6), ...ts }],
    work_areas: areas,
    projects,
    tasks,
    subtasks,
    task_activity: [{ id: "ta-1", task_id: "t-1", user_id: uid, kind: "status", from_status: "todo", to_status: "in_progress", detail: null, created_at: iso(-1, 14) }],
    notes: [{ id: "no-1", user_id: uid, task_id: "t-1", project_id: null, event_id: null, social_post_id: null, body: "Second quote is $400 cheaper but needs our own cables.", ...ts }],
    attachments: [],
    events,
    social_posts: socialPosts,
    event_templates: templates,
    event_template_items: templateItems,
    monday_connections: mondayConnections,
    monday_sync_runs: mondayRuns,
    notifications,
    financial_profiles: [finProfile],
    financial_accounts: accounts,
    financial_debts: debts,
    financial_balance_snapshots: snapshots,
    financial_goals: goals,
    financial_scenarios: scenarios,
    financial_milestones: milestones,
    financial_budget_categories: categories,
    financial_budget_actuals: actuals,
    financial_transactions: txRows,
    plaid_items: plaidItems,
    plaid_item_secrets: [],
    plaid_sync_runs: plaidRuns,
  };
}
