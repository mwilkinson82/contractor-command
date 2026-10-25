import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { visibleProblems } from "./visible";
import { pageAllowed, renderReportBody } from "../report-pages";
import {
  assembleDaily,
  buildFieldPayApp,
  dailyCard,
  dailyPageHtml,
  fieldAccess,
  fieldCard,
  fieldPageHtml,
  isRecordedDelay,
  parseWorkLine,
  payAppPercentCard,
  photoGate,
  photoPageHtml,
  projectField,
  rateFromLine,
  scheduleProposals,
  sniffPhoto,
} from "./superintendent";
import { livingReportGet } from "./tools/living-tools";
import { attachAthenaCard } from "./cards/attach";
import { photoLogPdf } from "./photo-pdf";
import {
  DAILY_REMINDER_TITLE,
  attachDailyReminder,
  dailyIsOverdue,
  dailyReminderCard,
  renderDailyReminder,
  shouldShowDailyCard,
} from "./field-reminder";
import { paletteViolations } from "./cards/palette";

const state = vi.hoisted(() => ({
  scope: "full" as "full" | "super" | "contract",
  uploads: [] as string[],
  removed: [] as string[],
  rpcs: [] as [string, Record<string, unknown>][],
  tables: {} as Record<string, unknown[]>,
  rpc: {} as Record<string, unknown>,
}));

vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) => fn(fakeSb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message?: string }) => {
    const m = e.message ?? "";
    if (m.startsWith("MCP_BAD:")) throw new Error(m.slice(8));
    throw new Error(m || "database error");
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  FULL_ACCESS_MESSAGE: "This needs full access to the job. Your role can't do it.",
  READ_ONLY_MESSAGE: "Your role has a limited, read-only view of this job (no financials). Ask your owner or PM to make changes.",
  audit: async () => {},
  prefix: (j: { job_number: string }) => `${j.job_number} – `,
  named: (j: { job_number: string; name?: string | null }) =>
    j.name && j.name.toLowerCase().startsWith(j.job_number.toLowerCase()) ? j.name : `${j.job_number} – ${j.name ?? ""}`.trim(),
  jobTimeZone: async () => "America/New_York",
  resolveJob: async () => ({
    job_id: "11111111-1111-4111-8111-111111111111",
    job_number: "2701",
    name: "Harbor",
    company_id: "22222222-2222-4222-8222-222222222222",
    scope: state.scope,
  }),
}));
vi.mock("./visible", async () => {
  const actual = await vi.importActual<typeof import("./visible")>("./visible");
  return {
    ...actual,
    guide: (r: unknown, ...lines: string[]) => ({ ...(r as object), guidance: lines.filter(Boolean) }),
  };
});

function query(rows: unknown[]) {
  const filters: [string, unknown][] = [];
  const filtered = () =>
    rows.filter((row) =>
      filters.every(([col, val]) => {
        if (!row || typeof row !== "object" || !(col in (row as Record<string, unknown>))) return true;
        return (row as Record<string, unknown>)[col] === val;
      }),
    );
  const run = async () => ({ data: filtered(), error: null });
  const b: Record<string, unknown> = {};
  b.select = () => b;
  b.eq = (col: string, val: unknown) => {
    filters.push([col, val]);
    return b;
  };
  b.order = () => b;
  b.limit = () => b;
  b.maybeSingle = async () => ({ data: filtered()[0] ?? null, error: null });
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => run().then(resolve, reject);
  return b;
}

function fakeSb() {
  return {
    from: (table: string) => query(state.tables[table] ?? []),
    storage: {
      from: () => ({
        upload: async (p: string) => {
          state.uploads.push(p);
          return { error: null };
        },
        createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://files.example/${p}?sig=1` }, error: null }),
        remove: async (ps: string[]) => {
          state.removed.push(...ps);
          return { error: null };
        },
      }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcs.push([fn, args]);
      const typed = args._type != null ? state.rpc[`${fn}:${String(args._type)}`] : undefined;
      return { data: typed ?? state.rpc[fn] ?? {}, error: null };
    },
  };
}

import {
  dailyReminderRun,
  dailyReportDraft,
  dailyReportSave,
  fieldPayApp,
  fieldProductionRates,
  progressPhotoSave,
  superintendentView,
} from "./tools/superintendent-tools";

type H = (a: Record<string, unknown>, c: unknown) => Promise<{ content: { text: string }[]; structuredContent: Record<string, unknown> }>;
const handle = (tool: unknown, args: Record<string, unknown>) => (tool as { handler: H }).handler(args, {});

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const dailyOk = {
  job_number: "2701",
  report_date: "2026-10-21",
  confirmed: true,
  weather: "Clear",
  manpower: "4 carpenters",
  subs_on_site: "none",
  deliveries: "none",
  issues: "none",
  delays: "none",
  safety: "Toolbox talk",
  work: [{ work: "Footings", sov_item: "03.01", activity_id: "A1000", qty: 40, unit: "cy", crew: 4, hours: 8, pct_complete: 30 }],
};

beforeEach(() => {
  state.scope = "full";
  state.uploads = [];
  state.removed = [];
  state.rpcs = [];
  state.tables = {};
  state.rpc = {};
  delete process.env.ATHENA_FIELD_REMINDER_EMAIL_ENABLED;
});

describe("superintendent scope", () => {
  it("keeps super on field work and estimating on rates only", () => {
    expect(fieldAccess("full")).toBe("field");
    expect(fieldAccess("super")).toBe("field");
    expect(fieldAccess("contract")).toBe("rates");
    expect(fieldAccess(null)).toBe("none");
    expect(pageAllowed("field", "super", false)).toBe(true);
    expect(pageAllowed("daily", "super", false)).toBe(true);
    expect(pageAllowed("photos", "contract", false)).toBe(false);
    expect(pageAllowed("payapp", "super", false)).toBe(false);
    expect(pageAllowed("ior", "super", false)).toBe(false);
  });
});

describe("daily assembly", () => {
  const transcript = [
    "Weather: Clear",
    "Manpower: 4 carpenters",
    "Subs: none",
    "Work:",
    "- Footings SOV 03.01 A1000 40 cy crew 4 8 hours 25%",
    "Deliveries: none",
    "Issues: none",
    "Delays: Crane waiting",
    "Safety: none",
  ].join("\n");

  it("maps a transcript onto the daily and asks for a missing SOV item, quantity, crew or hours", () => {
    const ready = assembleDaily({ transcript });
    expect(ready.ready).toBe(true);
    expect(ready.work[0]).toMatchObject({ sov_item: "03.01", activity_id: "A1000", qty: 40, unit: "cy", crew: 4, hours: 8, pct_complete: 25 });
    expect(ready.delays).toBe("Crane waiting");
    const missing = assembleDaily({ transcript: transcript.replace("SOV 03.01 ", "") });
    expect(missing.ready).toBe(false);
    expect(missing.follow_ups.some((q) => /SOV item/.test(q))).toBe(true);
    const card = dailyCard("2701 – ", "2026-10-21", ready, false);
    expect(card).toContain("Draft. Not saved.");
    expect(card).toContain("DELAY — Delays: Crane waiting");
    for (const none of ["none", "no delays", "TEST - none"]) {
      const quiet = dailyCard("2701 – ", "2026-10-21", { ...ready, delays: none }, false);
      expect(isRecordedDelay(none), none).toBe(false);
      expect(quiet, none).not.toContain("DELAY —");
      expect(dailyPageHtml({ job_number: "2701", found: true, delays: none, weather: "Clear" }), none).not.toContain("#DC2626");
    }
    expect(visibleProblems(card)).toEqual([]);
    expect(card).not.toContain("$");
  });

  it("does not save until the superintendent confirms, and a gap saves nothing", async () => {
    await expect(handle(dailyReportSave, { ...dailyOk, confirmed: false })).rejects.toThrow(/confirm/);
    expect(state.rpcs).toEqual([]);
    await expect(handle(dailyReportSave, { ...dailyOk, work: [{ work: "Footings", qty: 40, unit: "cy", crew: 4, hours: 8 }] })).rejects.toThrow(/Not saved/);
    expect(state.rpcs).toEqual([]);
    const draft = await handle(dailyReportDraft, { job_number: "2701", transcript: "Weather: Clear" });
    expect(draft.structuredContent.saved).toBe(false);
    expect(state.rpcs.map((r) => r[0])).not.toContain("mcp_daily_report_save");
  });

  it("puts the job name in the daily report header", () => {
    const draft = assembleDaily({ transcript: "Weather: Clear\nManpower: 4 carpenters\nSubs: none\nWork:\n- Footings SOV 03.01 A1000 40 cy crew 4 8 hours\nDeliveries: none\nIssues: none\nDelays: none\nSafety: none" });
    const card = dailyCard("1234 Riverside Clinic Renovation", "2026-10-22", draft, true);
    expect(card).toContain("1234 Riverside Clinic Renovation · Daily report · 2026-10-22");
    expect(card.split("\n")[1]).not.toBe("Daily report · 2026-10-22");
    const html = dailyPageHtml({
      job_number: "1234",
      job_name: "Riverside Clinic Renovation",
      found: true,
      report_date: "2026-10-22",
      weather: "Clear",
    });
    expect(html).toContain("1234 Riverside Clinic Renovation");
    expect(html).toContain("Daily");
  });

  it("extracts every daily field from a transcript that has no separate inputs", () => {
    const bullets = [
      "- Weather: Clear",
      "- Manpower: 4 carpenters",
      "- Subs: none",
      "- Work: Footings SOV 03.01 A1000 40 cy crew 4 8 hours 25%",
      "- Deliveries: none",
      "- Issues: none",
      "- Delays: Crane waiting",
      "- Safety: none",
    ].join("\n");
    const fromBullets = assembleDaily({ transcript: bullets });
    expect(fromBullets.weather).toBe("Clear");
    expect(fromBullets.manpower).toBe("4 carpenters");
    expect(fromBullets.subs_on_site).toBe("none");
    expect(fromBullets.work[0]).toMatchObject({ sov_item: "03.01", qty: 40, unit: "cy" });
    expect(fromBullets.deliveries).toBe("none");
    expect(fromBullets.issues).toBe("none");
    expect(fromBullets.delays).toBe("Crane waiting");
    expect(fromBullets.safety).toBe("none");
    const spoken = assembleDaily({
      transcript: "Clear and 70 degrees. Four carpenters from our crew. No subs on site. Formed the north footing SOV 03.01 A1000 40 cy crew 4 8 hours. Nothing was delivered. No issues. The crane was waiting. Safety talk done, no incidents.",
    });
    const card = dailyCard("2701 – Harbor · ", "2026-10-22", spoken, false);
    for (const field of ["Weather", "Manpower", "Subs on site", "Deliveries", "Issues", "Delays", "Safety"]) {
      expect(card, field).not.toContain(`${field}: Needed`);
    }
    expect(card).not.toContain("Work performed:\n- Needed");
    expect(spoken.weather).toMatch(/Clear and 70/);
    expect(spoken.manpower).toMatch(/4 carpenters/i);
    expect(spoken.subs_on_site).toBe("none");
    expect(spoken.work[0]?.sov_item).toBe("03.01");
    expect(spoken.deliveries).toBe("none");
    expect(spoken.issues).toBe("none");
    expect(spoken.delays).toMatch(/crane/i);
    expect(spoken.safety).toMatch(/Safety talk/i);
  });

  it("saves only a complete confirmed daily and records the production rate", async () => {
    state.rpc.mcp_daily_report_save = { id: "d1", lines: 1, saved: true };
    const r = await handle(dailyReportSave, dailyOk);
    expect(r.structuredContent.saved).toBe(true);
    expect(state.rpcs[0][0]).toBe("mcp_daily_report_save");
    expect(state.rpcs[0][1]._confirmed).toBe(true);
    expect(r.content[0].text).toContain("Saved.");
    expect(rateFromLine(parseWorkLine("Footings SOV 03.01 A1000 40 cy crew 4 8 hours"))).toMatchObject({
      man_hours: 32,
      qty_per_man_hour: 1.25,
      sov_item: "03.01",
    });
  });
});

describe("feeds", () => {
  const lines = [
    { item_no: "03.01", description: "Footings", scheduled_value: 1000 },
    { item_no: "03.02", description: "Rebar", scheduled_value: 500 },
  ];

  it("ties the G702 certificate to the schedule of values", () => {
    const app = buildFieldPayApp(lines, 10, 10, [{ item_no: "03.01", pct: 30 }], []);
    expect(app.contract_sum).toBe(1666.67);
    expect(app.rows[0]).toMatchObject({ previous: 0, this_period: 300, total_completed: 300, balance: 700, pct_complete: 30 });
    expect(app.rows[1].total_completed).toBeNull();
    const cents = (n: number) => Math.round(n * 100);
    const contract = cents(app.contract_sum);
    expect(cents(app.completed_and_stored) + cents(app.balance_to_finish)).toBe(contract);
    expect(cents(app.current_payment_due) + cents(app.previous_certificates) + cents(app.retainage ?? 0) + cents(app.balance_to_finish)).toBe(contract);
    expect(app.checks.every((c) => c.includes(String(app.contract_sum)) || c.startsWith("Contract") || c.includes("equals"))).toBe(true);
  });

  it("shows dollars to full scope and percents only to a super", async () => {
    state.tables.mcp_jobs = [{ sov_fee_pct: 10 }];
    state.tables.mcp_job_facts = [
      { key: "03.01", module: "sov", value: { description: "Footings", billable_value: 1000 } },
      { key: "03.02", module: "sov", value: { description: "Rebar", billable_value: 500 } },
      { key: "retainage", module: "contract", value: "10% until complete" },
    ];
    state.tables.mcp_daily_reports = [{ id: "d1", report_date: "2026-10-21" }];
    state.tables.mcp_daily_work_lines = [{ daily_id: "d1", sov_item: "03.01", activity_id: "A1000", qty: 40, unit: "cy", pct_complete: 30 }];
    const full = await handle(fieldPayApp, { job_number: "2701", period_to: "2026-10-21" });
    expect(full.content[0].text).toContain("| Contract sum · Reported | $1,666.67 |");
    expect(full.content[0].text).toContain("G702 tie checks");
    expect(full.structuredContent.card).toBeDefined();
    expect(full.structuredContent.html).toContain("G703 continuation");
    state.scope = "super";
    const sup = await handle(fieldPayApp, { job_number: "2701", period_to: "2026-10-21" });
    expect(sup.content[0].text).not.toContain("$");
    expect(sup.content[0].text).toContain("Percents only");
    expect(sup.structuredContent.no_financials).toBe(true);
  });

  it("returns a billing forecast card with version, ties and result-only widget metadata", async () => {
    state.tables.mcp_jobs = [{ sov_fee_pct: 0 }];
    state.tables.mcp_job_facts = [{ key: "03.01", value: { description: "Concrete", billable_value: 1_400_000 } }];
    state.rpc.mcp_living_report_get = { found: true, version: 2, data_date: "2026-10-22", forecast_total: 1_400_000, data: { billing: { months: [{ month: "2026-10", amount: 1_400_000, kind: "forecast" }] } } };
    const result = await handle(livingReportGet, { job_number: "2701", report_type: "billing_forecast" });
    const shown = attachAthenaCard("living_report_get", result);
    expect(shown.structuredContent.card).toBeDefined();
    expect(shown.structuredContent.html).toContain("Monthly billing");
    expect(shown.structuredContent.html).toContain("Version v2");
    expect(shown.structuredContent.html).not.toContain("Draft, not official");
    expect(shown.content[0].text).toContain("Forecast total $1,400,000.00 = contract $1,400,000.00");
    state.rpc.mcp_living_report_get = { found: false };
    const empty = await handle(livingReportGet, { job_number: "2701", report_type: "billing_forecast" });
    expect(empty.structuredContent.html).toContain("Billed to date");
    expect(empty.structuredContent.html).toContain("Needed");
    expect(empty.structuredContent.html).not.toContain("Draft, not official");
    expect(empty.structuredContent.found).toBe(false);
  });

  it("builds a Draft, not official pay app card from the schedule and the latest pay app", async () => {
    state.tables.mcp_jobs = [{ sov_fee_pct: 0 }];
    state.tables.mcp_job_facts = [
      { key: "03.01", module: "sov", value: { description: "Concrete", billable_value: 1_400_000 } },
      { key: "retainage", module: "contract", value: "§4.1 10% through 50% completion; 5% thereafter" },
    ];
    state.tables.mcp_daily_reports = [{ id: "d1", report_date: "2026-10-21" }];
    state.tables.mcp_daily_work_lines = [{ daily_id: "d1", sov_item: "03.01", pct_complete: 50, qty: null }];
    state.rpc.mcp_living_report_get = { found: false };
    state.rpc["mcp_living_report_get:cpm"] = {
      found: true,
      data: {
        activities: [
          {
            id: "A1000",
            name: "Concrete",
            duration: 22,
            start: "2026-10-01",
            finish: "2026-10-30",
            predecessors: [],
            total_float: 0,
            critical: true,
            pct_complete: 0,
            value: 1_400_000,
            sov_line: "03.01",
            cost_code: "03-100",
          },
        ],
      },
    };
    const result = (await handle(livingReportGet, { job_number: "2701", report_type: "billing_forecast" })) as {
      content: { text: string }[];
      guidance: string[];
      structuredContent: {
        html: string;
        found: boolean;
        draft: boolean;
        contract_total: number;
        tie: { ties: boolean; line: string };
        data: { billing: { billed_to_date: number; months: { month: string; amount: number; kind: string }[] } };
      };
    };
    const text = result.content[0].text;
    expect(result.structuredContent.found).toBe(false);
    expect(result.structuredContent.draft).toBe(true);
    expect(result.structuredContent.contract_total).toBe(1_400_000);
    expect(result.structuredContent.tie.ties).toBe(true);
    expect(result.structuredContent.tie.line).toBe("Forecast total $1,400,000.00 = contract $1,400,000.00");
    expect(result.structuredContent.data.billing.billed_to_date).toBe(700_000);
    expect(result.structuredContent.data.billing.months).toEqual([
      { month: "2026-10", amount: 700_000, kind: "actual" },
      { month: "2026-10", amount: 700_000, kind: "forecast" },
    ]);
    expect(result.structuredContent.data.billing.months.reduce((sum, row) => sum + Math.round(row.amount * 100), 0)).toBe(140_000_000);
    expect(text).toContain("Draft, not official");
    expect(text).toContain("Tie check");
    expect(text).toContain("Retainage step-down");
    expect(text).toContain("10% through 50% complete ($700,000.00), held $70,000.00.");
    expect(text).toContain("5% thereafter ($700,000.00), held $35,000.00.");
    expect(text).toContain("Retainage at completion $105,000.00.");
    expect(text).toContain("Forecast total $1,400,000.00 = contract $1,400,000.00");
    expect(text).not.toMatch(/Lovable/i);
    expect(text).not.toContain("living_report_save");
    expect(visibleProblems(text)).toEqual([]);
    expect(paletteViolations(result.structuredContent.html, false)).toEqual([]);
    expect(result.guidance).toEqual([
      "Show this card as written. Leave it as Athena drew it. Only after the PM says yes, call living_report_save with base_version 0. Pass data.billing from this result.",
    ]);

    state.rpc["mcp_living_report_get:cpm"] = {
      found: true,
      data: {
        activities: [
          {
            id: "A1000",
            name: "Concrete",
            duration: 5,
            start: "2026-10-01",
            finish: "2026-10-07",
            predecessors: [],
            total_float: 0,
            critical: false,
            pct_complete: 0,
            value: 100,
            sov_line: "03.01",
            cost_code: null,
          },
        ],
      },
    };
    const untied = await handle(livingReportGet, { job_number: "2701", report_type: "billing_forecast" });
    expect(untied.structuredContent.html).toContain("Needed");
    expect(untied.structuredContent.html).not.toContain("Draft, not official");
    expect(untied.structuredContent.found).toBe(false);
  });

  it("keeps every superintendent progress row on the card without dollars", async () => {
    state.scope = "super";
    state.tables.mcp_daily_reports = [{ id: "d1", report_date: "2026-10-21" }];
    state.tables.mcp_daily_work_lines = Array.from({ length: 12 }, (_, n) => ({ daily_id: "d1", sov_item: `03.${n + 1}`, qty: 40, unit: "cy", pct_complete: 30 }));
    const result = await handle(fieldPayApp, { job_number: "2701", period_to: "2026-10-21" });
    const shown = attachAthenaCard("field_pay_app", result);
    expect(shown.content[0].text).toContain("03.12");
    expect(JSON.stringify(shown)).not.toContain("$");
    expect((shown.structuredContent.card as { sections: { rows: unknown[] }[] }).sections[0].rows).toHaveLength(12);
  });

  it("proposes CPM percents without writing the schedule", () => {
    const rows = scheduleProposals([{ id: "A1000", pct_complete: 0 }], [{ activity_id: "A1000", report_date: "2026-10-21", pct_complete: 30 }]);
    expect(rows).toEqual([{ activity_id: "A1000", from_pct: 0, to_pct: 30, report_date: "2026-10-21" }]);
  });

  it("lets estimating read rates and keeps a super off the estimate tables", async () => {
    state.scope = "contract";
    state.tables.mcp_production_rates = [{ work: "Footings", sov_item: "03.01", activity_id: "A1000", qty: 40, unit: "cy", crew: 4, hours: 8, man_hours: 32, qty_per_man_hour: 1.25, created_at: "2026-10-21" }];
    const r = await handle(fieldProductionRates, { job_number: "2701" });
    expect(r.content[0].text).toContain("1.25 cy per man-hour");
    expect(r.content[0].text).not.toContain("$");
    state.scope = "contract";
    await expect(handle(superintendentView, { job_number: "2701" })).rejects.toThrow(/full access/);
  });
});

describe("field board", () => {
  const src = {
    data_date: null,
    lookahead: { start_date: "2026-10-26", end_date: "2026-11-06" },
    today: "2026-10-21",
    activities: [
      { id: "A1000", name: "Footings", start: "2026-10-26", finish: "2026-10-30", total_float: 4, critical: false, pct_complete: 10, sov_line: "03.01" },
      { id: "A2000", name: "Steel", start: "2026-10-27", finish: "2026-10-29", total_float: -2, critical: true, pct_complete: 0, sov_line: "05.01" },
      { id: "A9000", name: "Paint", start: "2026-12-01", finish: "2026-12-05", total_float: 8, critical: false, pct_complete: 0, sov_line: "09.01" },
    ],
    assignments: [
      { activity_id: "A1000", self_perform: true, sub_name: null, crew_size: 4 },
      { activity_id: "A2000", self_perform: false, sub_name: "Apex Steel", crew_size: null },
    ],
    materials: [{ item: "Footings concrete", material: "Concrete", qty: 80, unit: "cy", trade: "Footings" }],
    rates: [{ activity_id: "A1000", sov_item: "03.01", unit: "cy", qty_per_man_hour: 1.25, crew: 4, hours: 8 }],
    installed: [],
    items: [{ action: "Inspection", owner: "City", due: "2026-10-20" }],
  };

  it("shows subs, self-perform crew, man-days and materials, with red only on a delay", () => {
    const board = projectField(src);
    const foot = board.rows.find((r) => r.id === "A1000")!;
    expect(foot.self_perform).toBe(true);
    expect(foot.crew).toBe(4);
    expect(foot.man_hours).toBe(64);
    expect(foot.man_days).toBe(8);
    expect(foot.materials[0]).toMatchObject({ item: "Concrete", remaining: 80, unit: "cy" });
    const steel = board.rows.find((r) => r.id === "A2000")!;
    expect(steel.sub).toBe("Apex Steel");
    expect(steel.materials).toEqual([]);
    expect(steel.delay).toBe(true);
    expect(board.outside).toBe(1);
    const card = fieldCard("2701 – ", board, src.items, "2026-10-21");
    expect(card).toContain("Self-perform");
    expect(card).toContain("Sub: Apex Steel");
    expect(card).toContain("DELAY — Steel");
    expect(card).not.toContain("DELAY — A2000");
    expect(card).toContain("OVERDUE — Inspection");
    expect(card).not.toContain("$");
    expect(visibleProblems(card)).toEqual([]);
    const html = fieldPageHtml({ ...src, job_number: "2701", job_name: "Harbor" });
    expect(html).toContain("max-width:420px");
    expect(html).toContain('href="../items"');
    expect(html).toContain("View all open items");
    expect(html).toContain("#DC2626");
    expect(html).toContain("#1E3A5F");
    const calm = fieldPageHtml({ ...src, activities: [src.activities[0]], items: [], job_number: "2701", job_name: "Harbor" });
    expect(calm).not.toContain("#DC2626");
    expect(renderReportBody({ page: "field", job_number: "2701", job_name: "Harbor", activities: [] })).toContain("max-width:420px");
    expect(renderReportBody({ page: "schedule", job_number: "2701", job_name: "Harbor", report: { found: false } })).toContain("max-width:1100px");
  });
});

describe("photos", () => {
  it("defaults the date to the upload time and will not store until the place is confirmed", async () => {
    const gate = photoGate({ uploaded_at: "2026-10-21T18:00:00Z", time_zone: "America/New_York" });
    expect(gate.ok).toBe(false);
    expect(gate.taken_on).toBe("2026-10-21");
    expect(gate.questions.join(" ")).toMatch(/uploaded/);
    expect(gate.questions.join(" ")).toMatch(/Where on site/);
    const yes = photoGate({ recognized: true, date_confirmed: true, confirmed: true, area: "North footing", uploaded_at: "2026-10-21T18:00:00Z", time_zone: "America/New_York" });
    expect(yes).toMatchObject({ ok: true, taken_on: "2026-10-21" });
    expect(sniffPhoto(JPEG, "slab.jpg")?.mime).toBe("image/jpeg");
    expect(sniffPhoto(Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0, 0, 0, 0, 0, 0, 0]), "x.jpg")).toBeNull();
    await expect(handle(progressPhotoSave, { job_number: "2701", filename: "slab.jpg", content_base64: Buffer.from(JPEG).toString("base64") })).resolves.toMatchObject({ structuredContent: { saved: false, client_safe: false } });
    expect(state.uploads).toEqual([]);
    state.rpc.mcp_progress_photo_create = { linked_daily: true, client_safe: false };
    const saved = await handle(progressPhotoSave, {
      job_number: "2701", filename: "slab.jpg", content_base64: Buffer.from(JPEG).toString("base64"),
      recognized: true, date_confirmed: true, confirmed: true, area: "North footing",
    });
    expect(saved.structuredContent.saved).toBe(true);
    expect(saved.structuredContent.client_safe).toBe(false);
    expect(state.uploads[0]).toMatch(/^22222222-2222-4222-8222-222222222222\/11111111-1111-4111-8111-111111111111\/[0-9a-f-]{36}\/progress\.jpg$/);
    expect(saved.content[0].text).not.toMatch(/files\.example|supabase/i);
    const pdf = new TextDecoder("latin1").decode(photoLogPdf("2701", [{ taken_on: "2026-10-21", area: "North footing", client_safe: false }]));
    expect(pdf).not.toMatch(/jspdf/i);
    expect(pdf).toContain("North footing");
    const gallery = photoPageHtml({ job_number: "2701", photos: [{ taken_on: "2026-10-21", area: "North footing", client_safe: false, url: "https://files.example/a?sig=1" }] });
    expect(gallery).toContain("max-width:420px");
    expect(gallery).toContain("Internal");
    const daily = dailyPageHtml({ job_number: "2701", found: true, report_date: "2026-10-21", weather: "Clear", manpower: "4", subs_on_site: "none", deliveries: "none", issues: "none", delays: "Crane", safety: "none", lines: [] });
    expect(daily).toContain("#DC2626");
    expect(dailyPageHtml({ ...{ job_number: "2701", found: true, delays: "none", weather: "Clear" } })).not.toContain("#DC2626");
  });
});

describe("daily reminder card", () => {
  const due = { enabled: true, localMinutes: 15 * 60, sendLocal: "14:30", dailyToday: false, alreadyShown: false };

  it("shows once after 2:30 PM when today's daily is missing, and stays quiet otherwise", () => {
    expect(shouldShowDailyCard(due)).toBe(true);
    expect(shouldShowDailyCard({ ...due, localMinutes: 14 * 60 })).toBe(false);
    expect(shouldShowDailyCard({ ...due, enabled: false })).toBe(false);
    expect(shouldShowDailyCard({ ...due, dailyToday: true })).toBe(false);
    expect(shouldShowDailyCard({ ...due, alreadyShown: true })).toBe(false);
    expect(dailyIsOverdue("2026-10-19", "2026-10-21")).toBe(true);
    expect(dailyIsOverdue("2026-10-20", "2026-10-21")).toBe(false);
    expect(dailyIsOverdue(null, "2026-10-21")).toBe(false);
  });

  it("uses the card palette, and red only when a previous day is overdue", () => {
    const quiet = dailyReminderCard({ jobNumber: "2701", jobName: "Harbor", overdue: false });
    const loud = dailyReminderCard({ jobNumber: "2701", jobName: "Harbor", overdue: true, lastDaily: "2026-10-19" });
    expect(quiet.title).toBe(DAILY_REMINDER_TITLE);
    expect(quiet.next_move).toBe("Start today's daily.");
    const quietText = renderDailyReminder(quiet);
    const loudText = renderDailyReminder(loud);
    expect(paletteViolations(quietText, false)).toEqual([]);
    expect(quietText).not.toContain("#DC2626");
    expect(paletteViolations(loudText, true)).toEqual([]);
    expect(loudText).toContain('data-alert="overdue"');
    expect(quietText).toContain("ask Athena if my daily is in for job 2701");
  });

  it("records the show once and never sends email", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const calls: string[] = [];
    const sb = {
      rpc: async (fn: string) => {
        calls.push(fn);
        if (fn === "mcp_daily_reminder_status") {
          return { data: { found: true, job_id: "j1", job_number: "2701", job_name: "Harbor", enabled: true, send_local: "14:30", local_date: "2026-10-21", local_minutes: 900, daily_today: false, last_daily: "2026-10-20", already_shown: false }, error: null };
        }
        if (fn === "mcp_daily_reminder_mark_shown") return { data: { recorded: true }, error: null };
        return { data: null, error: null };
      },
    };
    const result = await attachDailyReminder(sb, "2701", { content: [{ type: "text", text: "Job body" }], structuredContent: {} });
    expect(calls).toEqual(["mcp_daily_reminder_status", "mcp_daily_reminder_mark_shown"]);
    expect((result as { content: { text: string }[] }).content[0].text.startsWith("## ")).toBe(true);
    expect((result as { content: { text: string }[] }).content[0].text).toContain(DAILY_REMINDER_TITLE);
    expect((result as { content: { text: string }[] }).content[0].text).toContain("Job body");
    const again = await attachDailyReminder({ rpc: async () => ({ data: { found: true, enabled: true, send_local: "14:30", local_date: "2026-10-21", local_minutes: 900, daily_today: false, already_shown: true, job_id: "j1" }, error: null }) }, "2701", { content: [{ type: "text", text: "Job body" }] });
    expect((again as { content: { text: string }[] }).content[0].text).toBe("Job body");
    const ran = await handle(dailyReminderRun, { job_number: "2701" });
    expect(ran.content[0].text).toContain("Nothing was sent.");
    expect(ran.structuredContent.sent).toBe(0);
    state.rpc.mcp_daily_reminder_status = { found: true, job_number: "2701", job_name: "Harbor", enabled: true, send_local: "14:30", local_date: "2026-10-21", last_daily: null, daily_today: false, already_shown: false };
    const preview = await handle(dailyReminderRun, { job_number: "2701", preview: true });
    expect(preview.content[0].text).toContain(DAILY_REMINDER_TITLE);
    expect(preview.structuredContent.preview).toBe(true);
    expect(preview.structuredContent.sent).toBe(0);
    expect(preview.content[0].text).toContain("job 2701");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    const sql = readFileSync("supabase/migrations/20261023040000_athena_daily_reminder_card.sql", "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_daily_reminder_shows");
    expect(sql).toContain("PRIMARY KEY (job_id, user_id, shown_on)");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/marshall@|office@|resend/i);
  });
});

describe("migration", () => {
  const sql = readFileSync("supabase/migrations/20261023020000_athena_superintendent.sql", "utf8");
  it("only adds field tables, keeps super off dollars, and leaves the reminder off", () => {
    for (const t of ["mcp_field_activities", "mcp_daily_reports", "mcp_daily_work_lines", "mcp_production_rates", "mcp_field_schedule_feed", "mcp_progress_photos", "mcp_daily_reminders"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS public.${t}`);
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain("enabled boolean NOT NULL DEFAULT false");
    expect(sql).toContain("send_local time NOT NULL DEFAULT '14:30'");
    expect(sql).toContain("client_safe boolean NOT NULL DEFAULT false");
    expect(sql).toContain("'athena-progress', 'athena-progress', false");
    expect(sql).toContain("mcp_job_scope(job_id) IN ('full', 'super', 'contract')");
    expect(sql).toContain("mcp_job_scope(job_id) IN ('full', 'super')");
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(sql).not.toMatch(/marshall@|office@/i);
    expect(sql).toContain("No dollar columns");
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION public.mcp_job_scope");
  });
});

describe("percent card", () => {
  it("never prints a dollar figure", () => {
    const card = payAppPercentCard("2701 – ", "2026-10-21", [{ item_no: "03.01", pct: 30, qty: 40, unit: "cy" }]);
    expect(card).not.toContain("$");
    expect(card).toContain("30% complete");
  });
});
