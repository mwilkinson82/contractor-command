import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { setupSteps } from "@/lib/account-profile";
import { readSetupProgress } from "@/lib/account-setup";
import {
  jobLaborTermsLine,
  nextWorkQuestion,
  readCompanyWorkProfile,
  readWorkProfile,
  tailoredScopeAsk,
  workProfileDone,
  workProfileSummary,
  workQuestions,
  workQuestionsLeft,
} from "@/lib/mcp/work-profile";

describe("kinds-of-work questions", () => {
  it("asks eight skippable questions in order, one at a time", () => {
    const qs = workQuestions();
    expect(qs.map((q) => q.key)).toEqual([
      "markets",
      "pricing",
      "regions",
      "shop",
      "wage_rules",
      "unit_price",
      "preconstruction",
      "service_calls",
    ]);
    for (const q of qs) expect(q.choices.at(-1)).toBe("Skip");
    expect(qs[0].choices).toContain("Low-bid public work");
    expect(qs[3].ask).toContain("open shop (non-union)");
    expect(qs[5].ask).toContain("even once a year");
    expect(nextWorkQuestion({})?.key).toBe("markets");
    expect(workQuestionsLeft({})).toBe(8);
  });

  it("shows custom home builders cost plus and lump sum first", () => {
    const q = workQuestions({ markets: ["custom_homes"] })[1];
    expect(q.choices.slice(0, 2)).toEqual(["Cost plus", "Lump sum"]);
    expect(workQuestions({ markets: ["public_low_bid"] })[1].choices[0]).toBe("Lump sum");
  });

  it("moves past answered and skipped questions and finishes when all are settled", () => {
    const p = readWorkProfile({ markets: ["private_commercial"], skipped: ["pricing", "regions"] });
    expect(nextWorkQuestion(p)?.key).toBe("shop");
    const all = readWorkProfile({
      markets: [],
      skipped: ["pricing", "regions", "shop", "wage_rules", "unit_price", "preconstruction", "service_calls"],
    });
    expect(workProfileDone(all)).toBe(true);
    expect(nextWorkQuestion(all)).toBeNull();
  });

  it("drops unknown keys and bad values from a stored profile", () => {
    expect(readWorkProfile({ markets: ["space", "custom_homes"], shop: "maybe", unit_price: "yes", foo: 1 })).toEqual({
      markets: ["custom_homes"],
      unit_price: "yes",
    });
    expect(readWorkProfile(null)).toEqual({});
    expect(readWorkProfile([1])).toEqual({});
  });

  it("sums up answers in plain words", () => {
    expect(
      workProfileSummary({ markets: ["public_low_bid"], shop: "open_shop", wage_rules: [], unit_price: "yes", regions: ["New York"] }),
    ).toEqual([
      "Markets: Low-bid public work",
      "Works in: New York",
      "Shop: Open shop",
      "Wage rules: Open-shop wages",
      "Unit price work: Yes",
    ]);
  });
});

describe("new-job scoping from the company's answers", () => {
  it("asks every field generically when nothing is answered", () => {
    const ask = tailoredScopeAsk({});
    expect(ask).toContain("City and state is enough");
    expect(ask).toContain("public, private commercial, residential");
    expect(ask).toContain("is it union or open shop");
    expect(ask).toContain("is there a PLA");
    expect(ask).toContain("prevailing wage or plain private work");
    expect(ask).not.toContain("pre-construction");
    expect(ask).toContain('"use the defaults"');
  });

  it("offers only what fits the company", () => {
    const ask = tailoredScopeAsk({
      markets: ["custom_homes", "residential_renovation"],
      pricing: ["lump_sum", "cost_plus"],
      regions: ["New Jersey"],
      shop: "open_shop",
      wage_rules: [],
      unit_price: "no",
      preconstruction: "yes",
    });
    expect(ask).toContain("Sector: residential. Pricing: cost plus, lump sum.");
    expect(ask).toContain("you usually work in New Jersey");
    expect(ask).not.toContain("union");
    expect(ask).not.toContain("PLA");
    expect(ask).toContain("pre-construction work with the owner");
    expect(ask).not.toContain("unit price");
  });

  it("adds unit price to a lump sum company that does unit price work", () => {
    const ask = tailoredScopeAsk({ pricing: ["lump_sum"], unit_price: "yes", shop: "union_shop", wage_rules: ["prevailing_wage"] });
    expect(ask).toContain("Pricing: lump sum, unit price.");
    expect(ask).toContain("unit price change orders on this job");
    expect(ask).toContain("prevailing wage or plain private work");
    expect(ask).not.toContain("is there a PLA");
    expect(ask).not.toContain("union or open shop");
  });
});

describe("job labor terms for estimating", () => {
  it("names the state's prevailing wage rates and the union's rules", () => {
    expect(jobLaborTermsLine({ job_location: "Albany, NY", labor_shop: "union", prevailing_wage: "yes", pla: "yes" })).toBe(
      "Job labor terms: located in Albany, NY; union job (use the local's wage rates and labor rules); prevailing wage (Albany, NY rates by worker classification); PLA on the job.",
    );
    expect(jobLaborTermsLine({ labor_shop: "open_shop", prevailing_wage: "no" })).toBe(
      "Job labor terms: open shop; not prevailing wage.",
    );
    expect(jobLaborTermsLine({})).toBeNull();
  });
});

describe("reading the company setting", () => {
  const db = (result: { data: unknown; error: unknown }) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
  });
  it("treats a missing column as unavailable, not as unanswered", async () => {
    expect(await readCompanyWorkProfile(db({ data: null, error: { message: "column does not exist" } }), "c")).toEqual({
      available: false,
      raw: {},
    });
    expect(await readCompanyWorkProfile(db({ data: { work_profile: { shop: "both" } }, error: null }), "c")).toEqual({
      available: true,
      raw: { shop: "both" },
    });
  });
});

describe("account checklist", () => {
  it("adds the kinds-of-work step only once the setting exists", () => {
    const base = { profile: null, members: 1, pending: 0, payments: null } as unknown as Parameters<typeof setupSteps>[0];
    const without = setupSteps({ ...base, progress: { connected: true, jobs: 1, work: null } });
    expect(without.map((s) => s.id)).not.toContain("work");
    const open = setupSteps({ ...base, progress: { connected: true, jobs: 0, work: { done: false, left: 8 } } });
    const step = open.find((s) => s.id === "work")!;
    expect(open.map((s) => s.id).slice(0, 3)).toEqual(["connect", "work", "first-job"]);
    expect(step.done).toBe(false);
    expect(step.detail).toContain("8 quick questions left");
    expect(step.detail).toContain("Athena, let's set up the kinds of work we do.");
    const done = setupSteps({ ...base, progress: { connected: true, jobs: 0, work: { done: true, left: 0 } } });
    expect(done.find((s) => s.id === "work")!.done).toBe(true);
  });

  it("reads progress from the company's work profile", async () => {
    const member = {
      from: (t: string) =>
        t === "mcp_jobs"
          ? { select: () => ({ eq: async () => ({ count: 2, error: null }) }) }
          : {
              select: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: { work_profile: { markets: ["custom_homes"] } }, error: null }) }),
              }),
            },
    };
    const admin = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 1 }], error: null }) }) }) }) };
    expect(await readSetupProgress(member as never, admin as never, "u", "c")).toEqual({
      connected: true,
      jobs: 2,
      work: { done: false, left: 7 },
    });
  });
});

describe("migration", () => {
  const sql = readFileSync("supabase/migrations/20261106100000_athena_company_work_profile.sql", "utf8");
  it("is additive and keeps the Owner check, grants and audit", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS work_profile jsonb NOT NULL DEFAULT '{}'::jsonb");
    expect(sql).toContain("Only a company Owner can change the company profile.");
    expect(sql).toContain("REVOKE EXECUTE ON FUNCTION public.mcp_company_work_profile_save(uuid, jsonb) FROM anon, public;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.mcp_company_work_profile_save(uuid, jsonb) TO authenticated;");
    expect(sql).toContain("company_work_profile_update");
    expect(sql).not.toMatch(/DROP |DELETE FROM|TRUNCATE/i);
  });
  it("leaves the transaction to the Lovable migration tool", () => {
    expect(sql).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
  });
});

describe("kinds-of-work fixes from the first ChatGPT run (Nov 5)", () => {
  it("pre-checks the markets the company profile already lists", async () => {
    const { workPrechecked, workQuestionText } = await import("@/lib/mcp/work-profile");
    const q = workQuestions()[0];
    expect(workPrechecked(q, ["commercial", "public"])).toEqual(["Low-bid public work", "Private commercial"]);
    expect(workPrechecked(q, ["residential"])).toEqual([]);
    expect(workPrechecked(workQuestions()[1], ["commercial"])).toEqual([]);
    expect(workQuestionText(q, 8, ["Private commercial"])).toContain("Suggested from your profile (not saved until you answer): Private commercial");
  });

  it("tells the AI to make the save call, with an example, and never to send the member to refresh (Nov 5 retest)", async () => {
    const { workQuestionGuidance } = await import("@/lib/mcp/work-profile");
    const qs = workQuestions();
    const g = workQuestionGuidance(qs[0], ["Private commercial"]);
    expect(g).toContain("Show Private commercial pre-checked as a suggestion");
    expect(g).toContain("that is not a saved answer");
    expect(g).toContain('call the onboarding tool now with action "save_work_profile", which this tool has');
    expect(g).toContain('{"action":"save_work_profile","work_markets":["public_low_bid","private_commercial"]}');
    expect(g).toContain("Never tell the member to refresh or reconnect Athena for this");
    expect(g).not.toMatch(/has no "save_work_profile"|out of date/);
    expect(g).toContain("Say it is saved only after save_work_profile answers Saved.");
  });

  it("every example save call matches the onboarding input schema", async () => {
    const { WORK_SAVE_EXAMPLE } = await import("@/lib/mcp/work-profile");
    const { onboarding } = await import("@/lib/mcp/tools/workflow-tools");
    const { z } = await import("zod");
    const shape = (onboarding as unknown as { inputSchema: Parameters<typeof z.object>[0] }).inputSchema;
    const schema = z.object(shape).strict();
    for (const [key, example] of Object.entries(WORK_SAVE_EXAMPLE)) {
      const parsed = schema.safeParse(JSON.parse(example));
      expect(parsed.success, key).toBe(true);
    }
    expect(schema.safeParse({ action: "save_work_profile", work_wage_rules: ["prevailing_wage", "pla"] }).success).toBe(true);
  });

  it("the onboarding card asks the open question with its choices, checked ones marked", async () => {
    const { inferCard } = await import("@/lib/mcp/cards/infer");
    const card = inferCard("onboarding", "Company profile:\nCompany: ALP Construction", {
      work_question: { number: 1, ask: "What kind of work does your company do? Pick all that fit.", choices: ["Low-bid public work", "Private commercial", "Skip"], prechecked: ["Private commercial"], left: 8 },
    });
    expect(card.state).toBe("ask");
    expect(card.ask?.prompt).toBe("Question 1 of 8: What kind of work does your company do? Pick all that fit.");
    expect(card.sections![0].rows.map((r) => r.cells[0])).toEqual(["Low-bid public work", "✓ Private commercial", "Skip"]);
    expect(card.next_move).toBe("Pick your answer, or say skip.");
    expect(inferCard("onboarding", "Company profile:\nCompany: ALP", {}).next_move).toBe("Tell me what is still missing.");
  });
});

describe("question 5 follows the shop answer (Marshall, Nov 5)", () => {
  it("offers union work PLA, prevailing wage and union rates", async () => {
    const { workQuestions } = await import("@/lib/mcp/work-profile");
    const q5 = workQuestions({ shop: "union_shop" })[4];
    expect(q5.key).toBe("wage_rules");
    expect(q5.ask).toBe("On your union work, which wage rules apply? Pick all that fit.");
    expect(q5.choices).toEqual(["PLA", "Prevailing wage", "Union rates", "Skip"]);
  });

  it("offers open shop work prevailing wage and open-shop wages, never PLA", async () => {
    const { workQuestions } = await import("@/lib/mcp/work-profile");
    const q5 = workQuestions({ shop: "open_shop" })[4];
    expect(q5.choices).toEqual(["Prevailing wage", "Open-shop wages", "Skip"]);
  });

  it("offers both sides when the company is union and open shop, or skipped question 4", async () => {
    const { workQuestions } = await import("@/lib/mcp/work-profile");
    for (const shop of ["both", undefined] as const) {
      const q5 = workQuestions({ shop })[4];
      expect(q5.choices).toEqual(["PLA", "Prevailing wage", "Union rates", "Open-shop wages", "Skip"]);
      expect(q5.answer).toBe("several");
    }
  });

  it("the next question after a union and open shop answer is the tailored question 5", async () => {
    const { nextWorkQuestion } = await import("@/lib/mcp/work-profile");
    const q = nextWorkQuestion({ markets: ["public_low_bid"], pricing: ["lump_sum"], regions: ["NY"], shop: "both" });
    expect(q?.number).toBe(5);
    expect(q?.ask).toContain("Union work can be PLA, prevailing wage or union rates; open shop work is usually open-shop wages.");
  });

  it("union rates and open-shop wages save no value; the summary shows them from the shop answer", async () => {
    const { workProfileSummary, WORK_ANSWER_FIELD, workQuestionGuidance, workQuestions } = await import("@/lib/mcp/work-profile");
    expect(WORK_ANSWER_FIELD.wage_rules).toContain('"Union rates" and "Open-shop wages" save no value');
    expect(workProfileSummary({ shop: "both", wage_rules: ["pla", "prevailing_wage"] })).toEqual([
      "Shop: Both",
      "Wage rules: PLA, Prevailing wage, Union rates, Open-shop wages",
    ]);
    expect(workProfileSummary({ shop: "union_shop", wage_rules: [] })).toEqual(["Shop: Union shop", "Wage rules: Union rates"]);
    expect(workProfileSummary({ wage_rules: [] })).toEqual(["Wage rules: Neither prevailing wage nor PLA"]);
    expect(workQuestionGuidance(workQuestions()[4], [])).toContain("To change an earlier answer when the member asks");
  });
});
