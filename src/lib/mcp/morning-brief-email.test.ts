import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type BriefJob } from "./morning-brief";
import { buildPmBrief } from "./morning-brief-pm";
import { type FocusAct, type FocusData } from "./morning-brief-focus";
import { BRIEF_AS_USER_TABLES, briefClientAs } from "./morning-brief-as-user";
import {
  BRIEF_RED,
  briefEmailCandidate,
  briefEmailDue,
  briefEmailEnabled,
  briefEmailSubject,
  dispatchBriefEmails,
  renderBriefEmail,
} from "./morning-brief-email";

// Fictional ALP test job shaped like 2717 Harbor Residence: a schedule last updated Jun 25.
const NOW = new Date("2026-11-05T15:00:00Z");
const act = (over: Partial<FocusAct> & { id: string; name: string }): FocusAct => ({
  start: null,
  finish: null,
  duration: 10,
  pct: 0,
  critical: false,
  total_float: 5,
  party: "sub",
  subco: null,
  remaining: null,
  actual_start: null,
  actual_finish: null,
  sov_line: null,
  milestone: false,
  ...over,
});

const JOB: BriefJob = {
  job_id: "job-2717",
  job_number: "2717",
  name: "Harbor Residence",
  company_id: "alp",
  company_name: "ALP Construction",
  time_zone: "America/New_York",
  scope: "full",
  seat: "pm",
  items: [{ id: "rfi1", action: "RFI-007 pool deck drain detail", item_type: "rfi", owner: "Architect", due_date: "2026-06-24" }],
  activities: [{ id: "A1", name: "Drywall", description: null, start: "2026-06-22", finish: "2026-07-03", duration: 10, total_float: 0, critical: true }],
  lookahead: null,
  pay: [],
  links: {},
  daily_today: false,
} as unknown as BriefJob;

const OTHER: BriefJob = { ...JOB, job_id: "job-2810", job_number: "2810", name: "Bayview Remodel", activities: [], items: [{ id: "x", action: "Submit permit", due_date: "2026-11-01" }] } as unknown as BriefJob;

const FOCUS: FocusData = {
  cpm: {
    version: 8,
    data_date: "2026-06-25",
    contract_completion: "2026-08-21",
    forecast_finish: "2026-08-26",
    work_days_mask: 126,
    acts: [
      act({ id: "A1", name: "Drywall hang and finish", start: "2026-06-22", finish: "2026-07-03", pct: 40, critical: true, total_float: 0, subco: "Bayline Drywall", remaining: 7 }),
      act({ id: "A2", name: "Window fabrication and delivery", start: "2026-05-20", finish: "2026-07-10", duration: 40, pct: 60, total_float: 6, subco: "Breakwater Window Systems" }),
      act({ id: "A3", name: "Tile at baths", start: "2026-07-02", finish: "2026-07-14", pct: 0, subco: "Harbor Tile Co." }),
      act({ id: "A4", name: "Rough plumbing inspection", start: "2026-06-26", finish: "2026-06-26", duration: 1, party: "self", subco: null }),
      act({ id: "MS", name: "Substantial completion", start: "2026-08-26", finish: "2026-08-26", duration: 0, milestone: true }),
    ],
  },
  ior: {
    pct: 60,
    cost_to_date: 1625000,
    original_contract: 3200000,
    original_budget: 2720000,
    cost_growth: 180000,
    risks: [
      { title: "Electrician crew shortage", owner: "PM", status: "escalated", response: "mitigate", category: "labor", dollar: 45000, probability: 0.5, next_review: null, next_move: null },
      { title: "Pool deck change", owner: null, status: "active", response: null, category: "field_change", dollar: 30000, probability: 0.6, next_review: null, next_move: "Build the CO package" },
    ],
    pending_cos: [{ number: "CO-003", title: "Pool equipment relocation", amount: 85000, status: "Pending" }],
  },
  cos: [],
  buyout: { parties: ["Bayline Drywall"], ordered: ["Bayline Drywall"], packages: 1 },
  pay: { count: 0, latest: null, issue: null },
  contract_total: 3410000,
  dailies: [],
};

const build = (seat: "pm" | "super" = "pm") => {
  const job = seat === "super" ? ({ ...JOB, seat: "super", scope: "super" } as BriefJob) : JOB;
  const focus: FocusData = seat === "super" ? { ...FOCUS, ior: FOCUS.ior, cos: null, buyout: null, pay: null, contract_total: null } : FOCUS;
  return buildPmBrief({ jobs: [job, OTHER], focus: new Map([[job.job_id, focus]]), now: NOW, firstName: "Marshall" });
};

const ON = { ATHENA_BRIEF_EMAIL_ENABLED: "true", RESEND_API_KEY: "x" };

describe("morning brief email", () => {
  it("stays off unless the switch, the sender and no kill switch are all there", () => {
    expect(briefEmailEnabled({})).toBe(false);
    expect(briefEmailEnabled({ ATHENA_BRIEF_EMAIL_ENABLED: "true" })).toBe(false);
    expect(briefEmailEnabled(ON)).toBe(true);
    expect(briefEmailEnabled({ ...ON, ATHENA_OUTBOUND_EMAIL_DISABLED: "true" })).toBe(false);
  });

  it("reads like the brief, in blue and white, with the words to say in chat", () => {
    const { doc } = build();
    const mail = renderBriefEmail(doc);
    expect(mail.subject).toBe("Good morning, Marshall. 2 jobs need you, 2717 Harbor Residence is running 4 work days late");
    expect(mail.html).toContain("Good morning, Marshall.");
    expect(mail.html).toContain("Contract finish");
    expect(mail.html).toContain("4 work days late");
    expect(mail.html).toContain("Open today&#39;s brief");
    expect(mail.html).toContain("https://app.meetathena.io/today");
    expect(mail.html).toContain("In your AI chat, say:");
    expect(mail.html).toContain("support@meetathena.io");
    expect(mail.html).not.toContain("<script");
    expect(mail.html).not.toContain("data-prompt");
    // Red only marks late, overdue and risk lines; no amber anywhere.
    expect(mail.html).toContain(BRIEF_RED);
    expect(mail.html.toLowerCase()).not.toContain("amber");
    expect(mail.text).toContain("Open today's brief: https://app.meetathena.io/today");
    expect(mail.text).toContain("In your AI chat, say:");
  });

  it("keeps money out of a superintendent's email", () => {
    const { doc } = build("super");
    const mail = renderBriefEmail(doc);
    expect(mail.html).not.toMatch(/\$\d/);
    expect(mail.text).not.toMatch(/\$\d/);
  });

  it("escapes names from the job", () => {
    const job = { ...JOB, name: "<b>Harbor</b> & Co" } as BriefJob;
    const { doc } = buildPmBrief({ jobs: [job], focus: new Map([[job.job_id, FOCUS]]), now: NOW, firstName: "Marshall" });
    const mail = renderBriefEmail(doc);
    expect(mail.html).not.toContain("<b>Harbor</b>");
  });

  it("leads with the day it's sent and when the schedule was last updated, even on a stale schedule", () => {
    const { doc } = buildPmBrief({ jobs: [JOB], focus: new Map([[JOB.job_id, FOCUS]]), now: NOW, firstName: "Marshall" });
    const mail = renderBriefEmail(doc);
    expect(mail.text.split("\n")[1]).toMatch(/^Thursday, Nov 5 · Schedule last updated Jun 25/);
    expect(mail.html).toContain("Thursday, Nov 5 · Schedule last updated Jun 25");
    expect(mail.html).not.toContain("Schedule updated Jun 25");
  });

  it("names the day when nothing needs the member", () => {
    expect(briefEmailSubject({ greeting: "Good morning.", when: "Thursday, Nov 5", sections: [], footer: "" })).toBe("Good morning. Your brief for Thursday, Nov 5");
  });

  it("is due once a local day, from the member's time until three hours after", () => {
    const c = { sendLocal: "06:30", timeZone: "America/Manaus", lastSentOn: null };
    expect(briefEmailDue(c, new Date("2026-11-05T10:00:00Z"))).toBeNull(); // 6:00 AM Manaus
    expect(briefEmailDue(c, new Date("2026-11-05T10:35:00Z"))).toBe("2026-11-05");
    expect(briefEmailDue(c, new Date("2026-11-05T14:00:00Z"))).toBeNull(); // 10:00 AM, too late
    expect(briefEmailDue({ ...c, lastSentOn: "2026-11-05" }, new Date("2026-11-05T10:35:00Z"))).toBeNull();
  });

  it("only takes members who turned it on, with a real address", () => {
    expect(briefEmailCandidate({ user_id: "u", email: "a@b.co", email_enabled: true, enabled: true })).toMatchObject({ userId: "u", email: "a@b.co" });
    expect(briefEmailCandidate({ user_id: "u", email: "a@b.co", email_enabled: false })).toBeNull();
    expect(briefEmailCandidate({ user_id: "u", email: "a@b.co", email_enabled: true, enabled: false })).toBeNull();
    expect(briefEmailCandidate({ user_id: "u", email: "not an email", email_enabled: true })).toBeNull();
  });

  it("claims the day, sends once to the member's own address and gives the day back on failure", async () => {
    const { doc } = build();
    const now = new Date("2026-11-05T10:35:00Z");
    const rows = [
      { user_id: "u1", email: "one@example.com", email_enabled: true, enabled: true, send_local: "06:30", time_zone: "America/Manaus" },
      { user_id: "u2", email: "two@example.com", email_enabled: true, enabled: true, send_local: "06:30", time_zone: "America/Manaus" },
      { user_id: "u3", email: "three@example.com", email_enabled: true, enabled: true, send_local: "06:30", time_zone: "America/Manaus", last_sent_on: "2026-11-05" },
    ];
    const sends: { to: string; key: string }[] = [];
    const released: string[] = [];
    const marked: string[] = [];
    const result = await dispatchBriefEmails({
      rows,
      now,
      compose: async () => doc,
      claim: async () => true,
      release: async (user) => void released.push(user),
      sent: async (user) => void marked.push(user),
      send: async (m) => {
        if (m.to === "two@example.com") throw new Error("provider down");
        sends.push({ to: m.to, key: m.key });
        return { id: "re_1" };
      },
    });
    expect(result).toEqual({ sent: 1, failed: 1, skipped: 1 });
    expect(sends).toEqual([{ to: "one@example.com", key: "brief-email:u1:2026-11-05" }]);
    expect(marked).toEqual(["u1"]);
    expect(released).toEqual(["u2"]);
  });

  it("sends nothing when another run already claimed the day", async () => {
    let sent = 0;
    const result = await dispatchBriefEmails({
      rows: [{ user_id: "u1", email: "one@example.com", email_enabled: true, send_local: "06:30", time_zone: "America/Manaus" }],
      now: new Date("2026-11-05T10:35:00Z"),
      compose: async () => build().doc,
      claim: async () => false,
      release: async () => undefined,
      sent: async () => undefined,
      send: async () => {
        sent += 1;
        return { id: "x" };
      },
    });
    expect(sent).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("reads as the member through one database function and a few tables", async () => {
    const calls: unknown[] = [];
    const admin = {
      rpc: (fn: string, args: unknown) => {
        calls.push([fn, args]);
        return Promise.resolve({ data: null, error: null });
      },
      from: (t: string) => ({ table: t }),
    };
    const sb = briefClientAs(admin as never, "user-1") as unknown as {
      rpc: (fn: string, args?: unknown) => Promise<unknown>;
      from: (t: string) => unknown;
      auth: { getUser: () => Promise<{ data: { user: { id: string } } }> };
    };
    await sb.rpc("mcp_change_rows", { _job: "j" });
    expect(calls).toEqual([["mcp_brief_as_user", { _user: "user-1", _fn: "mcp_change_rows", _args: { _job: "j" } }]]);
    expect(sb.from("mcp_submittals")).toEqual({ table: "mcp_submittals" });
    expect(() => sb.from("mcp_open_items")).toThrow();
    expect(BRIEF_AS_USER_TABLES.has("mcp_companies")).toBe(false);
    expect((await sb.auth.getUser()).data.user.id).toBe("user-1");
  });

  it("ships off for everyone, service-role only, and runs only the brief's read functions", () => {
    const sql = readFileSync("supabase/migrations/20261106140000_athena_morning_brief_email.sql", "utf8");
    expect(sql).toContain("email_enabled boolean NOT NULL DEFAULT false");
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM public\.mcp_morning_brief_settings|cron\.schedule/i);
    for (const fn of ["mcp_morning_brief_email_candidates", "mcp_morning_brief_email_claim", "mcp_morning_brief_email_release", "mcp_morning_brief_email_sent", "mcp_brief_as_user"]) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM public, anon, authenticated`));
    }
    const asUser = sql.slice(sql.indexOf("FUNCTION public.mcp_brief_as_user"));
    expect(asUser).toContain("payment_application_read");
    expect(asUser).toContain("t NOT IN ('cpm', 'ior')");
    expect(asUser.match(/RETURN public\.(\w+)\(/g)).toEqual([
      "RETURN public.mcp_living_report_get(",
      "RETURN public.mcp_change_rows(",
      "RETURN public.mcp_buyout_get(",
      "RETURN public.mcp_billing_evidence_record(",
      "RETURN public.mcp_submittal_chase_due(",
    ]);
  });
});
