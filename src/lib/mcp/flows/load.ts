import { activityTitle, pickLatestLookahead } from "../styled-views";
import { visibleLookaheads } from "../lookahead-items";
import { dedupeOpenRows, isAffirmativeConfirmation, meetingItem } from "../open-feed";
import { blankFlowData } from "./job-2701";
import type { FiledCategory, FlowData, FlowItem, IorRow } from "./types";
import { readReadiness, readinessAnswer, type ReadinessReader, type ReadinessRecord } from "./confirmation";

type Query = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => Promise<{ data: unknown; error: { message?: string } | null }> & {
        eq: (col: string, val: string) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

const CREW_WORD = /\b(?:subs?|subcontract\w*|suppliers?|crews?|materials?)\b/i;
const PROBLEM_WORD = /\b(?:delays?|delayed|delaying|slippage|slipped|slipping|slips|slip|shortages?|conflicts?|issues?|blockers?|risks?|risky|late|missing|short|behind|clashes?|clashed|rfis?|failed(?:\s+\w+){0,6}\s+inspections?|inspections?(?:\s+\w+){0,6}\s+failed|not\s+issued|unissued)\b/gi;

function negatedProblem(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const breakAt = Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("\n"), before.lastIndexOf(";"));
  const parts = before.slice(breakAt + 1).split(/\b(?:but|however|except|although)\b/i);
  const clause = parts[parts.length - 1] ?? "";
  return /(?:\b(?:no|not|never|nothing|without|zero|none)\b|n't\b)(?:\s+\w+){0,4}\s*$/i.test(clause);
}

/** Problem lines become risks. Confirmations and negated lines ("no issues", "nothing flagged", "no delays") do not. */
export function isProblemLine(note: string): boolean {
  if (isAffirmativeConfirmation(note)) return false;
  const text = note.toLowerCase().replace(/[‘’]/g, "'");
  const problem = new RegExp(PROBLEM_WORD.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = problem.exec(text))) {
    if (!negatedProblem(text, match.index)) return true;
  }
  return false;
}

export function kindOf(action: string, category: string): FlowItem["kind"] {
  const s = `${action} ${category}`;
  if (/\bchange orders?\b|\bCO[- ]?\d/i.test(s)) return "change";
  if (/\bphoto(?:s|graph\w*)?\b/i.test(s)) return "photo";
  if (/\bdail(?:y|ies)\b/i.test(s)) return "daily";
  // Category Meeting is a meeting note. The risk log keeps only delay and risk kinds,
  // and the morning brief classifies "meeting" before delay or risk, so this never renders red.
  const meetingNote = /^meeting$/i.test(category.trim());
  if (!meetingNote && /\bdisrupt\w*|\bslip(?:ped|page|ping|s)?\b|\bdelay(?:ed|ing|s)?\b/i.test(s)) return "delay";
  if (!meetingNote && /\brisk\w*\b|\brfis?\b|\binspect\w*\b/i.test(s)) return "risk";
  if (CREW_WORD.test(s)) return "crew";
  return "open";
}

async function rows(sb: Query, table: string, cols: string, jobId: string): Promise<Record<string, unknown>[]> {
  try {
    const q = sb.from(table).select(cols).eq("job_id", jobId);
    const res = await q;
    if (res.error || !Array.isArray(res.data)) return [];
    return res.data as Record<string, unknown>[];
  } catch {
    return [];
  }
}

type SchedAct = { id?: string; name?: string; description?: string; pct_complete?: number | null; critical?: boolean | null; duration?: number | null };

function numish(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v.replace(/[%,]/g, "")))) return Number(v.replace(/[%,]/g, ""));
  return null;
}

function actPct(a: Record<string, unknown>): number | null {
  return numish(a.pct_complete ?? a.percent_complete ?? a.percent ?? a.pct);
}

export function scheduleActivities(data: Record<string, unknown>): SchedAct[] {
  const nested = data.schedule && typeof data.schedule === "object" ? (data.schedule as Record<string, unknown>).activities : null;
  const raw = Array.isArray(data.activities) ? data.activities : Array.isArray(nested) ? nested : [];
  return raw.filter((a): a is Record<string, unknown> => !!a && typeof a === "object").map((a) => ({
    id: typeof a.id === "string" ? a.id : undefined,
    name: typeof a.name === "string" ? a.name : undefined,
    description: typeof a.description === "string" ? a.description : undefined,
    pct_complete: actPct(a),
    critical: a.critical === true,
    duration: numish(a.duration),
  }));
}

/** Average of the percents on the saved schedule. Null when none are recorded. */
export function schedulePercent(activities: SchedAct[], root?: Record<string, unknown>): number | null {
  const top = root ? numish(root.percent_complete ?? root.pct_complete ?? root.percent) : null;
  if (top != null) return Math.max(0, Math.min(100, Math.round(top)));
  const pcts = activities.map((a) => a.pct_complete).filter((n): n is number => n != null);
  if (!pcts.length) return null;
  return Math.max(0, Math.min(100, Math.round(pcts.reduce((s, n) => s + n, 0) / pcts.length)));
}

/** Reads the job's pay app, IOR, schedule and open items. Does not write or delete. */
export async function loadFlowData(sb: Query, job: { job_id: string; job_number: string; name: string; scope: string }, selfPerform: boolean): Promise<FlowData> {
  const showMoney = job.scope === "full";
  const data = blankFlowData(job.job_number, job.name, showMoney);
  data.jobId = job.job_id;
  data.selfPerform = selfPerform;
  const [items, lookaheads, reports] = await Promise.all([
    rows(sb, "mcp_open_items", "id, action, owner, accountable, due_date, needed_by, status, category, check_key, updated_at, lookahead_id", job.job_id),
    rows(sb, "mcp_lookaheads", "id, start_date, end_date, current_rev, created_at, inputs", job.job_id),
    (async () => {
      const out: Record<string, unknown> = {};
      for (const type of ["cpm", "billing_forecast", "ior"]) {
        try {
          const res = await sb.rpc("mcp_living_report_get", { _job: job.job_id, _type: type, _version: null });
          if (!res.error && res.data) out[type] = res.data;
        } catch {
          /* a missing report leaves that part of the card as Needed */
        }
      }
      try {
        const prev = await sb.rpc("mcp_guided_latest", { _job: job.job_id, _flow: "pm_meeting" });
        if (!prev.error && prev.data) out.previous = prev.data;
      } catch {
        /* comparison stays empty until a meeting has been saved */
      }
      return out;
    })(),
  ]);
  // A saved lookahead's dates do not record PM approval. Keep the question open
  // until an authoritative confirmation is available to this loader.
  data.lookaheadLocked = null;
  const open = items.filter((i) => i.status !== "closed" && i.status !== "resolved");
  const distinct = dedupeOpenRows(open.map((i) => ({
    id: String(i.id ?? ""),
    action: String(i.action ?? ""),
    check_key: typeof i.check_key === "string" ? i.check_key : null,
    needed_by: typeof i.needed_by === "string" ? i.needed_by : null,
    due_date: typeof i.due_date === "string" ? i.due_date : null,
    updated_at: typeof i.updated_at === "string" ? i.updated_at : null,
    owner: (i.accountable as string | null) ?? (i.owner as string | null) ?? null,
  })));
  const byId = new Map(open.map((i) => [String(i.id ?? ""), i]));
  data.items = distinct.map((row) => {
    const i = byId.get(row.id) ?? {};
    return {
      id: row.id,
      action: String(i.action ?? row.action),
      owner: (i.accountable as string | null) ?? (i.owner as string | null) ?? row.owner ?? null,
      due: String(i.needed_by ?? i.due_date ?? "").slice(0, 10) || null,
      kind: kindOf(String(i.action ?? row.action), String(i.category ?? "")),
      status: "open" as const,
    };
  });
  // An empty issue log (including a failed read) proves neither readiness nor
  // schedule compliance. Known open issues still retain their existing flags.
  data.crewsConfirmed = data.items.some((i) => i.kind === "crew") ? false : null;
  data.onSchedule = data.items.some((i) => i.kind === "delay") ? false : null;
  const la = pickLatestLookahead(visibleLookaheads(lookaheads).filter((l) => typeof l.id === "string" && typeof l.current_rev === "number").map((l) => ({
    id: String(l.id), start_date: typeof l.start_date === "string" ? l.start_date : null,
    end_date: typeof l.end_date === "string" ? l.end_date : null, created_at: String(l.created_at ?? ""),
    items: items.filter((i) => i.lookahead_id === l.id).length,
  })));
  const revision = lookaheads.find((l) => l.id === la?.id)?.current_rev;
  const currentCpm = reports.cpm as { found?: boolean; version?: number; data_date?: string } | undefined;
  data.readinessContext = la ? JSON.stringify([la.id, revision, la.start_date, la.end_date, currentCpm?.found ? currentCpm.version ?? null : null, currentCpm?.found ? currentCpm.data_date ?? null : null, selfPerform]) : null;
  if (data.readinessContext) {
    const confirmed = await readReadiness(sb as unknown as ReadinessReader, job.job_id, data.readinessContext);
    data.readinessAnswers = confirmed;
    if (confirmed.crews_confirmed !== undefined) data.crewsConfirmed = confirmed.crews_confirmed;
    if (confirmed.lookahead_locked !== undefined) data.lookaheadLocked = confirmed.lookahead_locked;
  }
  const billing = (reports.billing_forecast as { found?: boolean; data?: { billing?: { billed_to_date?: number; months?: { amount?: number; kind?: string }[] } }; contract_total?: number } | undefined) ?? {};
  if (showMoney && billing.found) {
    const months = billing.data?.billing?.months ?? [];
    const forecast = months.filter((m) => m.kind === "forecast").reduce((s, m) => s + (m.amount ?? 0), 0);
    data.money.plan = forecast || null;
    data.money.billed = billing.data?.billing?.billed_to_date ?? null;
    data.money.contract = billing.contract_total ?? null;
    if (data.money.contract !== null && data.money.billed !== null) data.money.remaining = Math.round((data.money.contract - data.money.billed) * 100) / 100;
  }
  const cpm = reports.cpm as { found?: boolean; data?: Record<string, unknown> } | undefined;
  if (cpm?.found && cpm.data) {
    const acts = scheduleActivities(cpm.data);
    data.percentComplete = schedulePercent(acts, cpm.data);
    data.activitiesDone = acts.filter((a) => schedulePercent([a]) === 100).map((a) => activityTitle(a));
    const critical = acts.filter((a) => a.critical);
    const open = critical.filter((a) => a.pct_complete !== 100);
    data.criticalPath = critical.length ? (open.length ? `Open: ${open.slice(0, 3).map((a) => activityTitle(a)).join(", ")}` : "Clear") : null;
  }
  const ior = reports.ior as { found?: boolean; data?: { items?: IorRow[] } } | undefined;
  if (ior?.found && Array.isArray(ior.data?.items)) data.iorNow = ior.data.items;
  const previous = reports.previous as { found?: boolean; snapshot?: { ior?: IorRow[] } } | undefined;
  data.hasSnapshot = previous?.found === true;
  if (data.hasSnapshot && Array.isArray(previous?.snapshot?.ior)) data.iorPrevious = previous.snapshot.ior;
  data.spillover = data.items.filter((i) => /last night|spill/i.test(i.action)).map((i) => i.action);
  data.dailies = data.items.filter((i) => i.kind === "daily").map((i) => i.action);
  data.photos = data.items.filter((i) => i.kind === "photo").map((i) => i.action);
  data.disruptions = data.items.filter((i) => i.kind === "disruption" || i.kind === "delay").map((i) => i.action);
  return data;
}

const ABBREVIATION = /^(?:approx|dr|no|st|e\.g|i\.e)$/i;

/** Sentence ends, except a period that belongs to approx., Dr., No., St., e.g., or i.e. */
function sentenceParts(line: string): string[] {
  const parts: string[] = [];
  let start = 0;
  const end = /[.!?](?=\s)/g;
  let match: RegExpExecArray | null;
  while ((match = end.exec(line))) {
    if (match[0] === ".") {
      const token = line.slice(start, match.index).match(/(\S+)$/)?.[1]?.replace(/^[("']+/, "") ?? "";
      if (ABBREVIATION.test(token)) continue;
    }
    const text = line.slice(start, match.index + 1).trim();
    if (text) parts.push(text);
    start = match.index + 1;
    while (start < line.length && /\s/.test(line[start] ?? "")) start += 1;
    end.lastIndex = start;
  }
  const rest = line.slice(start).trim();
  if (rest) parts.push(rest);
  return parts;
}

/** Newlines, bullets, and sentence ends. One call often carries several lines. */
export function splitNoteLines(note: string): string[] {
  const out: string[] = [];
  for (const raw of note.split(/\r?\n/)) {
    const line = raw.trim().replace(/^(?:[-*•–—]+|\d+[.)])\s+/, "");
    if (!line) continue;
    for (const part of sentenceParts(line)) {
      const text = part.trim();
      if (text) out.push(text);
    }
  }
  return out.length ? out : [note.trim()].filter(Boolean);
}

function normAction(action: string): string {
  return action.replace(/^\s*\d[\w.-]*\s*[–-]\s*/, "").toLowerCase().replace(/[‘’]/g, "'").replace(/[^\p{L}\p{N}']+/gu, " ").replace(/\s+/g, " ").trim();
}

function rpcMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { message?: string; code?: string };
  return /does not exist|schema cache|PGRST202/i.test(`${err.message ?? ""}${err.code ?? ""}`);
}

/** Open meeting and risk rows keyed by normalized action. A meeting value is the check key, or "". */
function openTwins(existing: Record<string, unknown>[]): { meetings: Map<string, string>; risks: Set<string> } {
  const meetings = new Map<string, string>();
  const risks = new Set<string>();
  for (const row of existing) {
    const status = String(row.status ?? "open").toLowerCase();
    if (status === "closed" || status === "resolved") continue;
    const norm = normAction(String(row.action ?? ""));
    if (!norm) continue;
    const category = String(row.category ?? "");
    const key = typeof row.check_key === "string" ? row.check_key : "";
    if (/^risk$/i.test(category)) risks.add(norm);
    if ((/^meeting$/i.test(category) || key.startsWith("pm:")) && !meetings.has(norm)) meetings.set(norm, key);
  }
  return { meetings, risks };
}

const CATEGORY_ORDER: FiledCategory[] = ["Meeting", "Daily", "Risk"];

type CheckLine = { key: string; close: boolean; action: string };

/** Each problem line is its own risk. Each other line is its own meeting note. A confirmation line still closes its check. */
async function fileSplitNote(sb: Query, jobId: string, flow: string, stage: string, note: string, wanted: Set<FiledCategory>): Promise<boolean> {
  let filed = false;
  const mark = (category: FiledCategory) => { wanted.add(category); filed = true; };
  const existing = await rows(sb, "mcp_open_items", "id, action, status, check_key, category", jobId);
  const twins = openTwins(existing);
  const risks: string[] = [];
  const notes: string[] = [];
  const checks = new Map<string, CheckLine>();
  for (const line of splitNoteLines(note)) {
    if (isProblemLine(line)) { risks.push(line); continue; }
    const meeting = meetingItem(line);
    const lineAnswer = readinessAnswer(line);
    const check = meeting ?? (lineAnswer?.lookahead_locked !== undefined ? { key: "pm:lookahead", close: lineAnswer.lookahead_locked } : null);
    if (check) {
      const prev = checks.get(check.key);
      if (!prev || (check.close && !prev.close)) checks.set(check.key, { key: check.key, close: check.close, action: line });
      continue;
    }
    notes.push(line);
  }
  const addItem = async (action: string, category: FiledCategory, checkKey?: string) => {
    const norm = normAction(action);
    if (category === "Meeting" && twins.meetings.has(norm)) { mark("Meeting"); return; }
    if (category === "Risk" && twins.risks.has(norm)) { mark("Risk"); return; }
    try {
      const added = await sb.rpc("mcp_add_item", { _job: jobId, _f: { action, category, tool: flow, section: stage, ...(checkKey ? { check_key: checkKey } : {}) } });
      if (!added.error) {
        mark(category);
        if (category === "Meeting") twins.meetings.set(norm, checkKey ?? "");
        if (category === "Risk") twins.risks.add(norm);
      }
    } catch { /* this line was not stored */ }
  };
  for (const check of checks.values()) {
    const norm = normAction(check.action);
    const twinKey = twins.meetings.get(norm);
    // Same words already open under a different key would be a second note. Updating the same key is not.
    if (twinKey !== undefined && twinKey !== check.key) { mark("Meeting"); continue; }
    try {
      const added = await sb.rpc("mcp_meeting_item_save", { _job: jobId, _key: check.key, _action: check.action, _close: check.close });
      if (rpcMissing(added.error)) await addItem(check.action, "Meeting", check.key);
      else if (!added.error) { mark("Meeting"); twins.meetings.set(norm, check.key); }
    } catch { /* this check was not stored */ }
  }
  for (const line of notes) await addItem(line, "Meeting");
  for (const risk of risks) await addItem(risk, "Risk");
  return filed;
}

export async function saveFlowNote(sb: Query, jobId: string, flow: string, stage: string, note: string, snapshot: unknown, context?: string | null): Promise<{ item: boolean; snapshot: boolean; confirmation?: boolean; categories: FiledCategory[] }> {
  let item = false;
  let snapshotOk = false;
  const wanted = new Set<FiledCategory>();
  const categories = () => CATEGORY_ORDER.filter((category) => wanted.has(category));
  const answer = readinessAnswer(note);
  const readiness: ReadinessRecord | null = answer && context ? { version: 1, context_key: context, ...answer } : null;
  const saveSnapshot = async () => {
    try {
      const payload = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {};
      const saved = await sb.rpc("mcp_guided_save", { _job: jobId, _flow: flow, _stage: stage, _snapshot: { ...payload, ...(readiness ? { readiness } : {}) } });
      snapshotOk = !saved.error && !!saved.data && (saved.data as { saved?: boolean }).saved === true;
    } catch { snapshotOk = false; }
  };
  // A failed readiness save must not close/reopen the checklist independently.
  if (readiness) {
    await saveSnapshot();
    if (!snapshotOk) return { item: false, snapshot: false, confirmation: false, categories: [] };
  }
  if (flow === "pm_evening") {
    try {
      const added = await sb.rpc("mcp_add_item", { _job: jobId, _f: { action: note, category: "Daily", tool: flow, section: stage } });
      item = !added.error;
      if (item) wanted.add("Daily");
    } catch { item = false; }
  } else item = await fileSplitNote(sb, jobId, flow, stage, note, wanted);
  if (!readiness) await saveSnapshot();
  return { item, snapshot: snapshotOk, categories: categories(), ...(answer ? { confirmation: !!readiness && snapshotOk } : {}) };
}
