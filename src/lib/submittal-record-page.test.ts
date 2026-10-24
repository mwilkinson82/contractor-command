// The submittal record page, the links that reach it, the piece names any host can use, and the filtered log view.
import { describe, expect, it } from "vitest";
import {
  renderSubmittalRecordBody,
  submittalRecordPath,
  submittalRecordFile,
  submittalPackageTarget,
  type SubmittalRecordPayload,
} from "./submittal-record-page";
import { renderReportBody } from "./report-pages";
import { boardReturnForVisit, boardSignInReturn } from "./board-sign-in";
import { jobLinksMissingToken, submittalRecordUrl } from "./mcp/board-url";
import { submittalPackageUrl } from "./mcp/submittal-record-url";
import { findPackagePiece } from "./mcp/submittal-package";
import { hostFromClientName, hostLabel } from "./mcp/call-host";
import { headerMatchesRows, presentSubmittalLog, type SubmittalRecord } from "./mcp/submittals";
import { ALERT_HEX } from "./mcp/alert-color";
import { signSiblingLinks } from "@/components/athena/ReportPage";

const JOB = "11111111-1111-4111-8111-111111111111";
const TOKEN = "t".repeat(43);
const BOARD = `https://app.meetathena.io/r/job/${JOB}/submittals?t=${TOKEN}`;
const TODAY = "2026-10-24";

function row(
  over: Partial<SubmittalRecord> & Pick<SubmittalRecord, "id" | "number" | "revision">,
): SubmittalRecord {
  return {
    transmittal_number: 3,
    spec_section: "26 24 16",
    title: "Fictional switchgear",
    submittal_type: "product_data",
    status: "submitted",
    ball_in_court: "architect_engineer",
    ball_in_court_name: "Fictional Design",
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

const items = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    kind: "product_cut",
    source_party: "Fictional Manufacturer",
    status: "received",
    required: true,
    file_ref: "athena-submittals/c/j/pieces/x/cut.pdf",
    chase_role: "manufacturer",
    chase_name: "Pat Sample",
    chase_email: "pat@example.com",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    kind: "shop_drawing",
    source_party: "Fictional Sub",
    status: "needed",
    required: true,
    file_ref: null,
    chase_role: "sub",
    chase_name: "Sam Sample",
    chase_email: "sam@example.com",
    chase_count: 2,
    last_chased_at: "2026-10-20T12:00:00Z",
    next_chase_at: "2026-10-27",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
    kind: "shop_drawing",
    source_party: "Fictional Manufacturer",
    status: "needed",
    required: false,
    file_ref: null,
  },
];

describe("record page", () => {
  it("opens the exact package from a signed row, retaining the job and board key", () => {
    const id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const url = new URL(submittalPackageUrl(BOARD, "26 24 16-001", id)!);
    expect(url.pathname).toBe(`/r/job/${JOB}/submittal/26%2024%2016-001`);
    expect(url.searchParams.get("t")).toBe(TOKEN);
    expect(url.searchParams.get("open")).toBe("package");
    expect(url.searchParams.get("package_id")).toBe(id);
    expect(submittalPackageUrl(BOARD, "S1", "")).toBeNull();
    expect(submittalPackageUrl("https://app.meetathena.io/r/job/%20/submittals", "S1", id)).toBeNull();
  });
  it("redirects only to the exact non-revoked, signed package in an authorized job record", () => {
    const pkg = { id: "p1", submittal_id: "s1", revision: 0, filename: "Package.pdf", created_at: TODAY,
      path: `company/${JOB}/packages/p1/Package.pdf`, url: `https://fixture.supabase.co/storage/v1/object/sign/athena-submittals/company/${JOB}/packages/p1/Package.pdf?token=fixture` };
    const record = { page: "submittal", company_id: "company", job_id: JOB, number: "S1", current: row({ id: "s1", number: "S1", revision: 0 }), packages: [pkg] } as SubmittalRecordPayload;
    expect(submittalPackageTarget(record, "p1")).toBe(pkg.url);
    expect(submittalPackageTarget(record, "other-package")).toBeNull();
    expect(submittalPackageTarget({ ...record, packages: [{ ...pkg, revoked_at: TODAY }] }, "p1")).toBeNull();
    expect(submittalPackageTarget({ ...record, job_id: "another-job" }, "p1")).toBeNull();
    expect(submittalPackageTarget({ ...record, packages: [{ ...pkg, url: "https://files.example/wrong.pdf?token=x" }] }, "p1")).toBeNull();
    expect(submittalPackageTarget({ ...record, packages: [{ ...pkg, url: null }] }, "p1")).toBeNull();
  });
  it("signs stored references only inside the authorized company's job across supported buckets", () => {
    const scope = { company_id: "company", job_id: "job" };
    for (const bucket of ["athena-submittals", "athena-files", "athena-drawings"])
      expect(submittalRecordFile(scope, `${bucket}/company/job/pieces/x/source.pdf`)).toMatchObject(
        {
          bucket,
          path: "company/job/pieces/x/source.pdf",
        },
      );
    for (const ref of [
      "athena-submittals/another-company/job/source.pdf",
      "athena-submittals/company/another-job/source.pdf",
      "athena-submittals/company/job/../source.pdf",
      "athena-submittals/company/job/source.pdf?token=other",
      "another-bucket/company/job/source.pdf",
    ])
      expect(submittalRecordFile(scope, ref)).toBeNull();
    expect(submittalRecordFile({}, "athena-submittals/company/job/source.pdf")).toBeNull();
  });
  const payload: SubmittalRecordPayload = {
    page: "submittal",
    company: "Fictional Construction",
    job_id: JOB,
    job_number: "2701",
    job_name: "Harbor <Point>",
    today: TODAY,
    number: "26 24 16-001",
    current: {
      ...row({ id: "s1", number: "26 24 16-001", revision: 1 }),
      package_items: items.map((item, n) => ({
        ...item,
        url: n === 0 ? "https://files.example/cut.pdf?sig=1" : null,
      })),
    },
    revisions: [
      {
        id: "s1",
        revision: 1,
        status: "submitted",
        title: "Fictional switchgear",
        spec_section: "26 24 16",
        transmittal_number: 3,
        submitted_on: "2026-10-01",
        ball_in_court: "architect_engineer",
        created_at: "2026-10-01T00:00:00Z",
      },
      {
        id: "s0",
        revision: 0,
        status: "revise_and_resubmit",
        title: "Fictional switchgear",
        spec_section: "26 24 16",
        transmittal_number: 1,
        submitted_on: "2026-09-01",
        returned_on: "2026-09-20",
        ball_in_court: "gc",
        created_at: "2026-09-01T00:00:00Z",
      },
    ],
    packages: [
      {
        id: "p1",
        submittal_id: "s1",
        revision: 1,
        filename: "Submittal-26-24-16-001-R1-T3.pdf",
        path: "c/j/packages/p1/x.pdf",
        page_count: 12,
        created_at: "2026-10-01T10:00:00Z",
        approved_at: "2026-10-01T11:00:00Z",
        sent_at: "2026-10-01T12:00:00Z",
        expires_at: "2026-10-31T00:00:00Z",
        download_url: "https://app.meetathena.io/r/submittal-file/x",
        url: "https://files.example/package.pdf?sig=2",
      },
    ],
    mail: [
      {
        id: "m1",
        submittal_id: "s1",
        revision: 1,
        kind: "package",
        to: "reviewer@example.com",
        subject: "Job 2701 T-3",
        created_at: "2026-10-01T10:30:00Z",
        approved_at: "2026-10-01T11:00:00Z",
        sent_at: "2026-10-01T12:00:00Z",
        provider: "local-fixture",
        message_id: "synthetic-001",
      },
    ],
    transmittals: [
      {
        id: "t3",
        number: 3,
        revision: 1,
        to_name: "Fictional Reviewer",
        to_email: "reviewer@example.com",
        sent_on: "2026-10-01",
      },
    ],
    events: [
      {
        id: "e2",
        occurred_at: "2026-10-01T12:00:00Z",
        actor: "user",
        actor_name: "Sam",
        mine: false,
        kind: "submittal_sent",
        title: "Sent: 26 24 16-001 revision 1",
        summary: "Email to reviewer@example.com.",
        host: "chatgpt",
        thread_ref: "conv-1",
      },
      {
        id: "e1",
        occurred_at: "2026-10-01T09:00:00Z",
        actor: "user",
        actor_name: "Pat",
        mine: true,
        kind: "submittal_created",
        title: "Submittal 26 24 16-001 revision 1",
        summary: "Fictional switchgear.",
        host: "grokbot",
        thread_ref: null,
      },
    ],
  };

  it("shows pieces by short name, links stored files, lists every package, and names the host of each event", () => {
    const html = renderSubmittalRecordBody(payload);
    expect(html).toContain("Harbor &lt;Point&gt; · Submittal 26 24 16-001");
    expect(html).toContain(`data-submittal-record="26 24 16-001"`);
    expect(html).toContain(`data-overdue="1"`);
    expect(html).toContain(
      "<strong>P1</strong> · Product cut / product data from Fictional Manufacturer · Received",
    );
    expect(html).toContain(`href="https://files.example/cut.pdf?sig=1"`);
    expect(html).toContain("<strong>P2</strong>");
    expect(html).toContain("Chased 2×, last 2026-10-20, next 2026-10-27");
    expect(html).toContain("Not required");
    expect(html).toContain(`href="https://files.example/package.pdf?sig=2"`);
    expect(html).toContain("Sent 2026-10-01");
    expect(html).toContain("Recipient link works until 2026-10-31");
    expect(html).toContain("provider receipt local-fixture synthetic-001");
    expect(html).toContain("by Sam through ChatGPT");
    expect(html).toContain("by Pat through Grok Bot");
    expect(html).not.toContain("Conversation reference on file");
    expect(html).toContain("Revision 0");
    expect(html).toContain(`href="/r/job/${JOB}/submittals"`);
    expect(html).not.toMatch(/supabase|lovable|cloudflare|openai/i);
    // The page palette is the hosted-page one (navy, blue, gray); red appears only because the clock is overdue.
    expect(html).toContain(ALERT_HEX);
  });

  it("keeps red off a record that is not overdue and offers the conversation note only to its owner", () => {
    const calm: SubmittalRecordPayload = {
      ...payload,
      current: { ...payload.current, returned_on: "2026-10-10", status: "approved" },
      events: [{ ...payload.events![0], mine: true }],
    };
    const html = renderSubmittalRecordBody(calm);
    expect(html).toContain(`data-overdue="0"`);
    expect(html).not.toContain(ALERT_HEX);
    expect(html).toContain("Conversation reference on file");
  });

  it("builds the address and signs it with the log token", () => {
    expect(submittalRecordPath(JOB, "26 24 16-001")).toBe(
      `/r/job/${JOB}/submittal/26%2024%2016-001`,
    );
    expect(submittalRecordUrl(BOARD, "26 24 16-001")).toBe(
      `https://app.meetathena.io/r/job/${JOB}/submittal/26%2024%2016-001?t=${TOKEN}`,
    );
    expect(
      submittalRecordUrl(`https://app.meetathena.io/r/job/${JOB}/items?t=${TOKEN}`, "x"),
    ).toBeNull();
    expect(submittalRecordUrl(null, "x")).toBeNull();
    expect(jobLinksMissingToken(submittalRecordUrl(BOARD, "26 24 16-001"))).toEqual([]);
    expect(
      jobLinksMissingToken(`https://app.meetathena.io/r/job/${JOB}/submittal/26%2024%2016-001`),
    ).toHaveLength(1);
  });

  it("returns to the record after sign-in and keeps the token on the log's row links", () => {
    const path = `/r/job/${JOB}/submittal/26%2024%2016-001`;
    expect(boardSignInReturn(`${path}?t=old&utm_source=chatgpt.com#event-1`)).toBe(
      `${path}#event-1`,
    );
    expect(boardReturnForVisit("submittals", JOB, `${path}?t=x`)).toBe(path);
    expect(boardSignInReturn(`/r/job/${JOB}/submittal/`)).toBeUndefined();
    expect(boardSignInReturn(`/r/job/${JOB}/other/thing`)).toBeUndefined();
    const log = renderReportBody({
      page: "submittals",
      job_number: "2701",
      job_name: "Harbor",
      today: TODAY,
      submittals: [row({ id: "s1", number: "26 24 16-001", revision: 1 })],
    });
    expect(log).toContain(`href="submittal/26%2024%2016-001"`);
    expect(signSiblingLinks(log, TOKEN)).toContain(`href="submittal/26%2024%2016-001?t=${TOKEN}"`);
    expect(signSiblingLinks(`<a href="../items">x</a>`, TOKEN)).toContain(
      `href="../items?t=${TOKEN}"`,
    );
  });
});

describe("naming a piece", () => {
  it("accepts the id, the short name, kind from party, or a unique kind or party", () => {
    expect(findPackagePiece(items, items[1].id)?.id).toBe(items[1].id);
    expect(findPackagePiece(items, "P2")?.id).toBe(items[1].id);
    expect(findPackagePiece(items, "p-3")?.id).toBe(items[2].id);
    expect(findPackagePiece(items, "shop drawing from Fictional Sub")?.id).toBe(items[1].id);
    expect(findPackagePiece(items, "shop_drawing from fictional sub")?.id).toBe(items[1].id);
    expect(findPackagePiece(items, "product cut")?.id).toBe(items[0].id);
    expect(findPackagePiece(items, "Fictional Sub")?.id).toBe(items[1].id);
    expect(findPackagePiece(items, "P9")).toBeNull();
    expect(findPackagePiece(items, "")).toBeNull();
    expect(() => findPackagePiece(items, "shop drawing")).toThrow(
      /fits 2 pieces.*P2 shop drawing from Fictional Sub.*P3/,
    );
    expect(() => findPackagePiece(items, "Fictional Manufacturer")).toThrow(/fits 2 pieces/);
  });
});

describe("the host of a call", () => {
  it("maps client names to the three hosts and to their words", () => {
    expect(hostFromClientName("claude-ai")).toBe("claude");
    expect(hostFromClientName("ChatGPT")).toBe("chatgpt");
    expect(hostFromClientName("openai-mcp")).toBe("chatgpt");
    expect(hostFromClientName("Grok")).toBe("grokbot");
    expect(hostFromClientName("curl/8")).toBeNull();
    expect(hostFromClientName(undefined)).toBeNull();
    expect(hostLabel("grokbot")).toBe("Grok Bot");
    expect(hostLabel(null)).toBeNull();
  });
});

describe("a filtered log view", () => {
  const rows = [
    row({ id: "a", number: "001", revision: 0, returned_on: "2026-10-10" }),
    row({ id: "b", number: "002", revision: 0, returned_on: "2026-10-12" }),
    row({ id: "c", number: "003", revision: 0, returned_on: "2026-10-14" }),
  ];
  it("says nothing matches instead of calling the log empty, and matches the full list", () => {
    const full = presentSubmittalLog({
      jobNumber: "2701",
      jobName: "Harbor",
      rows,
      today: TODAY,
      boardUrl: BOARD,
    });
    const overdue = presentSubmittalLog({
      jobNumber: "2701",
      jobName: "Harbor",
      rows,
      today: TODAY,
      boardUrl: BOARD,
      filter: { overdue: true },
    });
    expect(full.rows).toHaveLength(3);
    expect(overdue.rows).toHaveLength(0);
    expect(overdue.text).toContain(
      "No submittals overdue on this job. 3 on the log, none overdue.",
    );
    expect(overdue.text).not.toContain("No submittals on this job yet");
    expect(overdue.card.next_move).toBe("Ask for the full log to see every row.");
    expect(overdue.card.kpis?.find((k) => k.label === "Overdue")?.value).toBe(
      full.card.kpis?.find((k) => k.label === "Overdue")?.value,
    );
    expect(headerMatchesRows(overdue.card)).toBe(true);
    expect(headerMatchesRows(full.card)).toBe(true);
    const late = presentSubmittalLog({
      jobNumber: "2701",
      jobName: "Harbor",
      rows: [...rows, row({ id: "d", number: "004", revision: 0 })],
      today: TODAY,
      boardUrl: BOARD,
      filter: { overdue: true },
    });
    expect(late.rows.map((r) => r.id)).toEqual(["d"]);
    expect(late.rows.every((r) => full.rows.concat(late.rows).some((f) => f.id === r.id))).toBe(
      true,
    );
    const empty = presentSubmittalLog({
      jobNumber: "2701",
      jobName: "Harbor",
      rows: [],
      today: TODAY,
      boardUrl: null,
      filter: { overdue: true },
    });
    expect(empty.text).toContain("No submittals on this job yet");
  });

  it("links every row to its record and lists the saved submittal's pieces with short names and ids", () => {
    const withPieces = [row({ id: "a", number: "001", revision: 0, package_items: items })];
    const shown = presentSubmittalLog({
      jobNumber: "2701",
      jobName: "Harbor",
      rows: withPieces,
      today: TODAY,
      boardUrl: BOARD,
      focusId: "a",
    });
    const log = shown.card.sections?.find((s) => s.heading === "Log");
    expect(log?.rows[0].href).toBe(
      `https://app.meetathena.io/r/job/${JOB}/submittal/001?t=${TOKEN}`,
    );
    const pieces = shown.card.sections?.find((s) => s.heading === "Package pieces for 001");
    expect(pieces?.rows.map((r) => r.cells[0])).toEqual(["P1", "P2", "P3"]);
    expect(pieces?.rows[0].refId).toBe(items[0].id);
    expect(shown.text).toContain(
      `P2. Shop drawing from Fictional Sub. Needed. No stored file yet. Contact Sub Sam Sample sam@example.com. Piece id ${items[1].id}.`,
    );
    expect(shown.card.next_move).toContain("short name");
  });
});
