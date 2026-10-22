import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { START_AT_EXAMPLES, START_BACKUP, START_CONNECTOR_MEMORY, START_EXAMPLES, START_HEADLINE, START_MEMORY_OFFER, START_POINTS } from "../athena-start-copy";
import { AthenaStartTip } from "@/components/athena/start-tip";
import { paletteViolations } from "./cards/palette";
import { renderHtml } from "./cards/html";
import { cardWidgetHtml } from "./cards/widget";
import { visibleProblems } from "./visible";
import {
  GETTING_STARTED_RULE,
  attachGettingStarted,
  branchGettingStarted,
  claimGettingStarted,
  firstJobCard,
  firstJobGuidance,
  gettingStartedCard,
  renderGettingStarted,
  startedWithJobsCard,
} from "./getting-started";
const rpc = vi.hoisted(() => vi.fn());
const jobsFixture = vi.hoisted(() => ({
  companies: [] as { id: string }[],
  jobs: [] as { job_number: string; name: string | null }[],
}));
vi.mock("./supabase", () => ({
  supabaseForUser: () => ({
    rpc,
    from: (table: string) => {
      const rows = table === "mcp_companies" ? jobsFixture.companies : table === "mcp_jobs" ? jobsFixture.jobs : [];
      const done = Promise.resolve({ data: rows, error: null });
      const builder = { in: () => done, then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => done.then(ok, bad) };
      return { select: () => builder, insert: async () => ({ error: null }) };
    },
  }),
}));

import { run } from "./guard";
import { gettingStarted } from "./tools/getting-started-tool";

const ctx = { isAuthenticated: () => true, getToken: () => "t" } as never;

function gate(extra: (fn: string) => { data: unknown; error: unknown } | undefined) {
  return async (fn: string) => {
    if (fn === "mcp_abuse_cap_check") return { data: { ok: true }, error: null };
    if (fn === "mcp_gate") return { data: true, error: null };
    if (fn === "mcp_session_touch") return { data: false, error: null };
    if (fn === "mcp_security_touch") return { data: { ok: true, canary: null }, error: null };
    return extra(fn) ?? { data: null, error: null };
  };
}

describe("getting started card", () => {
  const card = gettingStartedCard();
  const html = renderHtml(card);
  const shown = renderGettingStarted(card);

  it("leads with Hey Athena, then the backup @Athena, and gives real asks", () => {
    expect(card.title).toBe(START_HEADLINE);
    expect(card.title).toBe("Hey Athena, let's get started");
    expect(shown.indexOf(START_HEADLINE)).toBeLessThan(shown.indexOf(START_EXAMPLES[0]));
    expect(shown.indexOf(START_EXAMPLES[0])).toBeLessThan(shown.indexOf(START_BACKUP));
    expect(START_BACKUP).toContain("@Athena");
    expect(START_BACKUP).toContain("instead of the general AI");
    expect(START_POINTS).toEqual([
      "The same Athena knows your jobs wherever you open her, in ChatGPT, Claude and Grok Bot.",
      "Your work lives on Athena's servers.",
      "Every job has its own dashboard and boards that stay up to date.",
    ]);
    for (const line of START_POINTS) expect(shown).toContain(line);
    expect(START_EXAMPLES).toHaveLength(6);
    for (const ask of START_EXAMPLES) {
      expect(ask.startsWith("Hey Athena, ")).toBe(true);
      expect(shown).toContain(ask);
      expect(html).toContain(ask);
    }
    expect(shown).toContain("Hey Athena, run my PM meeting");
    expect(shown).not.toContain("2701");
    expect(html).not.toContain("2701");
    expect(html).not.toContain('class="eyebrow"');
    expect(html).not.toContain(">Result<");
    expect(shown).not.toContain("**Result**");
    expect(shown).toContain("ChatGPT, Claude and Grok Bot");
    expect(shown).not.toMatch(/ChatGPT and Claude|ChatGPT or Claude/);
    const plain = shown.split("REQUIRED VIEW:")[0];
    expect(plain.trimStart().startsWith(START_HEADLINE)).toBe(true);
    expect(plain).not.toContain("🔵");
    expect(plain).not.toContain("<h1");
    for (const ask of START_EXAMPLES) expect(plain.indexOf(ask)).toBeGreaterThan(plain.indexOf(START_HEADLINE));
    expect(plain.indexOf(START_BACKUP)).toBeGreaterThan(plain.indexOf(START_EXAMPLES[0]));
    expect(shown).not.toMatch(/\bpermanent\b/i);
    expect(html).not.toMatch(/\bpermanent\b/i);
  });

  it("stays on the card palette, with no alert red and no vendor names", () => {
    expect(paletteViolations(html, false)).toEqual([]);
    expect(paletteViolations(shown, false)).toEqual([]);
    expect(html).not.toMatch(/#DC2626|red|lovable|supabase/i);
    expect(shown).not.toMatch(/lovable|supabase/i);
    expect(visibleProblems(shown)).toEqual([]);
    expect(card.alerts ?? []).toEqual([]);
  });

  it("is painted by the card widget above the tool card", () => {
    const widget = cardWidgetHtml();
    expect(widget).toContain("output.getting_started");
    expect(widget).toContain("function paint");
    expect(widget).toContain('level==="risk"||level==="delay"||level==="overdue"');
    expect(paletteViolations(widget, true)).toEqual([]);
  });
});

describe("first tool call", () => {
  beforeEach(() => {
    rpc.mockReset();
    jobsFixture.companies = [];
    jobsFixture.jobs = [];
  });

  it("shows the card once, then stays quiet", async () => {
    let seen = false;
    rpc.mockImplementation(
      gate((fn) => {
        if (fn !== "mcp_getting_started_claim") return undefined;
        if (seen) return { data: { show: false }, error: null };
        seen = true;
        return { data: { show: true }, error: null };
      }),
    );
    const first = (await run("report", ctx, { jobNumber: "2701" }, async () => ({
      content: [{ type: "text" as const, text: "Job 2701 is open." }],
    }))) as { content: { text: string }[]; structuredContent: { getting_started: { title: string } } };
    expect(first.content[0].text.startsWith(START_HEADLINE)).toBe(true);
    expect(first.content[0].text).toContain("Job 2701 is open.");
    expect(first.content[0].text.indexOf(START_HEADLINE)).toBeLessThan(first.content[0].text.indexOf("Job 2701 is open."));
    const lead = first.content[0].text.slice(0, first.content[0].text.indexOf("Job 2701 is open."));
    expect(lead).toContain("Hey Athena, run my PM meeting");
    expect(lead).toContain("ChatGPT, Claude and Grok Bot");
    expect(lead.split("REQUIRED VIEW:")[0]).not.toContain("🔵");
    expect(first.structuredContent.getting_started.title).toBe(START_HEADLINE);

    const second = (await run("report", ctx, { jobNumber: "2701" }, async () => ({
      content: [{ type: "text" as const, text: "Job 2701 is open." }],
    }))) as { content: { text: string }[]; structuredContent?: { getting_started?: unknown } };
    expect(second.content[0].text).not.toContain(START_HEADLINE);
    expect(second.structuredContent?.getting_started).toBeUndefined();
  });

  it("keeps a meeting reply's text and still carries the card for the widget", async () => {
    rpc.mockImplementation(gate((fn) => (fn === "mcp_getting_started_claim" ? { data: { show: true }, error: null } : undefined)));
    const result = (await run("pm_meeting", ctx, { jobNumber: "2701" }, async () => ({
      content: [{ type: "text" as const, text: "2701 – PM meeting\nSchedule is on track." }],
      structuredContent: { stage: "progress" },
    }))) as { content: { text: string }[]; structuredContent: { getting_started?: { title: string }; stage?: string } };
    expect(result.content[0].text).not.toContain(START_HEADLINE);
    expect(result.structuredContent.getting_started?.title).toBe(START_HEADLINE);
    expect(result.structuredContent.stage).toBe("progress");
  });

  it("fails open when the migration is not applied", async () => {
    rpc.mockImplementation(
      gate((fn) =>
        fn === "mcp_getting_started_claim"
          ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.mcp_getting_started_claim" } }
          : undefined,
      ),
    );
    const result = (await run("report", ctx, {}, async () => ({
      content: [{ type: "text" as const, text: "Still here." }],
    }))) as { content: { text: string }[] };
    expect(result.content[0].text).toContain("Still here.");
    expect(result.content[0].text).not.toContain(START_HEADLINE);
    const sb = { rpc: async () => ({ data: null, error: { message: "function public.mcp_getting_started_claim() does not exist" } }) };
    expect(await claimGettingStarted(sb)).toBe(false);
    expect(await claimGettingStarted({ rpc: async () => { throw new Error("down"); } })).toBe(false);
  });

  it("getting_started shows the card again without stacking a second copy", async () => {
    let seen = false;
    rpc.mockImplementation(
      gate((fn) => {
        if (fn !== "mcp_getting_started_claim") return undefined;
        if (seen) return { data: { show: false }, error: null };
        seen = true;
        return { data: { show: true }, error: null };
      }),
    );
    const result = (await gettingStarted.handler({}, ctx)) as {
      content: { text: string }[];
      structuredContent: { card: { title: string }; getting_started?: unknown };
    };
    expect(result.structuredContent.card.title).toBe("Let's set up your company");
    expect(result.structuredContent.getting_started).toBeUndefined();
    const plain = result.content[0].text.split("REQUIRED VIEW:")[0];
    expect(plain.trimStart().startsWith("Let's set up your company")).toBe(true);
    expect(plain).toContain("What is the company name?");
    expect(plain).toContain("Jobs belong to a company.");
    expect(plain).toContain("Next move: Send the company name.");
    expect(plain).not.toMatch(/save_company|create_job/);
    expect(result.structuredContent.card.title).toBe("Let's set up your company");
    expect(result.structuredContent.getting_started).toBeUndefined();
    expect((result.structuredContent as { assistant_guidance?: string[] }).assistant_guidance?.join(" ")).toMatch(/save_company/);
    expect(visibleProblems(result.content[0].text)).toEqual([]);
  });
});

describe("getting_started branches", () => {
  function jobsDb(companies: { id: string }[], jobs: { job_number: string; name: string | null }[]) {
    return {
      from(table: string) {
        const rows = table === "mcp_companies" ? companies : jobs;
        const done = Promise.resolve({ data: rows, error: null });
        const builder = { in: () => done, then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => done.then(ok, bad) };
        return { select: () => builder };
      },
    };
  }

  it("with no company, opens company setup and says the next step and why", async () => {
    const morning = vi.fn();
    const result = await branchGettingStarted(jobsDb([], []), morning, (company) => firstJobCard(company));
    expect(morning).not.toHaveBeenCalled();
    expect(result.title).toBe("Let's set up your company");
    expect(result.ask?.prompt).toBe("What is the company name?");
    expect(result.next_move).toBe("Send the company name.");
    const shown = renderGettingStarted(result);
    expect(shown).toContain("Jobs belong to a company. The company name is the first save.");
    expect(shown).not.toMatch(/save_company|create_job|2701/);
    expect(firstJobGuidance(false)).toMatch(/save_company/);
    expect(visibleProblems(shown.split("REQUIRED VIEW:")[0])).toEqual([]);
  });

  it("with a company and no jobs, opens first-job setup and says the next step and why", async () => {
    const morning = vi.fn();
    const result = await branchGettingStarted(jobsDb([{ id: "c1" }], []), morning, (company) => firstJobCard(company));
    expect(morning).not.toHaveBeenCalled();
    expect(result.title).toBe("Let's set up your first job");
    expect(result.ask?.prompt).toContain("job number");
    expect(result.next_move).toBe("Send the job number and the name.");
    const shown = renderGettingStarted(result);
    expect(shown).toContain("The job number is required.");
    expect(shown).toContain("The morning meeting and the boards start from that job.");
    expect(shown).not.toMatch(/create_job|job_number|2701/);
    expect(firstJobGuidance(true)).toMatch(/create_job/);
    expect(visibleProblems(shown.split("REQUIRED VIEW:")[0])).toEqual([]);
  });

  it("with one job, stays on the get-started card and does not open the morning hitlist", async () => {
    const morning = vi.fn();
    const result = await branchGettingStarted(jobsDb([{ id: "c1" }], [{ job_number: "410", name: "Harbor" }]), morning, () => {
      throw new Error("setup");
    });
    expect(morning).not.toHaveBeenCalled();
    expect(result.title).toBe("Hey Athena, let's get started");
    expect(result.next_move).toBe("The morning meeting is on 410.");
    expect(renderGettingStarted(result)).not.toContain("Which job's morning hitlist?");
  });

  it("with more than one job, lists them on the card and does not ask which job's morning hitlist", async () => {
    const morning = vi.fn();
    const result = await branchGettingStarted(
      jobsDb([{ id: "c1" }], [{ job_number: "410", name: "Harbor" }, { job_number: "411", name: "Ridge" }]),
      morning,
      () => { throw new Error("setup"); },
    );
    expect(morning).not.toHaveBeenCalled();
    const shown = renderGettingStarted(result);
    expect(result.title).toBe("Hey Athena, let's get started");
    expect(shown).toContain("410 (Harbor)");
    expect(shown).toContain("411 (Ridge)");
    expect(shown).not.toContain("Which job's morning hitlist?");
  });
});

describe("getting_started tool never opens on a picker", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(gate(() => undefined));
    jobsFixture.companies = [{ id: "c1" }];
  });

  it("with jobs, returns the habit card and does not ask which job", async () => {
    jobsFixture.jobs = [
      { job_number: "2701", name: "Harbor Point" },
      { job_number: "1234", name: "Riverside" },
    ];
    const result = (await gettingStarted.handler({}, ctx)) as {
      content: { text: string }[];
      structuredContent: { card: { title: string; ask?: { prompt: string } | null; sections?: { heading: string }[] } };
    };
    const plain = result.content[0].text.split("REQUIRED VIEW:")[0];
    expect(result.structuredContent.card.title).toBe("Hey Athena, let's get started");
    expect(plain.trimStart().startsWith("Hey Athena, let's get started")).toBe(true);
    expect(plain).toContain("Try one");
    expect(plain).toContain(START_MEMORY_OFFER);
    expect(plain).toContain("Morning meeting");
    expect(plain).toContain(START_CONNECTOR_MEMORY);
    expect(plain).toContain("forget that memory");
    expect(plain).not.toContain("Which job's morning hitlist?");
    expect(plain.indexOf(START_AT_EXAMPLES[0])).toBeLessThan(plain.indexOf(START_CONNECTOR_MEMORY));
    expect(plain.indexOf(START_CONNECTOR_MEMORY)).toBeLessThan(plain.indexOf("Morning meeting"));
    expect(plain.indexOf("Try one")).toBeLessThan(plain.indexOf("Morning meeting"));
    expect(plain).toContain("2701 (Harbor Point)");
    expect(plain).toContain("1234 (Riverside)");
    expect(plain.trimStart().startsWith("Which job?")).toBe(false);
    expect(result.structuredContent.card.ask ?? null).toBeNull();
  });

  it("with one job, names that morning meeting on the same card", async () => {
    jobsFixture.jobs = [{ job_number: "2701", name: "Harbor Point" }];
    const result = (await gettingStarted.handler({}, ctx)) as {
      content: { text: string }[];
      structuredContent: { card: { title: string; next_move?: string } };
    };
    expect(result.structuredContent.card.title).toBe("Hey Athena, let's get started");
    expect(result.content[0].text).toContain("Open it on 2701 (Harbor Point).");
    expect(result.structuredContent.card.next_move).toBe("The morning meeting is on 2701.");
    expect(result.content[0].text.split("REQUIRED VIEW:")[0].trimStart().startsWith("Which job?")).toBe(false);
  });
});

describe("getting_started card comes before any job picker", () => {
  it("one job stays on the get-started card and names that morning meeting", () => {
    const card = startedWithJobsCard([{ job_number: "2701", name: "Harbor Point" }]);
    const shown = renderGettingStarted(card);
    expect(card.title).toBe("Hey Athena, let's get started");
    expect(card.title).not.toBe("Which job?");
    expect(shown.trimStart().startsWith("Hey Athena, let's get started")).toBe(true);
    expect(shown).toContain("Try one");
    expect(shown).toContain(START_BACKUP);
    expect(shown).toContain(START_MEMORY_OFFER);
    expect(shown).toContain(START_CONNECTOR_MEMORY);
    expect(shown).toContain("forget that memory");
    for (const line of START_AT_EXAMPLES) expect(shown).toContain(line);
    expect(shown.indexOf(START_AT_EXAMPLES[0])).toBeLessThan(shown.indexOf(START_CONNECTOR_MEMORY));
    expect(shown.indexOf(START_CONNECTOR_MEMORY)).toBeLessThan(shown.indexOf("Morning meeting"));
    expect(shown).toContain("Open it on 2701 (Harbor Point).");
    expect(shown).not.toContain("Which job's morning hitlist?");
    expect(shown).not.toMatch(/^Which job/m);
    expect(card.ask ?? null).toBeNull();
    expect(card.next_move).toBe("The morning meeting is on 2701.");
  });

  it("several jobs keep the habit card and list the morning meeting inside it", () => {
    const card = startedWithJobsCard([
      { job_number: "2701", name: "Harbor Point" },
      { job_number: "1234", name: "Riverside" },
    ]);
    const shown = renderGettingStarted(card);
    expect(card.title).toBe("Hey Athena, let's get started");
    expect(shown.indexOf("Try one")).toBeLessThan(shown.indexOf("Morning meeting"));
    expect(shown.indexOf("Morning meeting")).toBeLessThan(shown.indexOf("2701 (Harbor Point)"));
    expect(shown).toContain("2701 (Harbor Point)");
    expect(shown).toContain("1234 (Riverside)");
    expect(card.sections?.some((section) => section.heading === "Morning meeting")).toBe(true);
    expect(shown.split("REQUIRED VIEW:")[0].trimStart().startsWith("Which job?")).toBe(false);
  });
});

describe("app tip", () => {
  it("uses the same headline, why, and asks on the Athena landing and the connect handoff", () => {
    const html = renderToStaticMarkup(React.createElement(AthenaStartTip)).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
    expect(html).toContain('data-testid="athena-start-tip"');
    expect(html).toContain(START_HEADLINE);
    expect(html.indexOf(START_HEADLINE)).toBeLessThan(html.indexOf(START_EXAMPLES[0]));
    expect(html.indexOf(START_EXAMPLES[0])).toBeLessThan(html.indexOf(START_BACKUP));
    for (const line of START_POINTS) expect(html).toContain(line);
    for (const ask of START_EXAMPLES) expect(html).toContain(ask);
    expect(html).not.toContain("2701");
    expect(html).not.toMatch(/\bpermanent\b/i);
    expect(paletteViolations(html, false)).toEqual([]);
    expect(html).not.toMatch(/#DC2626|lovable|supabase/i);
    const account = readFileSync("src/routes/account.tsx", "utf8");
    const consent = readFileSync("src/routes/oauth.consent.tsx", "utf8");
    expect(account).toContain("AthenaStartTip");
    expect(account).toMatch(/athenaHost \? \([\s\S]*<AthenaStartTip \/>/);
    expect(consent).toContain("<AthenaStartTip />");
    expect(readFileSync("src/lib/mcp/index.ts", "utf8")).toContain("GETTING_STARTED_RULE");
    expect(GETTING_STARTED_RULE).toContain("getting_started");
    expect(GETTING_STARTED_RULE).not.toMatch(/#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b/);
  });
});

describe("getting started migration", () => {
  const sql = readFileSync("supabase/migrations/20261023180000_athena_getting_started.sql", "utf8");

  it("stores one first-run flag per user and does not let members write the row", () => {
    expect(sql).toContain("NOT APPLIED");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_getting_started");
    expect(sql).toContain("user_id uuid PRIMARY KEY");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("PERFORM public.mcp_assert_active()");
    expect(sql).toContain("ON CONFLICT (user_id) DO NOTHING");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE ON public.mcp_getting_started FROM anon, authenticated, public");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.mcp_getting_started_claim() TO authenticated");
    expect(sql).not.toMatch(/\blovable\b|\bsupabase\b/i);
  });
});

describe("attach without a claim", () => {
  it("leaves the result alone when the flag was already taken", async () => {
    const sb = { rpc: async () => ({ data: { show: false }, error: null }) };
    const result = await attachGettingStarted(sb, { content: [{ type: "text", text: "Only the job." }] });
    expect((result as { content: { text: string }[] }).content[0].text).toBe("Only the job.");
  });
});
