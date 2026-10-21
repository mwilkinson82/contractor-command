// Date sweep: overdue / due today / upcoming 14 days. Scoped to one job whenever the tool names a job
// (never another job's dates); company-wide only for tools with no job (onboarding).
import type { Sb } from "./guard";
import { whoForJob } from "./people";
import { displayRef, itemRef, shortRef } from "./refs";
import { dedupeNotices } from "./contacts";
import { isContractDate } from "./jobs";
import { isClaimDeadline, withoutClaims } from "./internal-claims";
import { computeDue, diffDays, todayIn, type Clause } from "./deadlines";
import { reminderSource } from "./views";

const ASSUMED_TZ = "America/New_York";
const MONEY = /\$\s?[\d,.]+[kKmM]?|\b\d[\d,.]*\s?(dollars|usd)\b/gi;

type JobRow = { id: string; job_number: string; name: string; time_zone: string | null; company_id: string };
type ItemRow = { id: string; job_id: string; action: string; needed_by: string | null; item_type: string | null; internal_only: boolean; check_key: string; accountable: string | null; cost_effect: string | null; cash_effect: string | null; commercial_type?: string | null; category?: string | null; clause_source: string | null; source?: string | null; waiting_on_document?: string | null };
type DeadlineRow = Clause & { job_id: string; item_id: string | null; internal_only: boolean; clause_key: string };

export type SweepItem = { job_id: string; job_number: string; item_ref?: string; ref: string; item_id: string | null; item_type: string; due: string; days: number; bucket: "overdue" | "today" | "upcoming" };

function when(days: number) {
  if (days < 0) return `overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "due today";
  return `due in ${days} day${days === 1 ? "" : "s"}`;
}

/** 0.8.7: " | Same notice also logged as: Ref 263AC (shown once)". Client copies never show refs. */
export function sweepDupNote(dups: { id: string; action?: string | null; check_key?: string | null }[] | undefined, client = false): string {
  if (!dups?.length || client) return "";
  return ` | Same notice also logged as: ${dups.map((x) => displayRef(x)).join(", ")} (shown once)`;
}

/** 0.8.12: the real source (contract §, RFI, notice) instead of "manual"; client copies show contract sections only. */
function srcNote(it: ItemRow, client: boolean): string {
  const src = reminderSource(it);
  if (!src || (client && !/^Contract /.test(src))) return "";
  return ` | Source: ${src}`;
}

export type SweepScope = { jobNumber?: string; client?: boolean };

export async function runSweep(sb: Sb, scope_: SweepScope = {}): Promise<{ text: string; items: SweepItem[] } | null> {
  let jq = sb.from("mcp_jobs").select("id, job_number, name, time_zone, company_id").not("company_id", "is", null);
  if (scope_.jobNumber) jq = jq.eq("job_number", scope_.jobNumber.trim());
  const { data: jobs, error } = await jq;
  const client = scope_.client === true;
  if (error || !jobs?.length) return null;
  const js = jobs as JobRow[];
  const ids = js.map((j) => j.id);
  const [scopesR, itemsR, dlR] = await Promise.all([
    Promise.all(js.map((j) => sb.rpc("mcp_job_scope", { _job: j.id }))),
    sb.from("mcp_open_items").select("id, job_id, action, needed_by, item_type, internal_only, check_key, accountable, cost_effect, cash_effect, commercial_type, category, clause_source, source, waiting_on_document").in("job_id", ids).eq("status", "open").not("needed_by", "is", null),
    sb.from("mcp_job_deadlines").select("id, job_id, item_id, label, clause_ref, clause_key, trigger_desc, trigger_date, trigger_alternatives, n_days, day_type, holidays, weekend_roll, fixed_date, internal_only").in("job_id", ids).eq("active", true),
  ]);
  const scope = new Map(js.map((j, i) => [j.id, (scopesR[i].data as string | null) ?? null]));
  const byJob = new Map(js.filter((j) => scope.get(j.id)).map((j) => [j.id, j]));
  const single = scope_.jobNumber && byJob.size === 1 ? [...byJob.values()][0] : null;
  const who = single ? await whoForJob(sb, single.company_id, single.id) : (v: string | null) => v ?? "unknown";
  const lines: { bucket: SweepItem["bucket"]; days: number; title: string; when: string; due: string; meta: string; extra: string[] }[] = [];
  const out: SweepItem[] = [];
  const tzNotes: string[] = [];
  const clauseItems = new Set<string>();

  for (const j of byJob.values()) {
    if (!j.time_zone) {
      tzNotes.push(`${j.job_number} – Time zone unknown. Precaution — assumed date, not a contract fact. Basis: dates counted in ${ASSUMED_TZ} (Eastern) until the job's time zone is set.`);
      if (scope.get(j.id) === "full") {
        await sb.rpc("mcp_add_item", { _job: j.id, _f: { check_key: "tz:job", item_type: "unknown", kind: "confirm_unknown", category: "Deadline", action: "Confirm the job's time zone (deadlines are computed in it)", tool: "sweep" } });
      }
    }
  }

  for (const d of (dlR.data ?? []) as DeadlineRow[]) {
    const j = byJob.get(d.job_id);
    if (!j) continue;
    if (client && (d.internal_only || isClaimDeadline(d))) continue;
    if (d.item_id) clauseItems.add(d.item_id);
    const c = computeDue(d);
    if (!c.due) continue;
    const tz = j.time_zone ?? ASSUMED_TZ;
    const days = diffDays(c.due, todayIn(tz));
    if (days > 14) continue;
    const bucket = days < 0 ? "overdue" : days === 0 ? "today" : "upcoming";
    const zone = j.time_zone ? tz : `${tz}, assumed`;
    lines.push({
      bucket, days,
      title: `${j.job_number} – ${d.label}${d.clause_ref ? ` (${d.clause_ref})` : ""}`, when: when(days), due: `${c.due} (${zone})`, meta: "",
      extra: [`Math: ${c.math}.`, ...c.alternatives.map((a) => `Also shown: ${a}.`), ...c.precautions],
    });
    out.push({ job_id: j.id, job_number: j.job_number, ref: `deadline:${d.id}`, item_id: d.item_id, item_type: "deadline", due: c.due, days, bucket });
  }

  // 0.8.7: same dedupe as list_open_items (same event + notice type shows once); duplicates are named by Ref, never a #hash.
  const swept = dedupeNotices(client ? withoutClaims((itemsR.data ?? []) as ItemRow[]) : ((itemsR.data ?? []) as ItemRow[]));
  for (const it of swept.items) {
    const j = byJob.get(it.job_id);
    if (!j || !it.needed_by || clauseItems.has(it.id)) continue;
    if ((client || scope.get(j.id) !== "full") && it.internal_only) continue;
    // Client copy: only dates the contract sets; Athena's own follow-up dates stay internal.
    if (client && !isContractDate(it)) continue;
    const tz = j.time_zone ?? ASSUMED_TZ;
    const days = diffDays(it.needed_by, todayIn(tz));
    if (days > 14) continue;
    const bucket = days < 0 ? "overdue" : days === 0 ? "today" : "upcoming";
    let action = it.action;
    if (client || scope.get(j.id) !== "full") action = action.replace(MONEY, "[amount withheld]");
    lines.push({
      bucket, days,
      title: action, when: when(days), due: `${it.needed_by} (${j.time_zone ? tz : `${tz}, assumed`})`,
      meta: `${client ? "" : `Accountable: ${who(it.accountable)}`}${srcNote(it, client)}${sweepDupNote(swept.duplicates.get(it.id), client)}`.replace(/^ \| /, ""),
      extra: [],
    });
    out.push({ job_id: j.id, job_number: j.job_number, item_ref: itemRef(it), ref: `item:${it.id}`, item_id: it.id, item_type: it.item_type ?? "deadline", due: it.needed_by, days, bucket });
  }

  // 0.8.8: the sweep is a short card list (heading, one bold line per date, a quiet detail line), not a text dump.
  if (!lines.length && !tzNotes.length) return { text: "**Date sweep** · nothing overdue, due today, or due in the next 14 days.", items: [] };
  lines.sort((a, b) => a.days - b.days);
  const section = (b: SweepItem["bucket"], title: string) => {
    const ls = lines.filter((l) => l.bucket === b);
    if (!ls.length) return [];
    return [`**${title} (${ls.length})**`, ...ls.flatMap((l) => [
      `- **${l.title}** · ${l.when} · ${l.due}`,
      ...(l.meta ? [`  ${l.meta}`] : []),
      ...l.extra.map((e) => `  ${e}`),
    ])];
  };
  const body = [
    "**Date sweep** · dates in the job's time zone",
    ...tzNotes.map((t) => `- ${t}`),
    ...section("overdue", "Overdue"),
    ...section("today", "Due today"),
    ...section("upcoming", "Next 14 days"),
  ];
  try {
    await sb.rpc("mcp_log_surfaced", {
      _refs: out.map((o) => ({ ref: o.ref, item_id: o.item_id, job_id: o.job_id })),
    });
  } catch {
    // metrics never break a call
  }
  return { text: body.join("\n"), items: out };
}
