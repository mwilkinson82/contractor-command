// Spreadsheet exports (Procore CSVs and XLSX, Buildertrend Excel, or a
// contractor's own sheets) -> Athena import shape. One sheet per record kind;
// a sheet's kind is recognized from its columns when the member doesn't say,
// headers are matched loosely, values are parsed exactly, and anything that
// can't be read is listed as a problem instead of guessed. Rows Athena has no
// live record for yet are kept whole in the job's read-only archive.
import {
  clip,
  emptyImport,
  ImportInputError,
  SUBMITTAL_STATUSES,
  toCents,
  toDay,
  type ImportActivity,
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
  "budget",
  "estimate",
  "inspections",
  "observations",
  "commitments",
  "punch_list",
] as const;
export type SheetKind = (typeof SHEET_KINDS)[number];
export type Sheet = { kind?: SheetKind; text: string; name?: string };

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
  (h.trim() === "#" ? "number" : h)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Column names as each tool writes them: Procore's exports, Buildertrend's grid
// exports (whose columns follow the member's saved view), and plain sheets.
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
    previous: ["from previous application", "previous application", "work completed previous"],
    this_period: ["this period", "work completed this period"],
    work: [
      "work completed to date",
      "completed to date",
      "billed to date",
      "work to date",
      "total completed",
    ],
    total_stored: [
      "total completed and stored to date",
      "total completed stored to date",
      "completed and stored to date",
    ],
    stored: [
      "materials stored",
      "stored to date",
      "materials presently stored",
      "stored materials",
    ],
    retained: ["retainage", "retainage held", "retention", "retainage to date", "total retainage"],
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
      "pco number",
      "id #",
      "id",
      "co id",
    ],
    title: ["title", "name", "subject"],
    description: ["description", "scope", "details"],
    amount: [
      "amount",
      "contract amount",
      "value",
      "grand total",
      "total",
      "price",
      "revenue",
      "client price",
      "owner price",
      "total client price",
    ],
    cost: ["builder cost", "total builder cost", "cost", "our cost"],
    status: ["status", "state", "approval status"],
    date: [
      "date",
      "approved date",
      "date approved",
      "executed date",
      "executed",
      "created",
      "created date",
      "date initiated",
    ],
    days: [
      "schedule impact",
      "schedule days",
      "days",
      "schedule impact days",
      "schedule impact (days)",
    ],
    company: ["contract company", "vendor", "subcontractor", "commitment", "contract"],
  },
  rfis: {
    number: ["number", "rfi", "rfi number", "rfi #", "no", "id #"],
    title: ["subject", "title", "name"],
    question: ["question", "description", "details", "question body"],
    answer: [
      "official response",
      "response",
      "answer",
      "official answer",
      "responses",
      "latest response",
    ],
    answered_on: ["date answered", "answered date", "response date", "responded on", "closed date"],
    answered_by: ["responded by", "answered by", "response by"],
    status: ["status", "state"],
    sent: ["sent", "date sent", "date initiated", "created", "submitted", "created date"],
    due: ["due", "due date", "response due"],
  },
  submittals: {
    number: ["number", "submittal", "submittal number", "submittal #", "no", "id"],
    revision: ["revision", "rev", "sub rev", "rev."],
    spec: ["spec section", "spec", "specification", "section", "spec section number"],
    title: ["title", "name", "description", "item"],
    type: ["type", "submittal type"],
    status: ["status", "state", "action"],
    submitted: ["submitted", "date submitted", "sent", "sent date", "issue date", "received date"],
    returned: ["returned", "date returned", "returned date", "response date", "distributed date"],
    required_by: [
      "required by",
      "required on site",
      "due",
      "due date",
      "final due date",
      "submit by",
    ],
    notes: ["notes", "comments", "remarks"],
  },
  schedule: {
    id: ["activity id", "id", "task id", "wbs code", "unique id"],
    name: ["activity name", "name", "task", "task name", "title"],
    start: ["start", "start date", "begin", "planned start"],
    finish: ["finish", "finish date", "end", "end date", "planned finish"],
    duration: ["duration", "original duration", "duration days", "work days", "workdays"],
    pct: ["percent complete", "complete", "progress", "% complete"],
    predecessors: ["predecessors", "preds", "predecessor", "dependencies", "dependency"],
    actual_start: ["actual start", "actual start date"],
    actual_finish: ["actual finish", "actual finish date", "actual end"],
    baseline_start: ["baseline start", "bl start", "baseline start date"],
    baseline_finish: ["baseline finish", "bl finish", "baseline finish date", "baseline end"],
    phase: ["phase", "group", "wbs", "outline", "section"],
  },
  dailies: {
    date: ["date", "report date", "log date"],
    weather: ["weather", "conditions", "weather notes"],
    manpower: ["manpower", "workers", "crew", "headcount"],
    work: ["work performed", "notes", "work", "summary", "activity", "title"],
    delays: ["delays", "delay"],
    safety: ["safety", "safety notes", "incidents"],
    issues: ["issues", "problems", "quality"],
  },
  budget: {
    cost_code: ["cost code", "budget code", "code", "cost code number"],
    description: ["description", "cost code title", "budget code description", "name", "title"],
    original: ["original budget", "original budget amount", "original budget costs"],
    revised: ["revised budget", "revised budget costs", "revised budget amount"],
    committed: ["committed costs", "committed"],
    actual: ["actual costs", "job to date costs", "direct costs", "actual"],
    projected: ["projected costs", "estimated cost at completion", "projected budget"],
    client_original: ["original client price"],
    client_revised: ["revised client price", "client price"],
    invoiced: ["amount invoiced", "invoiced", "invoiced to date"],
  },
  estimate: {
    title: ["title", "item", "line item", "name"],
    cost_code: ["cost code", "code"],
    cost_type: ["cost type", "type"],
    group: ["group", "parent group", "category"],
    description: ["description"],
    quantity: ["quantity", "qty"],
    unit: ["unit", "uom"],
    unit_cost: ["unit cost"],
    builder_cost: ["builder cost", "total builder cost", "extended cost"],
    markup: ["markup", "margin", "markup margin"],
    client_price: ["client price", "owner price", "total client price", "price"],
  },
  inspections: {
    number: ["number", "no", "inspection number", "id"],
    name: ["name", "title", "inspection", "inspection name", "template"],
    type: ["type", "inspection type"],
    status: ["status"],
    date: ["inspection date", "date", "scheduled date"],
    due: ["due date", "due"],
    closed: ["closed date", "date closed", "completed date", "closed"],
    responsible: [
      "responsible party",
      "responsible contractor",
      "assignee",
      "assignees",
      "point of contact",
    ],
    inspector: ["inspector", "inspected by", "inspection by"],
    location: ["location"],
    deficient: ["deficient", "deficient items", "failed items", "deficient count"],
    notes: ["description", "notes", "comments"],
  },
  observations: {
    number: ["number", "no", "observation number"],
    type: ["type", "observation type"],
    trade: ["trade"],
    title: ["title", "name", "description"],
    assignee: ["assignee", "assigned to"],
    company: ["assignee s company", "assignees company", "company"],
    notified: ["date notified", "notified", "created"],
    due: ["due date", "due"],
    status: ["status"],
    priority: ["priority"],
    location: ["location"],
  },
  commitments: {
    number: ["number", "no", "contract number", "commitment number"],
    company: ["contract company", "vendor", "subcontractor", "company"],
    title: ["title", "name", "description"],
    type: ["type", "commitment type"],
    status: ["status"],
    original: ["original contract amount", "original amount", "contract amount"],
    approved_cos: ["approved change orders", "approved cos"],
    revised: ["revised contract amount", "revised amount"],
    invoiced: ["invoiced", "invoiced amount", "billed to date"],
    paid: ["payments issued", "paid", "paid to date"],
  },
  punch_list: {
    number: ["number", "no", "punch item number"],
    title: ["title", "name", "description", "item"],
    location: ["location"],
    trade: ["trade"],
    assignee: ["assignee", "assignees", "ball in court", "responsible contractor"],
    status: ["status"],
    due: ["due date", "due"],
    priority: ["priority"],
  },
};

function mapHeader(kind: SheetKind, header: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const aliases = HEADERS[kind];
  header.forEach((h, i) => {
    const n = norm(h.replace(/%/g, " percent "));
    if (!n) return;
    for (const [field, names] of Object.entries(aliases))
      if (
        out[field] === undefined &&
        names.some((a) => norm(a) === n || norm(a.replace(/%/g, " percent ")) === n)
      ) {
        out[field] = i;
        break;
      }
  });
  return out;
}

// What makes a sheet that kind: fields it must have, and fields only it has.
const SIGNS: Record<SheetKind, { need: string[][]; marks: string[] }> = {
  sov: {
    need: [["scheduled"], ["description", "cost_code"]],
    marks: ["work", "retained", "stored", "total_stored", "previous"],
  },
  change_orders: { need: [["number"], ["amount"]], marks: ["days", "cost"] },
  rfis: { need: [["number"], ["question", "title"]], marks: ["question", "answer", "answered_on"] },
  submittals: {
    need: [["number"], ["title"]],
    marks: ["spec", "revision", "returned", "required_by"],
  },
  schedule: {
    need: [["name"], ["start", "finish", "duration"]],
    marks: ["predecessors", "pct", "duration", "actual_start", "baseline_start"],
  },
  dailies: { need: [["date"]], marks: ["weather", "manpower", "delays", "safety"] },
  budget: {
    need: [
      ["cost_code", "description"],
      ["original", "revised", "committed", "client_revised"],
    ],
    marks: ["original", "revised", "committed", "actual", "projected", "invoiced"],
  },
  estimate: {
    need: [
      ["title", "description", "cost_code"],
      ["builder_cost", "unit_cost", "client_price"],
    ],
    marks: ["builder_cost", "unit_cost", "markup", "quantity", "cost_type"],
  },
  inspections: { need: [["name", "type"]], marks: ["deficient", "inspector", "closed"] },
  observations: { need: [["title"]], marks: ["trade", "priority", "notified", "company"] },
  commitments: {
    need: [["company"], ["original", "revised"]],
    marks: ["approved_cos", "paid", "revised"],
  },
  punch_list: { need: [["title"]], marks: ["location", "assignee"] },
};

const NAME_HINTS: [RegExp, SheetKind][] = [
  [/\brfis?\b/i, "rfis"],
  [/submittal/i, "submittals"],
  [/schedule|gantt|look ?ahead/i, "schedule"],
  [/daily|dailies|\blogs?\b/i, "dailies"],
  [/commitment|subcontract|purchase order/i, "commitments"],
  [/change ?order|\bpcos?\b|\bcos?\b/i, "change_orders"],
  [/budget|job ?cost/i, "budget"],
  [/estimate|proposal|worksheet/i, "estimate"],
  [/inspection/i, "inspections"],
  [/observation/i, "observations"],
  [/punch/i, "punch_list"],
  [/\bsov\b|schedule of values|invoice|pay ?app|g70[23]|requisition/i, "sov"],
];

/** The record kind a sheet holds, from its columns and its file name; null when it can't tell. */
export function detectSheetKind(header: string[], name = ""): SheetKind | null {
  let best: { kind: SheetKind; score: number } | null = null;
  for (const kind of SHEET_KINDS) {
    const cols = mapHeader(kind, header);
    const sign = SIGNS[kind];
    if (!sign.need.every((any) => any.some((f) => cols[f] !== undefined))) continue;
    const marks = sign.marks.filter((f) => cols[f] !== undefined).length;
    let score = Object.keys(cols).length + marks * 2;
    if (NAME_HINTS.some(([re, k]) => k === kind && re.test(name))) score += 4;
    if (!best || score > best.score) best = { kind, score };
  }
  return best && best.score >= 4 ? best.kind : null;
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Typed logic in a dependency cell: "A1010", "12FS+2", "A1020 SS +3d", "Frame walls FF-1". */
function parseLinkToken(token: string) {
  const m = token
    .trim()
    .match(/^(.*?)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*(?:d|days?|wd|w\.?d\.?)?)?$/i);
  if (!m || !m[1]) return null;
  const lag = m[4] ? (m[3] === "-" ? -1 : 1) * parseInt(m[4], 10) : 0;
  return {
    ref: m[1].trim(),
    type: (m[2]?.toUpperCase() ?? "FS") as "FS" | "SS" | "FF" | "SF",
    lag,
  };
}

const MON_FRI = { work_days: [1, 2, 3, 4, 5], holidays: [] as string[] };

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
      "Give at least one export: SOV or owner invoice, budget, estimate, change orders, RFIs, submittals, schedule, inspections, observations, commitments, punch list or dailies.",
    );
  const from =
    header.system === "spreadsheet"
      ? "the spreadsheet"
      : header.system === "procore"
        ? "Procore"
        : header.system === "buildertrend"
          ? "Buildertrend"
          : header.system;
  const out = emptyImport(
    header.system,
    `${header.system === "spreadsheet" ? "Spreadsheet" : from} export for job ${header.job_number}`,
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
  const archive = (table: string, id: string, row: Record<string, unknown>) => {
    const t = (out.archive[table] ??= {});
    let key = id.slice(0, 200) || `row:${Object.keys(t).length + 1}`;
    for (let n = 2; t[key]; n++) key = `${id}:${n}`.slice(0, 200);
    t[key] = row;
  };
  const asRecord = (head: string[], r: string[]) =>
    Object.fromEntries(
      head
        .map((h, i) => [clip(h, 120) || `column ${i + 1}`, r[i] ?? ""])
        .filter(([, v]) => v !== ""),
    );

  // Read every sheet first, then apply them in an order that lets the budget
  // and the estimate land on SOV lines that came from the owner invoice.
  const ORDER: SheetKind[] = ["sov", "budget", "estimate"];
  const read = sheets.map((sheet, i) => {
    const table = parseTable(sheet.text);
    const kind = sheet.kind ?? (table[0] ? detectSheetKind(table[0], sheet.name) : null);
    return { sheet, table, kind, i };
  });
  read.sort((a, b) => {
    const r = (k: SheetKind | null) => (k && ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
    return r(a.kind) - r(b.kind) || a.i - b.i;
  });
  const sovByCode = new Map<string, ImportJob["sov"][number]>();
  const unread: string[] = [];

  for (const { sheet, table, kind } of read) {
    const label = sheet.name || (kind ?? "sheet").replace(/_/g, " ");
    if (!kind) {
      unread.push(label);
      continue;
    }
    if (table.length < 2) {
      out.problems.push(`${label}: no rows under the header.`);
      continue;
    }
    const head = table[0];
    const cols = mapHeader(kind, head);
    const get = (r: string[], f: string) =>
      cols[f] === undefined ? "" : (r[cols[f]] ?? "").trim();
    const body = table.slice(1);
    const at = (i: number) => `${label} row ${i + 2}`;
    const isTotal = (s: string) => /^(grand )?totals?\b|^subtotal/i.test(s.trim());

    if (kind === "sov") {
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
        if (isTotal(desc) || isTotal(get(r, "line"))) return;
        const sched = toCents(get(r, "scheduled"));
        if (sched === null) {
          out.problems.push(
            `${at(i)}: the scheduled value "${get(r, "scheduled")}" isn't a number.`,
          );
          return;
        }
        const stored = toCents(get(r, "stored"));
        // An AIA G703 gives work to date as previous + this period, or as the
        // total completed and stored less what is stored.
        const prev = toCents(get(r, "previous"));
        const period = toCents(get(r, "this_period"));
        const total = toCents(get(r, "total_stored"));
        const work =
          toCents(get(r, "work")) ??
          (prev !== null || period !== null
            ? (prev ?? 0) + (period ?? 0)
            : total !== null
              ? total - (stored ?? 0)
              : null);
        const line = {
          source_id: `sov:${get(r, "line") || get(r, "cost_code") || i + 1}`,
          cost_code: clip(get(r, "cost_code"), 40) || null,
          description: clip(desc, 300),
          scheduled_cents: sched,
          budget_cents: toCents(get(r, "budget")),
          work_to_date_cents: work,
          stored_to_date_cents: stored,
          retained_cents: toCents(get(r, "retained")),
        };
        out.sov.push(line);
        if (line.cost_code) sovByCode.set(line.cost_code.toLowerCase(), line);
      });
    } else if (kind === "budget") {
      let matched = 0;
      let added = 0;
      let kept = 0;
      body.forEach((r, i) => {
        const code = clip(get(r, "cost_code"), 40);
        const desc = clip(get(r, "description"), 300) || code;
        if (!desc || isTotal(code) || isTotal(desc)) return;
        archive("budget_lines", code || `row:${i + 2}`, asRecord(head, r));
        const budget = toCents(get(r, "revised")) ?? toCents(get(r, "original"));
        const price = toCents(get(r, "client_revised")) ?? toCents(get(r, "client_original"));
        const line = code ? sovByCode.get(code.toLowerCase()) : undefined;
        if (line) {
          if (line.budget_cents === null && budget !== null) line.budget_cents = budget;
          matched++;
        } else if (price !== null && price !== 0 && out.sov.length < 300) {
          // Buildertrend's Job Costing Budget carries the client price per cost
          // code, so it can be the SOV when no owner invoice came with it.
          const sov = {
            source_id: `sov:${code || i + 1}`,
            cost_code: code || null,
            description: desc,
            scheduled_cents: price,
            budget_cents: budget,
            work_to_date_cents: toCents(get(r, "invoiced")),
            stored_to_date_cents: null,
            retained_cents: null,
          };
          out.sov.push(sov);
          if (code) sovByCode.set(code.toLowerCase(), sov);
          added++;
        } else kept++;
      });
      if (kept)
        out.held.push({
          kind: "budget lines",
          count: kept,
          why: `${label}: these cost codes have no matching SOV line and no client price, so they are kept on the job's archive rather than guessed onto the contract.`,
          archived: true,
        });
      if (added && !matched)
        out.problems.push(
          `The SOV comes from ${label}'s client prices (${plural(added, "cost code")}). If you have the owner's pay application, add it so the SOV matches what the owner signed.`,
        );
    } else if (kind === "estimate") {
      const groups = new Map<string, { desc: string; price: number; cost: number; any: boolean }>();
      body.forEach((r, i) => {
        const code = clip(get(r, "cost_code"), 40);
        const title = clip(get(r, "title") || get(r, "description"), 300);
        if (!title && !code) return;
        if (isTotal(title) || isTotal(code)) return;
        archive("estimate_lines", `row:${i + 2}`, asRecord(head, r));
        const price = toCents(get(r, "client_price"));
        const cost =
          toCents(get(r, "builder_cost")) ??
          (() => {
            const q = Number(get(r, "quantity").replace(/,/g, ""));
            const u = toCents(get(r, "unit_cost"));
            return Number.isFinite(q) && u !== null ? Math.round(q * u) : null;
          })();
        const key = code || get(r, "group") || title;
        const g = groups.get(key) ?? {
          desc: code ? clip(get(r, "group") || title, 300) : key,
          price: 0,
          cost: 0,
          any: false,
        };
        g.price += price ?? 0;
        g.cost += cost ?? 0;
        g.any ||= price !== null;
        groups.set(key, g);
      });
      if (out.sov.length) {
        out.held.push({
          kind: "estimate lines",
          count: Object.keys(out.archive.estimate_lines ?? {}).length,
          why: `${label}: the SOV came from another export, so the estimate is kept on the job's archive.`,
          archived: true,
        });
      } else {
        for (const [key, g] of groups) {
          if (!g.any || out.sov.length >= 300) continue;
          const code = /^[\w.-]{1,40}$/.test(key) ? key : null;
          out.sov.push({
            source_id: `sov:${key}`.slice(0, 120),
            cost_code: code,
            description: g.desc,
            scheduled_cents: g.price,
            budget_cents: g.cost || null,
            work_to_date_cents: null,
            stored_to_date_cents: null,
            retained_cents: null,
          });
        }
        if (out.sov.length)
          out.problems.push(
            `The SOV comes from ${label}, grouped by cost code, with the client price as the scheduled value and the builder cost as the budget. Nothing is billed yet; add the latest invoice if the job has billed.`,
          );
      }
    } else if (kind === "change_orders") {
      // Commitment (sub) change orders aren't the owner's: keep them on the archive.
      if (cols.company !== undefined) {
        body.forEach((r, i) =>
          archive(
            "commitment_change_orders",
            get(r, "number") || `row:${i + 2}`,
            asRecord(head, r),
          ),
        );
        out.held.push({
          kind: "commitment change orders",
          count: body.length,
          why: `${label}: change orders with subs and suppliers, not the owner. Kept on the job's archive with the commitments.`,
          archived: true,
        });
        continue;
      }
      body.forEach((r, i) => {
        const amount = toCents(get(r, "amount"));
        const number = clip(get(r, "number"), 40);
        if (isTotal(number)) return;
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
          cost_cents: toCents(get(r, "cost")),
          probability: null,
        });
      });
    } else if (kind === "rfis") {
      body.forEach((r, i) => {
        const number = clip(get(r, "number"), 40);
        if (!number) {
          out.problems.push(`${at(i)}: an RFI needs a number.`);
          return;
        }
        const answer = clip(get(r, "answer"), 12000);
        const status = get(r, "status");
        out.rfis.push({
          source_id: `rfi:${number}`,
          number,
          title: clip(get(r, "title") || get(r, "question"), 200) || `RFI ${number}`,
          question: clip(get(r, "question"), 12000),
          open: !/closed|answered|resolved/i.test(status),
          sent_on: toDay(get(r, "sent")),
          due_on: toDay(get(r, "due")),
          ...(answer
            ? {
                answer_text: answer,
                answered_on: toDay(get(r, "answered_on")),
                answered_by: clip(get(r, "answered_by"), 320) || null,
              }
            : {}),
        });
      });
    } else if (kind === "submittals") {
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
    } else if (kind === "schedule") {
      readSchedule(out, body, get, label, at, from);
    } else if (kind === "dailies") {
      body.forEach((r, i) => {
        const date = toDay(get(r, "date"));
        if (!date) {
          out.problems.push(`${at(i)}: a daily needs a date.`);
          return;
        }
        let id = `daily:${date}`;
        for (let n = 2; out.dailies.some((d) => d.source_id === id); n++) id = `daily:${date}:${n}`;
        out.dailies.push({
          source_id: id,
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
    } else if (kind === "inspections") {
      const list = (out.inspections ??= []);
      body.forEach((r, i) => {
        const name = clip(get(r, "name") || get(r, "type"), 120);
        if (!name) {
          out.problems.push(`${at(i)}: an inspection needs a name or type.`);
          return;
        }
        const st = norm(get(r, "status"));
        const deficient = parseInt(get(r, "deficient"), 10);
        const failed =
          /fail|deficient|reject/.test(st) || (Number.isFinite(deficient) && deficient > 0);
        const closed = /closed|complete|pass/.test(st);
        const on = toDay(get(r, "date"));
        const done = toDay(get(r, "closed")) ?? (closed || failed ? on : null);
        const status = failed
          ? "failed"
          : closed
            ? "passed"
            : /cancel|void/.test(st)
              ? "cancelled"
              : on
                ? "scheduled"
                : "planned";
        list.push({
          source_id: `inspection:${get(r, "number") || i + 2}`.slice(0, 120),
          inspection_type: name,
          authority: null,
          location: clip(get(r, "location"), 200) || null,
          inspector: clip(get(r, "inspector"), 120) || null,
          responsible_party: clip(get(r, "responsible"), 120) || null,
          status,
          result:
            status === "failed"
              ? "fail"
              : status === "passed"
                ? "pass"
                : status === "cancelled"
                  ? "cancelled"
                  : "pending",
          requested_on: null,
          scheduled_on: on ?? toDay(get(r, "due")),
          completed_on: status === "failed" || status === "passed" ? done : null,
          attempt: 1,
          reinspection_required: status === "failed",
          cost_impact_cents: 0,
          schedule_impact_weeks: null,
          notes:
            clip(
              [
                get(r, "notes"),
                Number.isFinite(deficient) && deficient > 0
                  ? `${plural(deficient, "deficient item")} in ${from}.`
                  : "",
              ]
                .filter(Boolean)
                .join(" "),
              4000,
            ) || null,
          corrective_action: null,
          risk_ref: null,
          parent: null,
        });
      });
    } else {
      // Observations, commitments and the punch list: every row kept whole on
      // the job's read-only archive until Athena has a live log for them.
      const table = kind;
      let open = 0;
      body.forEach((r, i) => {
        const id = get(r, "number") || `row:${i + 2}`;
        if (isTotal(id) || isTotal(get(r, "title"))) return;
        if (!/closed|complete|void|cancel|terminated/i.test(get(r, "status"))) open++;
        archive(table, id, asRecord(head, r));
      });
      const count = Object.keys(out.archive[table] ?? {}).length;
      const what =
        kind === "observations"
          ? "observations"
          : kind === "commitments"
            ? "commitments (subcontracts and purchase orders)"
            : "punch items";
      out.held.push({
        kind: what.replace(/ \(.*/, ""),
        count,
        why: `${label}: ${plural(count, what.replace(/s( \(|$)/, "$1"), what)}${cols.status !== undefined ? `, ${open} still open` : ""}. Athena keeps them on the job's archive for now; they don't become live records yet.`,
        archived: true,
      });
    }
  }
  if (unread.length)
    out.problems.push(
      `Athena couldn't tell what ${unread.length === 1 ? "this file holds" : "these files hold"}, so ${unread.length === 1 ? "it is" : "they are"} left out: ${unread.join(", ")}. Say what each one is, or export it again with its column headers.`,
    );
  return out;
}

function readSchedule(
  out: ImportJob,
  body: string[][],
  get: (r: string[], f: string) => string,
  label: string,
  at: (i: number) => string,
  from: string,
) {
  const rows: { r: string[]; i: number; id: string; name: string }[] = [];
  const hasIds = body.some((r) => get(r, "id"));
  const used = new Set(out.schedule.map((a) => a.id));
  body.forEach((r, i) => {
    const name = clip(get(r, "name"), 160);
    // Buildertrend's schedule export has no activity IDs: number them in order.
    let id = clip(get(r, "id"), 20) || (hasIds ? "" : `A${(rows.length + 1) * 10}`);
    if (!id || !name) {
      out.problems.push(`${at(i)}: an activity needs an ID and a name.`);
      return;
    }
    if (used.has(id)) {
      const base = id.slice(0, 16);
      let n = 2;
      while (used.has(`${base}-${n}`)) n++;
      out.problems.push(`${at(i)}: the ID ${id} is used twice, so this one is ${base}-${n}.`);
      id = `${base}-${n}`;
    }
    used.add(id);
    rows.push({ r, i, id, name });
  });
  const byRow = new Map(rows.map((x) => [String(x.i + 1), x.id]));
  const byName = new Map(rows.map((x) => [x.name.toLowerCase(), x.id]));
  const ids = new Set(rows.map((x) => x.id));
  const phases = new Map<string, { sid: string; name: string }>();
  // Buildertrend keeps percent complete but no actual dates: work it has
  // started counts as started on its start date, and finished work as
  // finished on its end date. Said on the card so the member can correct it.
  const noActuals = body.every((r) => !get(r, "actual_start") && !get(r, "actual_finish"));
  let inferred = 0;
  const actuals = (r: string[]) => {
    if (!noActuals)
      return {
        actual_start: toDay(get(r, "actual_start")),
        actual_finish: toDay(get(r, "actual_finish")),
      };
    const pct = Number(get(r, "pct").replace("%", ""));
    const start = toDay(get(r, "start"));
    if (!(pct > 0) || !start) return {};
    inferred++;
    const finish = pct >= 100 ? toDay(get(r, "finish")) : null;
    return { actual_start: start, ...(finish ? { actual_finish: finish } : {}) };
  };
  let unresolved = 0;
  for (const { r, id, name } of rows) {
    const dur = parseInt(get(r, "duration").replace(/[^\d-]/g, ""), 10);
    const pct = Number(get(r, "pct").replace("%", ""));
    const links: NonNullable<ImportActivity["links"]> = [];
    for (const token of get(r, "predecessors").split(/[,;\n]+/)) {
      if (!token.trim()) continue;
      const t = parseLinkToken(token);
      const ref = t?.ref ?? token.trim();
      const target = ids.has(ref)
        ? ref
        : (byName.get(ref.toLowerCase()) ?? (/^\d+$/.test(ref) ? byRow.get(ref) : undefined));
      if (!t || !target || target === id) {
        unresolved++;
        continue;
      }
      if (links.length < 20 && !links.some((l) => l.id === target))
        links.push({ id: target, type: t.type, lag: Math.max(-5000, Math.min(5000, t.lag)) });
    }
    const phase = clip(get(r, "phase"), 160);
    if (phase && !phases.has(phase.toLowerCase()))
      phases.set(phase.toLowerCase(), { sid: `phase:${phases.size + 1}`, name: phase });
    out.schedule.push({
      source_id: `activity:${id}`,
      id,
      name,
      start: toDay(get(r, "start")),
      finish: toDay(get(r, "finish")),
      duration_days: Number.isFinite(dur) && dur >= 0 ? dur : null,
      pct_complete: get(r, "pct") && Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : null,
      predecessors: links.map((l) => l.id),
      ...(links.some((l) => l.type !== "FS" || l.lag) ? { links } : {}),
      ...actuals(r),
      ...(get(r, "baseline_start") || get(r, "baseline_finish")
        ? {
            baseline_start: toDay(get(r, "baseline_start")),
            baseline_finish: toDay(get(r, "baseline_finish")),
          }
        : {}),
      ...(phase ? { wbs: phases.get(phase.toLowerCase())!.sid } : {}),
    });
    if (out.schedule.length > 400)
      throw new ImportInputError(
        `${label} has more than 400 activities, Athena's CPM limit. Export the job's schedule without lookahead or template rows, or split it.`,
      );
  }
  if (phases.size)
    out.schedule_wbs = [
      ...(out.schedule_wbs ?? []),
      ...[...phases.values()].map((p, n) => ({
        source_id: p.sid,
        name: p.name,
        order: n,
        parent: null,
      })),
    ];
  if (inferred)
    out.problems.push(
      `${from}'s schedule export has percent complete but no actual dates, so ${plural(inferred, "started activity", "started activities")} count as started on ${inferred === 1 ? "its" : "their"} start date, and finished ones as finished on ${inferred === 1 ? "its" : "their"} end date. Correct any that started or finished on another day.`,
    );
  if (unresolved)
    out.problems.push(
      `${label}: ${plural(unresolved, "dependency", "dependencies")} name an activity that isn't in the export, so ${unresolved === 1 ? "it is" : "they are"} left off.`,
    );
  if (rows.length && !out.schedule_calendar) {
    out.schedule_calendar = MON_FRI;
    out.problems.push(
      `${from}'s schedule export carries no working calendar, so Athena calculates the CPM on Monday to Friday. If the crew works Saturdays, say so before you say yes.`,
    );
  }
}
