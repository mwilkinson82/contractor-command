// Kinds of work comes first (Marshall, Nov 5 2026): "if anybody who's using Athena has not set this up yet
// ... they should all be forced to go through this", because it sets the tone for every job. A company
// Owner whose company hasn't answered or skipped all eight questions gets them before a new job or an
// import, one per reply, starting where they left off; then Athena carries on with what they asked for.
// Only an Owner can save the answers, so other members are never stopped by it.

import { text, type Sb } from "./guard";
import {
  nextWorkQuestion,
  readCompanyWorkProfile,
  readWorkProfile,
  workPrechecked,
  workQuestionGuidance,
  workQuestionsLeft,
  workQuestionText,
} from "./work-profile";

type Row = { data: unknown; error: { message?: string } | null };
type Reader = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => {
        eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<Row> };
        maybeSingle: () => PromiseLike<Row>;
      };
    };
  };
};

/** What the member was doing, so Athena can pick it back up. */
export type GatedRequest = { what: string; resume: string };

export async function kindsOfWorkGate(sb: Sb, companyId: string, userId: string | undefined, request: GatedRequest) {
  const wp = await readCompanyWorkProfile(sb, companyId);
  if (!wp.available) return null;
  const work = readWorkProfile(wp.raw);
  const next = nextWorkQuestion(work);
  if (!next) return null;
  const db = sb as unknown as Reader;
  if (!userId) return null;
  const member = await db.from("mcp_company_members").select("role").eq("company_id", companyId).eq("user_id", userId).maybeSingle();
  if ((member.data as { role?: string } | null)?.role !== "owner") return null;
  const company = await db.from("mcp_companies").select("name, work_types").eq("id", companyId).maybeSingle();
  const c = (company.data ?? {}) as { name?: string | null; work_types?: string[] | null };
  const left = workQuestionsLeft(work);
  const prechecked = workPrechecked(next, c.work_types);
  const answered = 8 - left;
  const lead = `Before ${request.what}, Athena needs ${c.name?.trim() || "your company"}'s kinds of work. It sets up every job from these answers, so it comes first. ${answered ? `${answered} of 8 are answered already; this picks up where you left off.` : "It's 8 quick questions, and any can be skipped."} Nothing was created yet.`;
  return {
    ...text(
      [
        lead,
        "",
        workQuestionText(next, left, prechecked),
        "",
        workQuestionGuidance(next, prechecked),
        `When save_work_profile shows no question left, carry on with what the member asked for: ${request.resume}`,
      ].join("\n"),
    ),
    structuredContent: {
      gate: "kinds_of_work" as const,
      company_id: companyId,
      resume: request.resume,
      work_question: { key: next.key, number: next.number, ask: next.ask, choices: next.choices, prechecked, left },
    },
  };
}
