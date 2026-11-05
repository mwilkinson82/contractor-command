import { describe, expect, it } from "vitest";
import { kindsOfWorkGate } from "./work-gate";
import { inferCard } from "./cards/infer";
import type { Sb } from "./guard";

type Tables = { profile: unknown; profileError?: boolean; role: string | null; workTypes?: string[] };
function fakeSb(t: Tables): Sb {
  const row = (table: string, cols: string, filters: Record<string, string>) => {
    if (table === "mcp_companies" && cols === "work_profile")
      return t.profileError ? { data: null, error: { message: 'column "work_profile" does not exist' } } : { data: { work_profile: t.profile }, error: null };
    if (table === "mcp_companies") return { data: { name: "Test Builders", work_types: t.workTypes ?? [] }, error: null };
    if (table === "mcp_company_members") return { data: filters.user_id === "u-1" && t.role ? { role: t.role } : null, error: null };
    return { data: null, error: null };
  };
  const query = (table: string, cols: string, filters: Record<string, string> = {}) => ({
    eq: (c: string, v: string) => query(table, cols, { ...filters, [c]: v }),
    maybeSingle: () => Promise.resolve(row(table, cols, filters)),
  });
  return { from: (table: string) => ({ select: (cols: string) => query(table, cols) }) } as unknown as Sb;
}
const ask = { what: "job 2901 is created", resume: 'create job 2901, Harbor Clinic, with intake section "create_job" and the same details.' };
const body = (r: { content: { text?: string }[] }) => r.content.map((c) => c.text ?? "").join("\n");

describe("kinds of work comes first (Marshall, Nov 5)", () => {
  it("stops an Owner's new job at question 1 when nothing is answered, and nothing is created", async () => {
    const r = await kindsOfWorkGate(fakeSb({ profile: {}, role: "owner", workTypes: ["public"] }), "c-1", "u-1", ask);
    expect(r).not.toBeNull();
    const t = body(r!);
    expect(t).toContain("Before job 2901 is created, Athena needs Test Builders's kinds of work.");
    expect(t).toContain("It's 8 quick questions, and any can be skipped. Nothing was created yet.");
    expect(t).toContain("Kinds of work, question 1 of 8");
    expect(t).toContain('call the onboarding tool now with action "save_work_profile"');
    expect(t).toContain('carry on with what the member asked for: create job 2901, Harbor Clinic');
    expect(r!.structuredContent).toMatchObject({ gate: "kinds_of_work", company_id: "c-1", work_question: { key: "markets", number: 1, prechecked: ["Low-bid public work"], left: 8 } });
  });

  it("picks up where the Owner left off, with question 5 shaped by the shop answer", async () => {
    const profile = { markets: ["public_low_bid"], pricing: ["lump_sum"], regions: ["New York"], shop: "both" };
    const r = await kindsOfWorkGate(fakeSb({ profile, role: "owner" }), "c-1", "u-1", ask);
    const t = body(r!);
    expect(t).toContain("4 of 8 are answered already; this picks up where you left off.");
    expect(t).toContain("Kinds of work, question 5 of 8");
    expect(r!.structuredContent.work_question.choices).toEqual(["PLA", "Prevailing wage", "Union rates", "Open-shop wages", "Skip"]);
  });

  it("counts skipped questions as done and lets the job through once all eight are answered or skipped", async () => {
    const profile = { markets: ["custom_homes"], skipped: ["pricing", "regions", "shop", "wage_rules", "unit_price", "preconstruction", "service_calls"] };
    expect(await kindsOfWorkGate(fakeSb({ profile, role: "owner" }), "c-1", "u-1", ask)).toBeNull();
  });

  it("never stops a PM or other member, who can't save the company's answers", async () => {
    expect(await kindsOfWorkGate(fakeSb({ profile: {}, role: "pm" }), "c-1", "u-1", ask)).toBeNull();
    expect(await kindsOfWorkGate(fakeSb({ profile: {}, role: null }), "c-1", "u-1", ask)).toBeNull();
    expect(await kindsOfWorkGate(fakeSb({ profile: {}, role: "owner" }), "c-1", undefined, ask)).toBeNull();
  });

  it("stays out of the way before the kinds-of-work column exists", async () => {
    expect(await kindsOfWorkGate(fakeSb({ profile: {}, profileError: true, role: "owner" }), "c-1", "u-1", ask)).toBeNull();
  });

  it("the card on the stopped request asks the open question", async () => {
    const r = await kindsOfWorkGate(fakeSb({ profile: {}, role: "owner" }), "c-1", "u-1", ask);
    const card = inferCard("intake", body(r!), r!.structuredContent as Record<string, unknown>);
    expect(card.state).toBe("ask");
    expect(card.title).toBe("First, your kinds of work");
    expect(card.ask?.prompt).toBe("Question 1 of 8: What kind of work does your company do? Pick all that fit.");
    expect(card.next_move).toBe("Pick your answer, or say skip.");
  });
});
