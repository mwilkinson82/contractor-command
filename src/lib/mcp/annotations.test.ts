import { describe, it, expect } from "vitest";
import * as W from "./tools/workflow-tools";
import * as L from "./tools/living-tools";
import * as F from "./tools/file-tools";
import * as C from "./tools/cadence-tools";
import * as M from "./tools/morning-tools";
import { FRAGNET_RULE } from "./living";

// Submission prep: every tool states readOnlyHint, destructiveHint and openWorldHint explicitly.
const ann = (t: unknown) => (t as { annotations?: Record<string, unknown> }).annotations ?? (t as { config?: { annotations?: Record<string, unknown> } }).config?.annotations;
const R = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const w = (destructiveHint: boolean, openWorldHint = false) => ({ readOnlyHint: false, destructiveHint, openWorldHint });
const TABLE: [string, unknown, Record<string, boolean>][] = [
  ["report", W.report, R], ["list_open_items", W.listOpenItems, R], ["contract_terms", W.contractTerms, R],
  ["cpm_activities", L.cpmActivities, R], ["living_report_get", L.livingReportGet, R], ["morning_briefing", M.morningBriefing, R],
  ["onboarding", W.onboarding, w(true)], ["intake", W.intake, w(true)], ["next_question", W.nextQuestion, w(false)],
  ["answer", W.answer, w(true)], ["carry_forward", W.carryForward, w(false)], ["resolve_item", W.resolveItem, w(true)],
  ["living_report_save", L.livingReportSave, w(true)], ["file_share", F.fileShare, w(false, true)], ["file_share_revoke", F.fileShareRevoke, w(true)],
  ["job_cadence", C.jobCadence, w(false)], ["job_cadence_reminders", C.jobCadenceReminders, w(true)],
];
describe("tool annotations (explicit, all 17)", () => {
  it.each(TABLE)("%s", (_n, t, want) => {
    const a = ann(t)!;
    expect(a).toMatchObject(want);
    for (const k of ["readOnlyHint", "destructiveHint", "openWorldHint"]) expect(typeof a[k]).toBe("boolean");
  });
});
describe("fragnet input aliases", () => {
  it("maps legacy keys to fragnet and drops them", () => {
    const out = L.legacyTiaAlias({ ["frag" + "ment"]: "FRAG-01", ["frag" + "ment_only_completion"]: "2027-01-02", prior_completion: "2027-01-01", updated_completion: "2027-01-05" }) as Record<string, unknown>;
    expect(out).toEqual({ fragnet: "FRAG-01", fragnet_only_completion: "2027-01-02", prior_completion: "2027-01-01", updated_completion: "2027-01-05" });
    expect(JSON.stringify(out)).not.toMatch(/fragment/i);
  });
  it("new keys win over legacy", () => {
    expect((L.legacyTiaAlias({ fragnet: "A", ["frag" + "ment"]: "B" }) as { fragnet: string }).fragnet).toBe("A");
  });
  it("output rule is present and clean", () => {
    expect(FRAGNET_RULE).toMatch(/delay fragnets/);
    expect(FRAGNET_RULE).not.toMatch(/fragment/i);
  });
});
describe("fragnet output keys", () => {
  it("renames saved legacy delay keys on read (job 2701 delay_analysis shape)", async () => {
    const { fragnetKeys } = await import("./living");
    const out = fragnetKeys({ delay_analysis: { cause: "Engineer redesign", ["frag" + "ment"]: "D1060", delay_workdays: 15 }, activities: [{ id: "A1" }] });
    expect(out).toEqual({ delay_analysis: { cause: "Engineer redesign", fragnet: "D1060", delay_workdays: 15 }, activities: [{ id: "A1" }] });
  });
});
