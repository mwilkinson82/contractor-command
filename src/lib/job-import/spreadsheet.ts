// Spreadsheet exports (Procore CSVs, Buildertrend Excel saved as CSV, or a
// contractor's own sheets) -> Athena import shape. One sheet per record kind;
// headers are matched loosely, values are parsed exactly, and anything that
// can't be read is listed as a problem instead of guessed.
import {
  clip,
  emptyImport,
  ImportInputError,
  SUBMITTAL_STATUSES,
  toCents,
  toDay,
  type ImportJob,
  type ImportSource,
} from "./model";

export const SHEET_KINDS = [
  "sov",
  "change_orders",
  "rfis",
  "submittals",
  "schedule",
  "dailies",
] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];
export type Sheet = { kind: SheetKind; text: string; name?: string };

/** RFC 4180-style CSV/TSV, including quoted commas and line breaks. */
export function parseTable(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = first.includes("\t")
    ? "\t"
    : first.split("|").length > first.split(",").length
      ? "|"
      : ",";
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quote = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === "") {
      cell = "";
      quote = true;
    } else if (ch === delim) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      cell = "";
      if (row.some((c) => c !== "")) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some((c) => c !== "")) out.push(row);
  return out;
}

const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const HEADERS: Record<SheetKind, Record<string, string[]>> = {
  sov: {
    line: ["item", "item no", "item number", "line", "line no", "line number", "sov item"],
    cost_code: ["cost code", "code", "budget code", "cost code number"],
    description: ["description", "description of work", "name", "bucket", "line item", "scope"],
    scheduled: [
      "scheduled value",
      "scheduled",
      "contract value",
      "value",
      "amount",
      "revised scheduled value",
      "original scheduled value",
    ],
    budget: ["budget", "original budget", "cost budget", "budget amount"],
    work: [
      "work completed to date",
      "completed to date",
      "billed to date",
      "work to date",
      "total completed",
    ],
    stored: [
      "materials stored",
      "stored to date",
      "materials presently stored",
      "stored materials",
    ],
    retained: ["retainage", "retainage held", "retention", "retainage to date"],
  },
  change_orders: {
    number: [
      "number",
      "co",
      "co number",
      "co #",
      "no",
      "change order",
      "change order number",
      "pco",
    ],
    title: ["title", "name", "subject"],
    description: ["description", "scope", "details"],
    amount: ["amount", "contract amount", "value", "grand total", "total", "price", "revenue"],
    status: ["status", "state"],
    date: ["date", "approved date", "date approved", "executed date", "created", "date initiated"],
    days: ["schedule impact", "schedule days", "days", "schedule impact days"],
  },
  rfis: {
    number: ["number", "rfi", "rfi number", "rfi #", "no"],
    title: ["subject", "title", "name"],
    question: ["question", "description", "details"],
    status: ["status", "state"],
    sent: ["sent", "date sent", "date initiated", "created", "submitted"],
    due: ["due", "due date", "response due"],
  },
  submittals: {
    number: ["number", "submittal", "submittal number", "submittal #", "no", "id"],
    revision: ["revision", "rev", "sub rev"],
    spec: ["spec section", "spec", "specification", "section"],
    title: ["title", "name", "description", "item"],
    type: ["type", "submittal type"],
    status: ["status", "state", "action"],
    submitted: ["submitted", "date submitted", "sent", "sent date"],
    returned: ["returned", "date returned", "returned date", "response date"],
    required_by: ["required by", "required on site", "due", "due date"],
    notes: ["notes", "comments", "remarks"],
  },
  schedule: {
    id: ["activity id", "id", "task id", "wbs code"],
    name: ["activity name", "name", "task", "task name", "title"],
    start: ["start", "start date", "begin"],
    finish: ["finish", "finish date", "end", "end date"],
    duration: ["duration", "original duration", "duration days"],
    pct: ["percent complete", "complete", "progress", "% complete"],
    predecessors: ["predecessors", "preds", "predecessor"],
  },
  dailies: {
    date: ["date", "report date", "log date"],
    weather: ["weather", "conditions"],
    manpower: ["manpower", "workers", "crew", "headcount"],
    work: ["work performed", "notes", "work", "summary", "activity"],
    delays: ["delays", "delay"],
    safety: ["safety", "safety notes", "incidents"],
    issues: ["issues", "problems", "quality"],
  },
};

function mapHeader(kind: SheetKind, header: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const aliases = HEADERS[kind];
  header.forEach((h, i) => {
    const n = norm(h.replace(/%/g, " percent "));
    for (const [field, names] of Object.entries(aliases))
      if (
        out[field] === undefined &&
        names.some((a) => norm(a) === n || norm(a.replace(/%/g, " percent ")) === n)
      )
        out[field] = i;
  });
  return out;
}

const STATUS_WORDS: Record<string, (typeof SUBMITTAL_STATUSES)[number]> = {
  "not started": "not_started",
  draft: "in_prep",
  open: "submitted",
  pending: "submitted",
  submitted: "submitted",
  "in review": "in_review",
  "under review": "in_review",
  approved: "approved",
  "approved as noted": "approved_as_noted",
  "approved as noted aan": "approved_as_noted",
  aan: "approved_as_noted",
  "revise and resubmit": "revise_and_resubmit",
  rar: "revise_and_resubmit",
  rejected: "rejected",
  closed: "closed",
  a: "approved",
};

const coStatusWord = (s: string) => {
  const n = norm(s);
  if (/approved|executed|accepted/.test(n)) return "approved" as const;
  if (/reject|denied|declined/.test(n)) return "rejected" as const;
  if (/void|cancel|deleted/.test(n)) return "void" as const;
  return "pending" as const;
};

export function fromSpreadsheets(
  sheets: Sheet[],
  header: {
    system: ImportSource;
    job_number: string;
    name: string;
    customer?: string | null;
    original_contract?: number | null;
    retainage_pct?: number | null;
    completion_date?: string | null;
  },
): ImportJob {
  if (!sheets.length)
    throw new ImportInputError(
      "Give at least one sheet: SOV, change orders, RFIs, submittals, schedule or dailies.",
    );
  const out = emptyImport(
    header.system,
    `${header.system === "spreadsheet" ? "Spreadsheet" : header.system} export for job ${header.job_number}`,
  );
  out.job = {
    source_id: "job",
    job_number: clip(header.job_number, 40),
    name: clip(header.name, 200),
    customer: clip(header.customer, 200) || null,
    pm_name: null,
    pm_email: null,
    completion_date: toDay(header.completion_date),
  };
  out.contract = {
    original_cents:
      header.original_contract == null ? null : Math.round(header.original_contract * 100),
    retainage_pct: header.retainage_pct ?? null,
  };
  for (const sheet of sheets) {
    const table = parseTable(sheet.text);
    const label = sheet.name || sheet.kind.replace(/_/g, " ");
    if (table.length < 2) {
      out.problems.push(`${label}: no rows under the header.`);
      continue;
    }
    const cols = mapHeader(sheet.kind, table[0]);
    const get = (r: string[], f: string) =>
      cols[f] === undefined ? "" : (r[cols[f]] ?? "").trim();
    const body = table.slice(1);
    const at = (i: number) => `${label} row ${i + 2}`;
    if (sheet.kind === "sov") {
      if (
        cols.scheduled === undefined ||
        (cols.description === undefined && cols.cost_code === undefined)
      ) {
        out.problems.push(
          `${label}: needs a scheduled value column and a description or cost code column.`,
        );
        continue;
      }
      body.forEach((r, i) => {
        const desc = get(r, "description") || get(r, "cost_code");
        if (/^(grand )?total|^subtotal/i.test(desc)) return;
        const sched = toCents(get(r, "scheduled"));
        if (sched === null) {
          out.problems.push(
            `${at(i)}: the scheduled value "${get(r, "scheduled")}" isn't a number.`,
          );
          return;
        }
        out.sov.push({
          source_id: `sov:${get(r, "line") || get(r, "cost_code") || i + 1}`,
          cost_code: clip(get(r, "cost_code"), 40) || null,
          description: clip(desc, 300),
          scheduled_cents: sched,
          budget_cents: toCents(get(r, "budget")),
          work_to_date_cents: toCents(get(r, "work")),
          stored_to_date_cents: toCents(get(r, "stored")),
          retained_cents: toCents(get(r, "retained")),
        });
      });
    } else if (sheet.kind === "change_orders") {
      body.forEach((r, i) => {
        const amount = toCents(get(r, "amount"));
        const number = clip(get(r, "number"), 40);
        if (!number || amount === null) {
          out.problems.push(`${at(i)}: a change order needs a number and an amount.`);
          return;
        }
        const title =
          clip(get(r, "title") || get(r, "description"), 200) || `Change order ${number}`;
        const days = parseInt(get(r, "days"), 10);
        out.change_orders.push({
          source_id: `co:${number}`,
          number,
          title,
          description: clip(get(r, "description") || title, 12000),
          amount_cents: amount,
          status: coStatusWord(get(r, "status")),
          date: toDay(get(r, "date")),
          schedule_days: Number.isFinite(days) ? Math.max(-3650, Math.min(3650, days)) : null,
          cost_cents: null,
          probability: null,
        });
      });
    } else if (sheet.kind === "rfis") {
      body.forEach((r, i) => {
        const number = clip(get(r, "number"), 40);
        if (!number) {
          out.problems.push(`${at(i)}: an RFI needs a number.`);
          return;
        }
        out.rfis.push({
          source_id: `rfi:${number}`,
          number,
          title: clip(get(r, "title") || get(r, "question"), 200) || `RFI ${number}`,
          question: clip(get(r, "question"), 12000),
          open: !/closed|answered|resolved/i.test(get(r, "status")),
          sent_on: toDay(get(r, "sent")),
          due_on: toDay(get(r, "due")),
        });
      });
    } else if (sheet.kind === "submittals") {
      body.forEach((r, i) => {
        const number = clip(get(r, "number"), 40);
        const title = clip(get(r, "title"), 200);
        if (!number || !title) {
          out.problems.push(`${at(i)}: a submittal needs a number and a title.`);
          return;
        }
        const st =
          STATUS_WORDS[norm(get(r, "status"))] ??
          (toDay(get(r, "submitted")) ? "submitted" : "not_started");
        const t = norm(get(r, "type"));
        const rev = parseInt(get(r, "revision").replace(/\D/g, ""), 10);
        out.submittals.push({
          source_id: `submittal:${number}:${Number.isFinite(rev) ? rev : 0}`,
          number,
          revision: Number.isFinite(rev) && rev >= 0 && rev <= 99 ? rev : 0,
          spec_section: clip(get(r, "spec"), 40),
          title,
          submittal_type: /shop/.test(t)
            ? "shop_drawing"
            : /product|data|cut/.test(t)
              ? "product_data"
              : /sample/.test(t)
                ? "sample"
                : "other",
          status: st,
          ball_in_court:
            st === "submitted" || st === "in_review"
              ? "architect_engineer"
              : st === "approved" || st === "approved_as_noted" || st === "closed"
                ? "gc"
                : "sub",
          submitted_on: toDay(get(r, "submitted")),
          returned_on: toDay(get(r, "returned")),
          required_by: toDay(get(r, "required_by")),
          notes: clip(get(r, "notes"), 4000) || null,
        });
      });
    } else if (sheet.kind === "schedule") {
      body.forEach((r, i) => {
        const id = clip(get(r, "id"), 20);
        const name = clip(get(r, "name"), 160);
        if (!id || !name) {
          out.problems.push(`${at(i)}: an activity needs an ID and a name.`);
          return;
        }
        const dur = parseInt(get(r, "duration"), 10);
        const pct = Number(get(r, "pct").replace("%", ""));
        out.schedule.push({
          source_id: `activity:${id}`,
          id,
          name,
          start: toDay(get(r, "start")),
          finish: toDay(get(r, "finish")),
          duration_days: Number.isFinite(dur) && dur >= 0 ? dur : null,
          pct_complete:
            get(r, "pct") && Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : null,
          predecessors: get(r, "predecessors")
            .split(/[,;\s]+/)
            .map((p) => clip(p.replace(/(FS|SS|FF|SF)([+-]\d+)?$/i, ""), 20))
            .filter(Boolean)
            .slice(0, 20),
        });
      });
    } else if (sheet.kind === "dailies") {
      body.forEach((r, i) => {
        const date = toDay(get(r, "date"));
        if (!date) {
          out.problems.push(`${at(i)}: a daily needs a date.`);
          return;
        }
        out.dailies.push({
          source_id: `daily:${date}`,
          date,
          weather: clip(get(r, "weather"), 2000) || "Not recorded in the export",
          manpower: clip(get(r, "manpower"), 2000) || "Not recorded in the export",
          subs: "Not recorded in the export",
          deliveries: "Not recorded in the export",
          issues: clip(get(r, "issues"), 4000) || "None noted",
          delays: clip(get(r, "delays"), 4000) || "None noted",
          safety: clip(get(r, "safety"), 4000) || "None noted",
          work_summary: clip(get(r, "work"), 8000),
          lines: [],
        });
      });
    }
  }
  return out;
}
