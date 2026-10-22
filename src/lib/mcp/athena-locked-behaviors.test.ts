import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { athenaEmailCode, ATHENA_SIGN_IN_CODE_LENGTH } from "@/lib/athena-code-sign-in";
import { START_HOSTS } from "@/lib/athena-start-copy";
import { consentClientLabel } from "@/lib/consent-client-label";
import { lovableAuthRedirectTarget } from "@/lib/lovable-auth-redirect";
import { renderReportBody } from "@/lib/report-pages";
import { siteIconResponse } from "@/lib/site-icons";
import { openQuestion, reviewEstimatorLine } from "./estimating-method";
import { draftCardText, confirmQuestion } from "./email-safety";
import { GREETING_RULE } from "./greeting";
import { visibleLookaheads } from "./lookahead-items";
import { CPM_GANTT_SPEC } from "./living";
import { buildMorningBrief, CALENDAR_CONNECT_LINE, INBOX_PLACEHOLDER, INBOX_SECTION, type BriefJob } from "./morning-brief";
import { morningCardIsDue } from "./morning-brief-card";
import { stripDirectiveText } from "./result-directives";
import { ATHENA_SERVER_ICONS } from "./server-info-branding";
import { lookaheadView } from "./styled-views";
import { buildFieldPayApp, payAppCard } from "./superintendent";
import { athenaHello, morningBrief } from "./tools/morning-brief-tools";
import { lookaheadListLead } from "./tools/workflow-tools";
import { EMAIL_DRAFT_ARTIFACT_LINE, EMAIL_DRAFT_VIEW_SPEC } from "./views";
import { attachAthenaCard } from "./cards/attach";
import { drawingMarkupCard } from "./drawing-markup";
import { renderHtml } from "./cards/html";
import { inferCard } from "./cards/infer";
import { renderMarkdown } from "./cards/markdown";
import { BLUE, paletteViolations } from "./cards/palette";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!path.endsWith(".ts") && !path.endsWith(".tsx")) return [];
    if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return [];
    return [path];
  });
}

const JOB: BriefJob = {
  job_id: "j1",
  job_number: "2701",
  name: "Harbor Point",
  company_id: "c1",
  time_zone: "America/Chicago",
  scope: "full",
  seat: "pm",
  activities: [],
  items: [],
  lookahead: { start: "2026-10-26", end: "2026-11-06" },
  payApps: [],
  invoices: [],
  links: {},
};

describe("locked behaviors", () => {
  it("has no template key in Athena source, so the A icon holds", () => {
    const hits = sourceFiles("src").filter((path) => readFileSync(path, "utf8").includes("openai/outputTemplate"));
    expect(hits).toEqual([]);
    expect(ATHENA_SERVER_ICONS.map((icon) => icon.src)).toEqual([
      "https://app.meetathena.io/brand/athena/athena-mono-blue-64.png",
      "https://app.meetathena.io/brand/athena/athena-mono-blue-128.png",
      "https://app.meetathena.io/brand/athena/athena-mono-blue-256.png",
    ]);
  });

  it("serves the Athena favicon", async () => {
    const fav = siteIconResponse(new Request("https://app.meetathena.io/favicon.ico"))!;
    expect(fav.status).toBe(200);
    expect(fav.headers.get("content-type")).toBe("image/x-icon");
    const png = siteIconResponse(new Request("https://app.meetathena.io/brand/athena/athena-mono-blue-64.png"))!;
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
  });

  it("signs Athena in with an emailed 8-digit code", () => {
    expect(ATHENA_SIGN_IN_CODE_LENGTH).toBe(8);
    expect(athenaEmailCode("12345678")).toBe("12345678");
    expect(athenaEmailCode("1234567")).toBeNull();
    const login = readFileSync("src/routes/login.tsx", "utf8");
    const athenaAt = login.indexOf("if (athenaBrand)");
    const magicAt = login.indexOf("Email me a secure sign-in link");
    expect(athenaAt).toBeGreaterThan(0);
    expect(magicAt).toBeGreaterThan(athenaAt);
    const athenaForm = login.slice(athenaAt, magicAt);
    expect(athenaForm).toContain('data-signin="email-code"');
    expect(athenaForm).toContain('label="8-digit code"');
    expect(athenaForm).not.toMatch(/magic link/i);
  });

  it("sends lovable.app oauth, and a consent login, to app.meetathena.io", () => {
    expect(
      lovableAuthRedirectTarget({
        hostname: "contractor-command.lovable.app",
        pathname: "/oauth/consent",
        search: "?authorization_id=auth_req_abc",
      }),
    ).toBe("https://app.meetathena.io/oauth/consent?authorization_id=auth_req_abc");
    expect(
      lovableAuthRedirectTarget({
        hostname: "contractor-command.lovable.app",
        pathname: "/login",
        search: "?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc",
      }),
    ).toBe("https://app.meetathena.io/login?redirect=%2Foauth%2Fconsent%3Fauthorization_id%3Dabc");
    expect(
      lovableAuthRedirectTarget({
        hostname: "contractor-command.lovable.app",
        pathname: "/login",
        search: "",
      }),
    ).toBeNull();
  });

  it("strips imperative render text and keeps the member's lines", () => {
    const out = stripDirectiveText("REQUIRED VIEW: render this card.\n1. Draw it again.\n\nHarbor Point\n1. Marshall, Owner, all jobs");
    expect(out).not.toMatch(/REQUIRED VIEW|REQUIRED:|do not add text/i);
    expect(out).toContain("Harbor Point");
    expect(out).toContain("1. Marshall, Owner, all jobs");
  });

  it("uses red only for risk, delay, or overdue, and keeps the #1E5FED mark", () => {
    expect(BLUE).toBe("#1E5FED");
    expect(paletteViolations("#DC2626", false).length).toBeGreaterThan(0);
    expect(paletteViolations("#DC2626", true)).toEqual([]);
    expect(paletteViolations("#1E5FED", false)).toEqual([]);
    expect(renderHtml({ state: "result", title: "Open items", sections: [] })).not.toContain("#DC2626");
    expect(renderHtml({ state: "result", title: "Open items", alerts: [{ level: "overdue", text: "1 overdue" }] })).toContain("#DC2626");
    expect(CPM_GANTT_SPEC.join("\n")).toContain("solid blue #1E5FED");
    expect(CPM_GANTT_SPEC.join("\n")).toContain("the callout color is only for delays, risks and overdue items");
  });

  it("lists every SOV line and its scheduled value on the pay app and the report card", () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({
      item_no: `26.${String(i + 1).padStart(2, "0")}`,
      description: `Line ${i + 1}`,
      scheduled_value: 140_000,
    }));
    const app = buildFieldPayApp(lines, 0, 5, [{ item_no: "26.01", pct: 10 }], []);
    expect(app.rows).toHaveLength(10);
    const shown = stripDirectiveText(payAppCard("2701 – Harbor ", "2026-10-21", app));
    expect(shown).not.toMatch(/^REQUIRED:/m);
    for (const row of app.rows) {
      expect(shown).toContain(`${row.item_no} ${row.description}: scheduled $140,000.00`);
    }
    const card = inferCard("report", "2701 – Schedule of values", {
      sov: {
        line_items: lines.map((row, i) => ({
          item_no: row.item_no,
          cost_code: `26-0${i + 1}`,
          description: row.description,
          scheduled_value_display: "$140,000.00",
        })),
      },
    });
    expect(card.sections?.[0].rows).toHaveLength(10);
    expect(card.sections?.[0].rows?.map((row) => row.cells[0])).toEqual(lines.map((row) => row.item_no));
    expect(card.sections?.[0].rows?.every((row) => row.cells[3] === "$140,000.00")).toBe(true);
  });

  it("asks Which job? on a card when the job is unnamed", () => {
    const out = attachAthenaCard("list_open_items", {
      content: [{ type: "text", text: "No job named. Your companies and jobs:\n- Harbor Electric: 2701 (Harbor Point)\nWhich job should I list open items for?" }],
    }) as { content: { text: string }[]; structuredContent: { card: { title: string; state: string }; which_job?: boolean } };
    expect(out.structuredContent.card.title).toBe("Which job?");
    expect(out.structuredContent.card.state).toBe("ask");
    expect(out.structuredContent.which_job).toBe(true);
    expect(out.content[0].text).toContain("## 🔵 Which job?");
    expect(out.content[0].text).not.toMatch(/REQUIRED VIEW|do not add text/i);
  });

  it("returns the full morning brief every time, with no once-a-day lockout on the ask", () => {
    const first = buildMorningBrief({ jobs: [JOB], hasCompany: true, now: new Date("2026-10-22T15:00:00Z") });
    const again = buildMorningBrief({ jobs: [JOB], hasCompany: true, now: new Date("2026-10-22T18:00:00Z") });
    for (const built of [first, again]) {
      expect(built.card.sections?.some((section) => section.heading === INBOX_SECTION)).toBe(true);
      expect(renderMarkdown(built.card)).toContain(INBOX_PLACEHOLDER);
      expect(renderMarkdown(built.card)).toContain(CALENDAR_CONNECT_LINE);
      expect(renderMarkdown(built.card)).not.toMatch(/^Hidden$/m);
    }
    expect(morningCardIsDue({ enabled: true, send_local: "06:30", local_date: "2026-10-22", local_minutes: 900, already_shown: true })).toBe(false);
    const instructions = readFileSync("src/lib/mcp/index.ts", "utf8");
    expect(instructions).toContain("That once-a-day limit is the proactive card only.");
    expect(instructions).toContain("build and return the full brief every time");
    expect(morningBrief.description).toMatch(/every time they ask/i);
    expect(athenaHello.description).toMatch(/every time the user asks/i);
  });

  it("routes Hey Athena to Athena and names Grok Bot", () => {
    expect(GREETING_RULE).toContain("Hey Athena");
    expect(GREETING_RULE).toContain("athena_hello");
    expect(athenaHello.description).toContain("Hey Athena");
    const instructions = readFileSync("src/lib/mcp/index.ts", "utf8");
    expect(instructions).toContain("Hey Athena");
    expect(instructions).toContain("call athena_hello or morning_brief");
    expect(START_HOSTS).toBe("ChatGPT, Claude and Grok Bot");
    expect(consentClientLabel({ name: "Grok" })).toBe("Grok Bot");
  });

  it("omits the Hidden line, keeps lookahead data, and still lets the Gantt pan", () => {
    expect(lookaheadListLead("2701", [{ items: 2 }, { items: 0 }])).toBe("Job 2701 has 2 lookaheads (1 with content, 1 empty).");
    expect(lookaheadListLead("2701", [{ items: 2 }, { items: 0 }])).not.toContain("Hidden");
    const visible = visibleLookaheads([
      { id: "setup", inputs: { kind: "setup" } },
      { id: "merged", inputs: { kind: "merged", merged_into: "content" } },
      { id: "content", inputs: { crews: "electric" } },
    ]);
    expect(visible.map((row) => row.id)).toEqual(["content"]);
    const view = lookaheadView({
      title: "2701",
      ref: "LA-31BE8",
      start: "2026-10-26",
      end: "2026-11-06",
      dataDate: "2026-10-19",
      acts: [{ id: "A1100", name: "Underground plumbing", start: "2026-10-26", finish: "2026-10-30", duration: 5, total_float: 0 }],
      items: [{ action: "Confirm the inspection", owner: "Sam", due: "2026-10-30" }],
    });
    const stripped = stripDirectiveText(view);
    expect(stripped).toContain("**Window:**");
    expect(stripped).toContain("Oct 26, 2026");
    expect(stripped).toContain("**Data date:**");
    expect(stripped).toContain("LA-31BE8");
    expect(stripped).toContain("Underground plumbing");
    expect(stripped).toContain("Confirm the inspection");
    expect(stripped).not.toMatch(/REQUIRED VIEW|do not add text/i);
    const chart = renderReportBody({
      page: "schedule",
      job_number: "2701",
      job_name: "Harbor Point",
      report: {
        found: true,
        data: { activities: [{ id: "A1000", name: "Slab", start: "2026-11-02", finish: "2026-11-06", total_float: 4, critical: false }] },
      },
    });
    expect(chart).toContain("overflow-x:auto");
    expect(chart).toContain("Slab");
    expect(chart).not.toContain("Delay: +");
  });

  it("colors a normal drawing markup callout blue inside the card", () => {
    const card = drawingMarkupCard({ sheet: "S-100", callouts: [{ label: "Grid A" }] });
    expect(card.html).toContain("#1E5FED");
    expect(card.html).not.toContain("#DC2626");
    expect(card.html).toContain("<article class=\"card\"");
    expect(card.html).toContain("<svg");
    expect(card.html.trim().startsWith("<svg")).toBe(false);
    const doc = readFileSync("docs/athena-locked-behaviors.md", "utf8");
    expect(doc).toContain("Drawing markup callouts default to navy `#1E5FED`");
  });

  it("keeps the S-100 drawing markup findings", () => {
    const dowels = openQuestion({
      item: "#4 dowels under S-100 note 10",
      sheet: "S-100",
      detail: "note 10",
      unit: "EA",
      reasoning: "Note 10 names the joints and corners but does not locate or count the dowels.",
      estimatorQty: 12,
    });
    expect(dowels).toEqual({
      title: "OPEN QUESTION: #4 dowels under S-100 note 10",
      sheet: "S-100",
      detail: "note 10",
      low: null,
      high: null,
      unit: "EA",
      qty: null,
      reasoning:
        "Note 10 names the joints and corners but does not locate or count the dowels. The drawings do not state a low or a high, so the range stays open. Sheet S-100 note 10. The estimator's figure is not used.",
    });
    const review = reviewEstimatorLine({
      item: "Formwork for Fiber-Reinforced Slab-on-Grade Additive",
      qty: 87,
      unit: "SFCA",
      note: '[Generated] Edge forms: est. 263 LF perimeter × 4" thick = 87 SFCA',
      sheet: "S-100",
    });
    expect(review.kind).toBe("explained");
  });

  it("keeps the red delay banner on a fragnet Gantt and the To: line on the email draft", () => {
    const chart = renderReportBody({
      page: "schedule",
      job_number: "2701",
      job_name: "Harbor Point",
      report: {
        found: true,
        contract_completion_date: "2027-06-04",
        data: {
          activities: [
            { id: "A1000", name: "Slab", start: "2026-11-02", finish: "2026-11-06", total_float: 4, critical: false },
            { id: "FRAG-01", name: "Weather fragnet", start: "2026-11-27", finish: "2026-12-17", total_float: 0, critical: true },
          ],
          tia: { fragnet: "FRAG-01", prior_completion: "2027-06-04", updated_completion: "2027-06-25" },
        },
      },
    });
    expect(chart).toContain("overflow-x:auto");
    expect(chart).toContain("Delay: +");
    expect(chart).toContain("WD");
    expect(chart).toContain("CD");
    expect(chart).toContain("#DC2626");
    expect(chart).toContain("Delay fragnet FRAG-01");
    const draft = {
      to: "pm@example.test",
      cc: [] as string[],
      subject: "2701 two-week lookahead",
      body: "Download the lookahead PDF.",
    };
    const raw = [EMAIL_DRAFT_ARTIFACT_LINE, "", draftCardText(draft), "", ...EMAIL_DRAFT_VIEW_SPEC, "", `Confirm question: ${confirmQuestion(draft)}`].join("\n");
    const stripped = stripDirectiveText(raw);
    expect(stripped.startsWith("To: pm@example.test")).toBe(true);
    expect(stripped).toContain("Subject: 2701 two-week lookahead");
    expect(stripped).toContain("Download the lookahead PDF.");
    expect(stripped).toContain("Confirm question: Send this email to pm@example.test");
    expect(stripped).not.toMatch(/REQUIRED VIEW|do not add text/i);
  });
});
