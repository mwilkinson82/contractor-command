import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { START_BACKUP, START_EXAMPLES, START_HEADLINE, START_POINTS } from "../athena-start-copy";
import { AthenaStartTip } from "@/components/athena/start-tip";
import { paletteViolations } from "./cards/palette";
import { renderHtml } from "./cards/html";
import { cardWidgetHtml } from "./cards/widget";
import { visibleProblems } from "./visible";
import {
  GETTING_STARTED_RULE,
  attachGettingStarted,
  claimGettingStarted,
  gettingStartedCard,
  renderGettingStarted,
} from "./getting-started";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("./supabase", () => ({
  supabaseForUser: () => ({ rpc, from: () => ({ insert: async () => ({ error: null }) }) }),
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
    expect(card.title).toBe('Just say "Hey Athena".');
    expect(shown.indexOf(START_HEADLINE)).toBeLessThan(shown.indexOf(START_EXAMPLES[0]));
    expect(shown.indexOf(START_EXAMPLES[0])).toBeLessThan(shown.indexOf(START_BACKUP));
    expect(START_BACKUP).toContain("@Athena");
    expect(START_BACKUP).toContain("instead of the general AI");
    expect(START_POINTS).toEqual([
      "The same Athena knows your jobs wherever you open her, in ChatGPT or Claude.",
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
  beforeEach(() => rpc.mockReset());

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
    expect(first.content[0].text.startsWith("## ")).toBe(true);
    expect(first.content[0].text).toContain(START_HEADLINE);
    expect(first.content[0].text).toContain("Job 2701 is open.");
    expect(first.content[0].text.indexOf(START_HEADLINE)).toBeLessThan(first.content[0].text.indexOf("Job 2701 is open."));
    expect(first.content[0].text.match(/## 🔵 Just say "Hey Athena"\./g)).toHaveLength(1);
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
    expect(result.structuredContent.card.title).toBe(START_HEADLINE);
    expect(result.structuredContent.getting_started).toBeUndefined();
    expect(result.content[0].text.match(/## 🔵 Just say "Hey Athena"\./g)).toHaveLength(1);
    expect(visibleProblems(result.content[0].text)).toEqual([]);
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
