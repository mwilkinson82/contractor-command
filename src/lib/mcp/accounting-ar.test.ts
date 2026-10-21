// AR addendum: aging by job and customer, reminders, overdue follow-up asks with escalation, briefing section, standing behavior.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fmt } from "./accounting/cents";
import { AR_STANDING_RULE, AR_VIEW_SPEC, arAging, arSection, collectionDraftSpec, dueReminders, escalationStep, followupOffers, reminderEvents, standingAr, type Receivable } from "./accounting/ar";
import { toReceivables } from "./tools/ar-tools";
import { ALERT_COLOR } from "./alert-color";

const R = (o: Partial<Receivable>): Receivable => ({ job_number: "2701", job_name: "Harbor Point MOB", customer: "Harbor Point Builders", ref: "App 03", kind: "pay_app", sent_on: "2027-01-25", due: "2027-03-04", due_estimated: false, amount: 40515000, received: 0, file_name: "2701-PayApp-03-2027-01-31.pdf", ...o });
const ITEMS = [
  R({}),
  R({ ref: "App 02", due: "2027-02-01", amount: 22612500, received: 22612500 }), // paid
  R({ job_number: "2704", job_name: "Lakeside Clinic", customer: "Lakeside GC", ref: "App 01", due: "2027-03-17", amount: 1000000 }),
  R({ job_number: "2704", job_name: "Lakeside Clinic", customer: "Lakeside GC", ref: "INV-14", kind: "invoice", due: "2026-12-01", amount: 250000, file_name: null }),
];

describe("AR aging report", () => {
  it("by job and by customer, every bucket, paid items drop out", () => {
    const a = arAging(ITEMS, "2027-03-10");
    const j = Object.fromEntries(a.byJob.map((r) => [r.key, r]));
    expect(fmt(j["2701 Harbor Point MOB"]["1-30"])).toBe("$405,150.00");
    expect(fmt(j["2704 Lakeside Clinic"].current)).toBe("$10,000.00");
    expect(fmt(j["2704 Lakeside Clinic"]["90+"])).toBe("$2,500.00");
    expect(a.byCustomer.map((r) => r.key).sort()).toEqual(["Harbor Point Builders", "Lakeside GC"]);
    expect(fmt(a.total.total)).toBe("$417,650.00");
    expect(fmt(a.total.overdue)).toBe("$407,650.00");
  });
  it("31-60 and 61-90 land in their buckets", () => {
    const a = arAging([R({ due: "2027-01-20" }), R({ ref: "App 04", due: "2026-12-20" })], "2027-03-10");
    expect([a.total["31-60"], a.total["61-90"]].map(fmt)).toEqual(["$405,150.00", "$405,150.00"]);
  });
  it("view: navy header, overdue in the alert color only, Excel and PDF export", () => {
    const v = AR_VIEW_SPEC.join("\n");
    expect(v).toMatch(/Navy header/);
    expect(v).toContain(`overdue tile in ${ALERT_COLOR}`);
    expect(v).toMatch(/current in blue #2563EB/);
    expect(v).toMatch(/AR-Aging-DATE\.xlsx.*AR-Aging-DATE\.pdf/);
  });
});

describe("payment-due reminders", () => {
  it("7 and 1 days before by default", () => {
    expect(dueReminders([R({ due: "2027-03-17" })], "2027-03-10")[0].text).toBe("Payment on job 2701 is due in 7 days (App 03, $405,150.00).");
    expect(dueReminders([R({ due: "2027-03-11" })], "2027-03-10")[0].text).toMatch(/is due in 1 day \(/);
    expect(dueReminders([R({ due: "2027-03-14" })], "2027-03-10")).toEqual([]);
  });
  it("adjustable offsets from the job cadence, and Estimated dates say so", () => {
    expect(dueReminders([R({ due: "2027-03-24", due_estimated: true })], "2027-03-10", [14])[0].text).toMatch(/due in 14 days .*Estimated date/);
  });
  it("calendar events for each offset (the host adds them after the connect check)", () => {
    expect(reminderEvents([R({ due: "2027-03-17" })]).map((e) => e.date)).toEqual(["2027-03-10", "2027-03-16"]);
    expect(AR_STANDING_RULE).toMatch(/calendar after the connect check/);
  });
});

describe("overdue follow-up and escalation", () => {
  it("once overdue: asks to draft the collection follow-up", () => {
    const o = followupOffers([R({})], "2027-03-10");
    expect(o[0].ask).toBe("Payment on job 2701 is 6 days overdue. Should I draft an AR collection follow-up email?");
    expect(o[0].step).toBe(1);
  });
  it("repeats only at 30, 60 and 90; at 60+ suggests lien, notice and remedies", () => {
    expect([0, 1, 29, 30, 59, 60, 89, 90, 200].map(escalationStep)).toEqual([null, 1, 1, 30, 30, 60, 60, 90, 90]);
    expect(followupOffers([R({})], "2027-03-20", { "2701|App 03": 1 })).toEqual([]);
    expect(followupOffers([R({})], "2027-04-03", { "2701|App 03": 1 })[0].step).toBe(30);
    const sixty = followupOffers([R({})], "2027-05-03", { "2701|App 03": 30 })[0];
    expect(sixty.lien_check).toBe(true);
    expect(sixty.ask).toMatch(/lien and notice deadlines and the contract's payment-default remedies/);
    expect(followupOffers([R({})], "2027-06-02", { "2701|App 03": 60 })[0].step).toBe(90);
  });
  it("the draft attaches the real file and never sends", () => {
    const s = collectionDraftSpec(followupOffers([R({})], "2027-03-10")[0]).join("\n");
    expect(s).toContain("Attach 2701-PayApp-03-2027-01-31.pdf as a real file");
    expect(s).toMatch(/Nothing sends without the user's yes\. Never send it yourself\./);
  });
});

describe("morning briefing and PM meeting: AR due and overdue", () => {
  it("lists overdue and due-soon items", () => {
    const s = arSection(ITEMS, "2027-03-10");
    expect(s.lines[0]).toBe("AR due and overdue");
    expect(s.lines).toContain("- OVERDUE · job 2701 · App 03 · $405,150.00 · 6 days overdue");
    expect(s.lines.some((l) => l.startsWith("- Due 2027-03-17 · job 2704 · App 01"))).toBe(true);
  });
});

describe("standing behavior: AR shows up without being asked", () => {
  it("a plain 'good morning' on a job with an overdue pay app surfaces the AR item and the draft offer", () => {
    const r = standingAr("good morning", [R({})], "2027-03-10");
    expect(r).not.toBeNull();
    expect(r!.section).toContain("- OVERDUE · job 2701 · App 03 · $405,150.00 · 6 days overdue");
    expect(r!.offers).toEqual(["Payment on job 2701 is 6 days overdue. Should I draft an AR collection follow-up email?"]);
  });
  it("a direct question isn't hijacked; nothing due means no AR block", () => {
    expect(standingAr("what's the float on A1070?", [R({})], "2027-03-10")).toBeNull();
    expect(standingAr("good morning", [R({ received: 40515000 })], "2027-03-10")).toBeNull();
  });
  it("tracking starts when a pay app is logged as sent; due dates come from the saved terms (Estimated until paid)", () => {
    const terms = { kind: "pay_when_paid", days: 7, day_type: "calendar", owner_terms_days: 30, owner_terms_from: "approval", source: "contract", clause_section: "3.3", clause_text: "x", answered_by: null } as const;
    const base = { job_number: "2701", job_name: "Harbor Point MOB", customer: null, reminder_offsets: null, terms, kind: "pay_app" as const, ref: "App 03", app_no: 3, period_to: "2027-01-31", sent_on: "2027-01-25", submitted_on: "2027-01-25", approved_on: "2027-02-01", gc_paid_on: null, amount: 40515000, received: 0, offered_step: null };
    const est = toReceivables([base]).items[0];
    expect([est.due, est.due_estimated, est.file_name]).toEqual(["2027-03-10", true, "2701-PayApp-03-2027-01-31.pdf"]);
    expect(toReceivables([{ ...base, gc_paid_on: "2027-02-25" }]).items[0]).toMatchObject({ due: "2027-03-04", due_estimated: false });
  });
  it("the server instructions carry the standing AR rule; the migration is additive and not applied", () => {
    expect(readFileSync("src/lib/mcp/index.ts", "utf8")).toContain("AR_STANDING_RULE");
    expect(AR_STANDING_RULE).toMatch(/unprompted/);
    const sql = readFileSync("supabase/migrations/20261022020000_athena_accounting_ar.sql", "utf8");
    expect(sql).toMatch(/NOT APPLIED/);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
  });
});
