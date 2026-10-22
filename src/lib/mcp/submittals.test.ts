import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderHtml } from "./cards/html";
import { paletteViolations } from "./cards/palette";
import { CARD_SHOWN } from "./cards/silence";
import { attachAthenaCard } from "./cards/attach";
import { renderReportBody, pageAllowed, pageUrl } from "../report-pages";
import { boardPageFor, signedJobUrl } from "./board-url";
import { boardPageAllowed } from "./board-link";
import { boardSignInReturn } from "../board-sign-in";
import {
  currentSubmittals,
  dueBackDate,
  filterSubmittals,
  headerMatchesRows,
  packageProgress,
  parseSubmittalImport,
  postureSentence,
  presentImportPreview,
  presentSubmittalLog,
  resolvePosture,
  routeSubmittal,
  submittalOverdue,
  IMPORT_CONFIRM,
  type SubmittalRecord,
} from "./submittals";
import { kindLabel, presentJobRecord, presentProjectRecord, recordHeaderMatches, isDisputeAsk, EMAIL_REPLY_KIND } from "./project-record";
import { scheduleSubmittalGroups } from "./schedule-submittals";

const JOB = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-10-22";

function row(over: Partial<SubmittalRecord> & Pick<SubmittalRecord, "id" | "number" | "revision">): SubmittalRecord {
  return {
    transmittal_number: 1,
    spec_section: "26 24 16",
    title: "Switchgear",
    submittal_type: "product_data",
    status: "submitted",
    ball_in_court: "architect_engineer",
    required_by: "2026-10-01",
    submitted_on: "2026-10-01",
    due_back: "2026-10-15",
    returned_on: null,
    source: "user",
    required: true,
    package_items: [],
    ...over,
  };
}

describe("submittal dates, overdue, and package", () => {
  it("computes due back as calendar days and does not roll a weekend", () => {
    expect(dueBackDate("2026-10-01", 14)).toBe("2026-10-15");
    expect(dueBackDate("2026-10-01", null)).toBe("2026-10-15");
    expect(dueBackDate(null, 14)).toBeNull();
  });

  it("is overdue past due back without a return, or past required-by without a submit", () => {
    expect(submittalOverdue(row({ id: "a", number: "001", revision: 0 }), TODAY)).toBe(true);
    expect(submittalOverdue(row({ id: "a", number: "001", revision: 0, returned_on: "2026-10-18" }), TODAY)).toBe(false);
    expect(submittalOverdue(row({ id: "b", number: "002", revision: 0, submitted_on: null, due_back: null, required_by: "2026-10-10" }), TODAY)).toBe(true);
    expect(submittalOverdue(row({ id: "c", number: "003", revision: 0, due_back: "2026-11-03", required_by: "2026-11-01", submitted_on: "2026-10-20" }), TODAY)).toBe(false);
  });

  it("treats an empty package as not complete and a received required set as complete", () => {
    expect(packageProgress([])).toEqual({ required: 0, received: 0, complete: false });
    expect(packageProgress([{ status: "received", required: true }, { status: "needed", required: true }]).complete).toBe(false);
    expect(packageProgress([{ status: "approved", required: true }, { status: "needed", required: false }]).complete).toBe(true);
  });

  it("counts the latest revision once", () => {
    const rows = [
      row({ id: "a", number: "001", revision: 0, title: "Old" }),
      row({ id: "b", number: "001", revision: 1, title: "New", due_back: "2026-11-01", returned_on: null, submitted_on: "2026-10-20" }),
      row({ id: "c", number: "002", revision: 0, title: "Other", submitted_on: null, due_back: null }),
    ];
    const card = presentSubmittalLog({ jobNumber: "2701", jobName: "Harbor", rows, today: TODAY, boardUrl: signedJobUrl("submittals", JOB, "tok") }).card;
    expect(headerMatchesRows(card)).toBe(true);
    expect(card.kpis?.find((kpi) => kpi.label === "Submittals")?.value).toBe("2");
    expect(card.sections?.find((section) => section.heading === "Log")?.rows).toHaveLength(2);
    expect(currentSubmittals(rows).map((item) => item.id)).toEqual(["b", "c"]);
  });
});

describe("posture and routing", () => {
  it("uses the public-work flag, then a stored posture", () => {
    expect(resolvePosture(null, "yes")).toBe("strict");
    expect(resolvePosture(null, "no")).toBe("advisory");
    expect(resolvePosture("advisory", "yes")).toBe("advisory");
    expect(resolvePosture(null, "unknown")).toBeNull();
    expect(postureSentence("strict")).toMatch(/engineer's approval/);
    expect(postureSentence(null)).toMatch(/unset/);
  });

  it("routes the named phrases and the misspellings", () => {
    expect(routeSubmittal("Hey Athena, log a submittal")).toEqual({ tool: "submittal_log", action: "add" });
    expect(routeSubmittal("what submittals are overdue")).toEqual({ tool: "submittals_list", overdue: true, jobNumber: null });
    expect(routeSubmittal("submittal log for 2701")).toEqual({ tool: "submittals_list", overdue: false, jobNumber: "2701" });
    for (const word of ["submital", "submittle", "sumittal", "submittall"]) {
      expect(routeSubmittal(`log a ${word}`)?.tool).toBe("submittal_log");
    }
    expect(routeSubmittal("import the submittal log for 2701")?.tool).toBe("submittals_import");
  });
});

describe("import preview", () => {
  it("maps columns loosely, dedupes number and revision, and does not write", () => {
    const text = [
      "Submittal No, Rev, Spec Section, Description, Status",
      "001, 0, 26 24 16, Switchgear, submitted",
      "001, 0, 26 24 16, Switchgear revised, submitted",
      "002, , , Missing title, submitted",
    ].join("\n");
    const preview = parseSubmittalImport(text, []);
    expect(preview.duplicates).toBe(1);
    expect(preview.ready).toHaveLength(1);
    expect(preview.ready[0]).toMatchObject({ number: "001", revision: 0, title: "Switchgear revised", spec_section: "26 24 16" });
    expect(preview.problems).toHaveLength(1);
    const card = presentImportPreview("2701", "Harbor", preview).card;
    expect(card.state).toBe("ask");
    expect(card.ask?.prompt).toBe(IMPORT_CONFIRM);
    expect(card.kpis?.find((kpi) => kpi.label === "Ready")?.value).toBe(String(card.sections?.[0].rows.length));
    expect(filterSubmittals([], { today: TODAY })).toEqual([]);
  });
});

describe("card and board", () => {
  it("keeps the card in the house palette and ends on the card line", () => {
    const late = row({ id: "a", number: "001", revision: 0, title: "SAMPLE Switchgear" });
    const presented = presentSubmittalLog({
      jobNumber: "2701",
      jobName: "Harbor",
      rows: [late],
      today: TODAY,
      boardUrl: signedJobUrl("submittals", JOB, "tok"),
      posture: postureSentence("strict"),
    });
    const html = renderHtml(presented.card);
    expect(paletteViolations(html, true)).toEqual([]);
    expect(html).toContain("#DC2626");
    const quiet = renderHtml(presentSubmittalLog({
      jobNumber: "2701",
      jobName: "Harbor",
      rows: [row({ id: "c", number: "003", revision: 0, due_back: "2026-11-03", submitted_on: "2026-10-20", required_by: "2026-11-01" })],
      today: TODAY,
      boardUrl: null,
    }).card);
    expect(paletteViolations(quiet, false)).toEqual([]);
    const sealed = attachAthenaCard("submittals_list", { content: [{ type: "text", text: presented.text }], structuredContent: { card: presented.card } }) as {
      content: { text?: string }[];
    };
    expect(sealed.content[0].text?.trim().endsWith("</html>")).toBe(true);
    expect(sealed.content[0].text).not.toMatch(/REQUIRED VIEW|do not add text/i);
    expect(sealed.content[0].text).toContain("Submittal log");
    expect(sealed.content[0].text).toContain("SAMPLE Switchgear");
  });

  it("renders the board in the items style and lets a superintendent read it", () => {
    const html = renderReportBody({
      page: "submittals",
      job_number: "2701",
      job_name: "Harbor",
      read_only: true,
      review_days: 14,
      today: TODAY,
      public_job: "yes",
      submittals: [
        row({ id: "a", number: "001", revision: 0, title: "SAMPLE Switchgear" }),
        row({ id: "b", number: "001", revision: 1, title: "SAMPLE Switchgear resubmit", due_back: "2026-11-03", submitted_on: "2026-10-20" }),
      ],
    });
    const count = Number(html.match(/data-count="(\d+)"/)?.[1]);
    const rows = html.match(/data-submittal-row=/g) ?? [];
    expect(count).toBe(rows.length);
    expect(count).toBe(1);
    expect(html).toContain("Read only.");
    expect(html).toContain("Strict.");
    expect(pageUrl("submittals", JOB)).toBe(`https://app.meetathena.io/r/job/${JOB}/submittals`);
    expect(boardPageFor("submittal log")).toBe("submittals");
    expect(boardPageAllowed("submittals", "super")).toBe(true);
    expect(pageAllowed("submittals", "super", false)).toBe(true);
    expect(pageAllowed("submittals", "contract", false)).toBe(false);
    expect(boardSignInReturn(`/r/job/${JOB}/submittals?t=old&utm_source=chatgpt.com`)).toBe(`/r/job/${JOB}/submittals`);
  });
});

describe("schedule groups on an empty log", () => {
  it("keeps submit activities and drops architect review", () => {
    const groups = scheduleSubmittalGroups([
      { id: "A1020", name: "Submit long-lead gear (SWGR, SWBD, PNL, GEN)", finish: "2026-10-28", critical: true },
      { id: "A1030", name: "Submit all other shop drawings & data", finish: "2026-11-06" },
      { id: "A1040", name: "Architect review of long-lead gear", finish: "2026-11-12" },
    ]);
    expect(groups.map((group) => group.id)).toEqual(["A1020", "A1030"]);
    const presented = presentSubmittalLog({
      jobNumber: "2701",
      jobName: "Harbor Point",
      rows: [],
      today: TODAY,
      boardUrl: null,
      schedule: groups,
      tracking: [{ id: "e14", action: "2701 – Resolve: E14 Owner/engineer/architect submittal and RFI turnaround times are identified.", due: "2026-10-16", overdue: true }],
    });
    expect(presented.text).toContain("A1020");
    expect(presented.text).toContain("E14");
    expect(presented.text).not.toContain("A1040");
    expect(presented.card.kpis?.find((kpi) => kpi.label === "Submittals")?.value).toBe("2");
    expect(presented.card.kpis?.find((kpi) => kpi.label === "Overdue")?.value).toBe("1");
    expect(presented.card.sections?.some((section) => section.heading === "Schedule")).toBe(true);
  });
});

describe("project record card", () => {
  it("defaults to the job record unless the ask is a dispute or a claim", () => {
    expect(isDisputeAsk(null, "project record")).toBe(false);
    expect(isDisputeAsk("claim", null)).toBe(true);
    expect(isDisputeAsk(null, "show the disputes")).toBe(true);
    const card = presentJobRecord({
      jobNumber: "2701",
      jobName: "Harbor Point",
      contractTotal: "$1,400,000.00",
      open: 22,
      overdue: 3,
      items: [{ action: "E14 turnaround", due: "2026-10-16", overdue: true }],
    }).card;
    expect(card.title).toBe("Project record");
    expect(card.kpis?.find((kpi) => kpi.label === "Schedule of values")?.value).toBe("$1,400,000.00");
    expect(card.kpis?.find((kpi) => kpi.label === "Open")?.value).toBe("22");
    expect(card.kpis?.find((kpi) => kpi.label === "Overdue")?.flag).toBe("overdue");
  });

  it("counts events once and leaves reply outcomes unwired", () => {
    const card = presentProjectRecord({
      jobNumber: "2701",
      jobName: "Harbor",
      events: [
        { id: "1", occurred_at: "2026-10-22T12:00:00Z", actor: "user", kind: "email_sent", title: "Lookahead", summary: "Email to pm@example.com. Subject: Lookahead.", counterparty_email: "pm@example.com" },
        { id: "2", occurred_at: "2026-10-22T12:05:00Z", actor: "user", kind: "submittal_created", title: "Submittal 001 revision 0", summary: "SAMPLE Switchgear." },
      ],
    }).card;
    expect(recordHeaderMatches(card)).toBe(true);
    expect(kindLabel("email_sent")).toBe("Email sent");
    expect(EMAIL_REPLY_KIND).toBe("email_reply");
    const src = readFileSync("src/lib/mcp/tools/email-tools.ts", "utf8");
    expect(src).toContain('kind: "email_sent"');
    expect(src).not.toContain('kind: "email_reply"');
  });
});

describe("migration", () => {
  const sql = readFileSync("supabase/migrations/20261023220000_athena_submittal_log.sql", "utf8");

  it("is additive, reuses the append-only lock, and does not seed rows", () => {
    expect(sql).not.toMatch(/\bDROP TABLE\b/);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    expect(sql).not.toContain("SAMPLE");
    expect(sql).toContain("mcp_block_change()");
    expect(sql).toContain("public_job");
    expect(sql).toContain("submittal_posture");
    expect(sql).toContain("spec_excerpt");
    expect(sql).toContain("submittal_kickoff_at");
    expect(sql).toContain("mcp_project_record_events");
    expect(sql).toContain("BEFORE UPDATE OR DELETE");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.mcp_project_record_events");
    expect(sql).toContain("mcp_submittal_record");
    expect(sql.match(/PERFORM public\.mcp_submittal_record/g)?.length).toBe(2);
  });
});
