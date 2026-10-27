import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AthenaStartTip } from "@/components/athena/start-tip";
import {
  COST_CODE_ASK,
  DOCUMENT_ASK,
  START_BACKUP,
  START_EXAMPLES,
  START_HEADLINE,
} from "../athena-start-copy";
import { paletteViolations } from "./cards/palette";
import { renderHtml } from "./cards/html";
import { cardWidgetHtml } from "./cards/widget";
import { visibleProblems } from "./visible";
import {
  GETTING_STARTED_GUIDANCE,
  GETTING_STARTED_RULE,
  attachGettingStarted,
  branchGettingStarted,
  claimGettingStarted,
  firstJobCard,
  firstJobGuidance,
  gettingStartedCard,
  memberJobs,
  plainGettingStarted,
  renderGettingStarted,
  sourceGuidanceCard,
  startedWithJobsCard,
} from "./getting-started";

const rpc = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());
const fixture = vi.hoisted(() => ({
  companies: [] as { id: string; name?: string }[],
  jobs: [] as { job_number: string; name: string | null; company_id?: string }[],
}));
vi.mock("./supabase", () => ({ supabaseForUser: () => ({ rpc, from }) }));
import { run } from "./guard";
import { gettingStarted } from "./tools/getting-started-tool";
const ctx = { isAuthenticated: () => true, getToken: () => "t" } as never;
function jobsDb() {
  return {
    from(table: string) {
      const rows = table === "mcp_companies" ? fixture.companies : fixture.jobs;
      const done = Promise.resolve({ data: rows, error: null });
      return {
        select: () => ({ in: () => done, then: done.then.bind(done) }),
        insert: vi.fn(() => {
          throw new Error("Onboarding must not insert records");
        }),
      };
    },
  };
}
function gate(extra: (fn: string) => unknown = () => undefined) {
  return async (fn: string) => {
    if (fn === "mcp_abuse_cap_check" || fn === "mcp_security_touch")
      return { data: { ok: true }, error: null };
    if (fn === "mcp_gate") return { data: true, error: null };
    if (fn === "mcp_session_touch") return { data: false, error: null };
    return extra(fn) ?? { data: null, error: null };
  };
}
beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(gate());
  fixture.companies = [];
  fixture.jobs = [];
  from.mockReset();
  from.mockImplementation(jobsDb().from);
});
type Result = {
  content: { text: string }[];
  structuredContent: {
    card: ReturnType<typeof firstJobCard>;
    getting_started?: unknown;
    assistant_guidance?: string[];
    branch?: string;
    focus?: string;
    html?: string;
  };
};
const shown = (result: Result) => plainGettingStarted(result.structuredContent.card);

describe("first use and returning jobs", () => {
  it("gives a no-company user a concrete choice, without saving a company or duplicating the introduction", async () => {
    const result = (await gettingStarted.handler({ focus: undefined }, ctx)) as unknown as Result;
    expect(result.structuredContent.branch).toBe("first_job");
    expect(shown(result)).toContain("your company name");
    expect(shown(result)).toContain("No saved jobs yet");
    expect(shown(result)).toContain(COST_CODE_ASK);
    expect(shown(result)).toContain("without all the documents");
    expect(result.structuredContent.getting_started).toBeUndefined();
    expect(result.content[0].text.match(/<!doctype html>/g)).toHaveLength(1);
    expect(result.structuredContent.card.ask).toBeUndefined();
    expect(rpc.mock.calls.map(([name]) => name)).not.toEqual(
      expect.arrayContaining(["mcp_company_save", "mcp_job_create", "mcp_intake", "mcp_reset_job"]),
    );
  });
  it("starts from the job number and name when a company already exists", async () => {
    fixture.companies = [{ id: "c1", name: "Fictional Builder" }];
    const result = (await gettingStarted.handler({ focus: undefined }, ctx)) as unknown as Result;
    expect(shown(result)).toContain("job number and name");
    expect(shown(result)).not.toContain("your company name");
    expect(firstJobGuidance(true)).toContain("explicit request");
    expect(firstJobGuidance(false)).toContain("save_company");
  });
  it("shows the actual saved job before suggestions and resumes it safely on repeated entry", async () => {
    fixture.companies = [{ id: "c1", name: "Fictional Builder" }];
    fixture.jobs = [{ job_number: "QA-1", name: "Harbor Renovation", company_id: "c1" }];
    const before = structuredClone(fixture);
    for (let n = 0; n < 3; n++) {
      const result = (await gettingStarted.handler({ focus: undefined }, ctx)) as unknown as Result;
      const text = shown(result);
      expect(result.structuredContent.branch).toBe("resume");
      expect(text).toContain("QA-1 · Harbor Renovation · Fictional Builder");
      expect(text.indexOf("Harbor Renovation")).toBeLessThan(text.indexOf("Try asking"));
      expect(text).toContain("What needs attention on job QA-1?");
      expect(text).not.toContain("Let's set up your first job");
      expect(result.structuredContent.getting_started).toBeUndefined();
    }
    expect(fixture).toEqual(before);
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("mcp_job_create");
  });
  it("retains company context for duplicate job numbers and limits the first view without hiding the full list route", async () => {
    fixture.companies = [
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta" },
    ];
    fixture.jobs = Array.from({ length: 7 }, (_, i) => ({
      job_number: "100",
      name: `Job ${i}`,
      company_id: i % 2 ? "b" : "a",
    }));
    const found = await memberJobs(jobsDb() as never);
    const text = plainGettingStarted(startedWithJobsCard(found.jobs));
    expect(text).toContain("Alpha");
    expect(text).toContain("Beta");
    expect(text).toContain("2 more saved jobs");
    expect(text).toContain("show my job list");
    expect(GETTING_STARTED_GUIDANCE).toContain("ask if ambiguous");
  });
  it("never calls the morning meeting from entry, and supports back/cancel as navigation", async () => {
    fixture.companies = [{ id: "c1" }];
    fixture.jobs = [{ job_number: "QA-1", name: "Harbor" }];
    const morning = vi.fn();
    await branchGettingStarted(jobsDb() as never, morning, firstJobCard);
    expect(morning).not.toHaveBeenCalled();
    expect(GETTING_STARTED_GUIDANCE).toContain("On back or cancel, stop the pending setup");
    expect(GETTING_STARTED_GUIDANCE).toContain(
      "resume a matching record rather than create a duplicate",
    );
    expect(plainGettingStarted(startedWithJobsCard(fixture.jobs))).toContain(
      "“cancel” to stop setup",
    );
  });
});

describe("existing documents and company cost codes", () => {
  it.each(["documents", "cost_codes"] as const)(
    "opens %s guidance through the actual tool without importing anything",
    async (focus) => {
      fixture.companies = [{ id: "c1" }];
      fixture.jobs = [{ job_number: "QA-1", name: "Harbor" }];
      const result = (await gettingStarted.handler({ focus }, ctx)) as unknown as Result;
      expect(result.structuredContent.focus).toBe(focus);
      expect(shown(result)).toContain("Already supplied it?");
      expect(shown(result)).toContain("Not ready yet?");
      expect(shown(result)).toContain(focus === "documents" ? DOCUMENT_ASK : COST_CODE_ASK);
      expect(shown(result)).toContain("only when this host provides that access");
      expect(rpc.mock.calls.map(([name]) => name)).not.toContain("mcp_file_upload_begin");
    },
  );
  it("names the current private picker and source retrieval path, with no added extraction approval", () => {
    const text = plainGettingStarted(sourceGuidanceCard("documents", { company: true, jobs: [] }));
    expect(text).toContain("private upload link with a file picker");
    expect(text).toContain("list, read or search saved contracts");
    expect(GETTING_STARTED_GUIDANCE).toContain("file_upload begin");
    expect(GETTING_STARTED_GUIDANCE).toContain("project_documents list/read/search");
    expect(GETTING_STARTED_GUIDANCE).toContain("without an extra approval step");
    expect(GETTING_STARTED_GUIDANCE).toContain("Do not retry a denied download");
    expect(GETTING_STARTED_GUIDANCE).toContain(
      "never say missing merely because onboarding has not checked",
    );
  });
  it("asks about cost-code ownership without promising an import or account mapping", () => {
    const text = plainGettingStarted(sourceGuidanceCard("cost_codes", { company: true, jobs: [] }));
    expect(text).toContain("paste the codes and descriptions");
    expect(text).toContain("does not automatically import a company code library");
    expect(text).toContain("where is the current list");
    expect(GETTING_STARTED_GUIDANCE).toContain(
      "only for an explicitly requested job budget/SOV save",
    );
  });
  it("describes real available tasks without executing the suggestions", () => {
    expect(GETTING_STARTED_GUIDANCE).toContain("show job list -> jobs_list");
    expect(GETTING_STARTED_GUIDANCE).toContain("what needs attention -> list_open_items");
    expect(GETTING_STARTED_GUIDANCE).toContain(
      "Do not call them merely because they appear on this card",
    );
    expect(GETTING_STARTED_RULE).not.toContain("start every message with @Athena");
    expect(START_BACKUP).toContain("If your host does not use Athena");
    expect(GETTING_STARTED_GUIDANCE).toContain("guaranteed host routing");
  });
});

describe("first-run attachment preserves the requested result", () => {
  it("claims once, leaves an existing tool's facts intact and does not force a memory question", async () => {
    let seen = false;
    rpc.mockImplementation(
      gate((fn) =>
        fn === "mcp_getting_started_claim"
          ? { data: { show: !seen && (seen = true) }, error: null }
          : undefined,
      ),
    );
    const action = () =>
      run("report", ctx, {}, async () => ({
        content: [{ type: "text", text: "QA-1 saved report facts" }],
      }));
    const first = (await action()) as unknown as Result;
    expect(first.content[0].text).toContain("QA-1 saved report facts");
    expect(first.structuredContent.getting_started).toMatchObject({ title: START_HEADLINE });
    expect(first.content[0].text).not.toContain("Save this line");
    const second = (await action()) as unknown as Result;
    expect(second.structuredContent?.getting_started).toBeUndefined();
    expect(second.content[0].text).toContain("QA-1 saved report facts");
  });
  it("keeps a card-first result's text and fails open when the first-run claim is unavailable", async () => {
    const result = {
      content: [{ type: "text", text: "Requested result" }],
      structuredContent: { stage: "progress" },
    };
    const attached = await attachGettingStarted(
      { rpc: async () => ({ data: { show: true }, error: null }) },
      result,
      { prepend: false },
    );
    expect(attached.content).toEqual(result.content);
    expect(attached.structuredContent.stage).toBe("progress");
    expect(
      await claimGettingStarted({
        rpc: async () => {
          throw new Error("Unavailable");
        },
      }),
    ).toBe(false);
    expect(
      await attachGettingStarted(
        { rpc: async () => ({ data: null, error: { message: "missing" } }) },
        result,
      ),
    ).toBe(result);
  });
});

describe("scoped visual presentation and ChatGPT rendering", () => {
  it("paints the real contextual card in the ChatGPT widget with no duplicate start card", async () => {
    fixture.companies = [{ id: "c1" }];
    fixture.jobs = [{ job_number: "QA-1", name: "Harbor" }];
    const result = (await gettingStarted.handler({ focus: undefined }, ctx)) as unknown as Result;
    const app = { dataset: {} as Record<string, string>, innerHTML: "" };
    const widget = cardWidgetHtml();
    const script = widget.match(/<script>([\s\S]*)<\/script>/)![1];
    runInNewContext(script, {
      document: { getElementById: () => app },
      window: { openai: { toolOutput: result.structuredContent }, addEventListener: vi.fn() },
    });
    expect(app.innerHTML).toContain('data-presentation="onboarding"');
    expect(app.innerHTML).toContain("Harbor");
    expect(app.innerHTML.match(/<article /g)).toHaveLength(1);
    expect(app.dataset.painted).toBe("1");
  });
  it("keeps light navy/blue/gray styling local to onboarding and contains no invented metrics", () => {
    for (const card of [
      gettingStartedCard(),
      firstJobCard(false),
      firstJobCard(true),
      startedWithJobsCard([{ job_number: "QA-1", name: "Harbor" }]),
    ]) {
      const html = renderHtml(card);
      expect(html).toContain('data-presentation="onboarding"');
      expect(paletteViolations(html, false)).toEqual([]);
      expect(visibleProblems(renderGettingStarted(card))).toEqual([]);
      expect(card.kpis).toBeUndefined();
      expect(card.alerts).toBeUndefined();
    }
    const normal = renderHtml({ state: "result", title: "Existing card" });
    expect(normal).not.toContain("data-presentation");
    expect(normal).not.toContain("letter-spacing:-.025em");
  });
  it("keeps connection handoff compact with optional details and the same useful asks", () => {
    const html = renderToStaticMarkup(React.createElement(AthenaStartTip)).replace(/&#x27;/g, "'");
    expect(html).toContain(START_HEADLINE);
    for (const ask of START_EXAMPLES) expect(html).toContain(ask);
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).not.toContain("<details open");
    expect(html).toContain("does not guarantee routing");
    expect(html).not.toContain("Start every message with @Athena");
    expect(paletteViolations(html, false)).toEqual([]);
    for (const path of ["src/routes/account.tsx", "src/routes/oauth.consent.tsx"])
      expect(readFileSync(path, "utf8")).toContain("<AthenaStartTip />");
  });
});
