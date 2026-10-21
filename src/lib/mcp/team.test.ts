import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// Fake database that mirrors the migration's rules: owner-only, seat cap counting pending invites, team audit rows.
const db = vi.hoisted(() => ({
  caller: "owner-1",
  limit: 6 as number | null,
  members: [] as { user_id: string; display_name: string; role: string; email: string; jobs: string[] }[],
  pending: [] as { email: string; display_name: string; role: string; invited_at: string }[],
  audit: [] as { actor: string; target: string | null; action: string; before: unknown; after: unknown; at: string }[],
  rpcs: [] as string[],
}));
const CO = "11111111-1111-4111-8111-111111111111";
const isOwner = () => db.members.some((m) => m.user_id === db.caller && m.role === "owner");
const ownerErr = { message: "MCP_BAD:Only a company owner can manage the team. Ask your owner to make this change." };
const snap = (u: string) => { const m = db.members.find((x) => x.user_id === u); return m ? { role: m.role, display_name: m.display_name, jobs: m.jobs } : null; };
const log = (target: string | null, action: string, before: unknown, after: unknown) => db.audit.push({ actor: db.caller, target, action, before, after, at: new Date().toISOString() });
function fakeSb() {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { name: "ALP Construction" }, error: null }) };
  return {
    from: () => q,
    rpc: async (f: string, a: Record<string, unknown>) => {
      db.rpcs.push(f);
      if (f === "mcp_is_company_owner") return { data: isOwner(), error: null };
      if (!isOwner() && f.startsWith("mcp_team_")) return { data: null, error: ownerErr };
      if (f === "mcp_team_list") return { data: { members: db.members.map((m) => ({ ...m, locked: false })), pending: db.pending, jobs: [{ job_number: "2701", name: "Harbor", restricted: false }], seats: { tier: "circle", limit: db.limit, members: db.members.length, pending: db.pending.length }, roles_allowed: null }, error: null };
      if (f === "mcp_team_invite") {
        const used = db.members.length + db.pending.length;
        if (db.limit != null && used >= db.limit) return { data: null, error: { message: `MCP_SEAT_LIMIT:${used}:${db.limit}` } };
        db.pending.push({ email: String(a._email), display_name: String(a._display_name), role: String(a._role), invited_at: "2026-10-21" });
        log(null, "invite", null, { role: a._role, jobs: a._jobs });
        return { data: { id: "inv1", role: a._role, seats_used: used + 1, seat_limit: db.limit }, error: null };
      }
      if (f === "mcp_team_update_member") {
        const b = snap(String(a._user)); const m = db.members.find((x) => x.user_id === a._user)!;
        if (a._role) m.role = String(a._role); if (a._jobs) m.jobs = a._jobs as string[];
        log(m.user_id, "update", b, snap(m.user_id));
        return { data: { before: b, after: snap(m.user_id) }, error: null };
      }
      if (f === "mcp_team_remove_member") {
        const b = snap(String(a._user)); db.members = db.members.filter((x) => x.user_id !== a._user); log(String(a._user), "remove", b, null);
        return { data: { before: b }, error: null };
      }
      return { data: null, error: null };
    },
  };
}
vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) => fn(fakeSb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
}));
vi.mock("./jobs", () => ({ resolveCompany: async () => CO }));
vi.mock("./visible", () => ({ guide: (r: Record<string, unknown>, ...g: string[]) => ({ ...r, guidance: g }) }));
const sends = vi.hoisted(() => [] as unknown[]);
vi.mock("./team-invite-email", async (orig) => {
  const real = await orig<typeof import("./team-invite-email")>();
  return { ...real, sendInvite: async (m: unknown) => { sends.push(m); return real.sendInvite(m as never, { env: {}, sender: async () => { throw new Error("must not send"); } }); } };
});

import { teamAddSeats, teamInvite, teamList, teamRemoveMember, teamUpdateMember, OWNER_ONLY_MESSAGE } from "./tools/team-tools";
import { PLAN_ROLES, planAllowsRole, normalizeRole, renderTeamList, seatLimitFromError, TEAM_WIDGET_URI, teamWidgetHtml } from "./team";
import { buildInviteEmail } from "./team-invite-email";
const { sendInvite } = await vi.importActual<typeof import("./team-invite-email")>("./team-invite-email");
type R = { content: { type: string; text?: string }[]; structuredContent: Record<string, unknown>; guidance: string[]; _meta?: Record<string, unknown> };
const call = (t: unknown, a: Record<string, unknown>) => (t as { handler: (a: unknown, c: unknown) => Promise<R> }).handler(a, {});
const MIG = readFileSync("supabase/migrations/20261021190000_athena_team_invites.sql", "utf8");

beforeEach(() => {
  db.caller = "owner-1"; db.limit = 6; db.audit = []; db.pending = []; db.rpcs = []; sends.length = 0;
  db.members = [
    { user_id: "owner-1", display_name: "Marshall", role: "owner", email: "owner@example.test", jobs: [] },
    { user_id: "super-1", display_name: "Sam", role: "super", email: "sam@example.test", jobs: ["2701"] },
  ];
});

describe("roles", () => {
  it("Finance is an input alias for AP", () => {
    expect(normalizeRole("finance")).toBe("ap");
    expect(normalizeRole("Accounts Payable")).toBe("ap");
    expect(normalizeRole("AP")).toBe("ap");
    expect(normalizeRole("wizard")).toBeNull();
  });
  it("migration renames finance rows to ap and keeps an alias trigger", () => {
    expect(MIG).toMatch(/UPDATE public\.mcp_company_members SET role = 'ap' WHERE role = 'finance'/);
    expect(MIG).toMatch(/WHEN 'finance' THEN 'ap'/);
    expect(MIG).toMatch(/WHEN m\.role IN \('owner','all_access','ap'\) THEN 'full'/);
  });
  it("Hardcore gets every role; locked roles read nothing", () => {
    expect(MIG).toMatch(/\('hardcore',\s+5, ARRAY\['owner','pm','all_access','ap','estimating','contracts','super'\]/);
    expect(MIG).toMatch(/WHEN NOT public\.mcp_role_allowed\(j\.company_id, m\.role\) THEN NULL/);
    expect(MIG).not.toMatch(/DELETE FROM public\.mcp_company_members WHERE[^;]*role_allowed/);
  });
});

describe("roles by plan", () => {
  it("Circle and Hardcore get every role", () => {
    for (const t of ["circle", "hardcore"]) for (const r of ["owner", "pm", "all_access", "ap", "estimating", "contracts", "super"] as const) expect(planAllowsRole(t, r), `${t}/${r}`).toBe(true);
  });
  it("PM plan: PM only (owner always allowed)", () => {
    expect(planAllowsRole("athena_pm", "owner")).toBe(true);
    expect(planAllowsRole("athena_pm", "pm")).toBe(true);
    for (const r of ["ap", "estimating", "contracts", "all_access", "super"] as const) expect(planAllowsRole("athena_pm", r), r).toBe(false);
  });
  it("Office plan: PM, Contracts, Estimating, AP; no All-access; Super open (disabled)", () => {
    for (const r of ["owner", "pm", "contracts", "estimating", "ap"] as const) expect(planAllowsRole("athena_office", r), r).toBe(true);
    expect(planAllowsRole("athena_office", "all_access")).toBe(false);
    expect(planAllowsRole("athena_office", "super")).toBe(false);
  });
  it("the migration's plan rows match PLAN_ROLES and the database owner rule", () => {
    for (const [tier, roles] of Object.entries(PLAN_ROLES)) {
      const row = new RegExp(`\\('${tier}',\\s+5, ARRAY\\[([^\\]]*)\\]`).exec(MIG);
      expect(row, tier).not.toBeNull();
      expect(row![1].replace(/'/g, "").split(",").sort()).toEqual([...roles].sort());
    }
    expect(MIG).toMatch(/SELECT _role = 'owner' OR/);
    expect(MIG).toMatch(/Super: OPEN, MARSHALL TO DECIDE/);
  });
});

describe("owner-only", () => {
  it("non-owners are refused by every team tool", async () => {
    db.caller = "super-1";
    await expect(call(teamList, {})).rejects.toThrow(OWNER_ONLY_MESSAGE);
    await expect(call(teamInvite, { email: "x@example.test", name: "X", role: "pm", confirmed: true })).rejects.toThrow(OWNER_ONLY_MESSAGE);
    await expect(call(teamUpdateMember, { person: "Sam", role: "pm", confirmed: true })).rejects.toThrow(OWNER_ONLY_MESSAGE);
    await expect(call(teamRemoveMember, { person: "Sam", confirmed: true })).rejects.toThrow(OWNER_ONLY_MESSAGE);
    await expect(call(teamAddSeats, { seats: 1, confirmed: true })).rejects.toThrow(OWNER_ONLY_MESSAGE);
    expect(db.audit).toHaveLength(0);
  });
  it("every team write function checks the owner in the database", () => {
    for (const fn of ["mcp_team_invite", "mcp_team_update_member", "mcp_team_remove_member", "mcp_team_list"]) {
      const body = MIG.slice(MIG.indexOf(`FUNCTION public.${fn}(`)).split("END $$;")[0];
      expect(body, fn).toMatch(/mcp_team_assert_owner\(_company\)/);
    }
    expect(MIG).toMatch(/ALTER TABLE public\.mcp_team_invites ENABLE ROW LEVEL SECURITY/);
    expect(MIG).toMatch(/ALTER TABLE public\.mcp_team_audit ENABLE ROW LEVEL SECURITY/);
    expect(MIG).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.mcp_team_invites, public\.mcp_team_audit/);
  });
  it("writes require confirmed true", async () => {
    await expect(call(teamInvite, { email: "x@example.test", name: "X", role: "pm", confirmed: false })).rejects.toThrow(/Confirm/);
    await expect(call(teamRemoveMember, { person: "Sam", confirmed: false })).rejects.toThrow(/Confirm/);
    expect(db.rpcs).not.toContain("mcp_team_invite");
  });
});

describe("audit rows", () => {
  it("invite, update and remove each log actor, target, before and after", async () => {
    await call(teamInvite, { email: "new@example.test", name: "Nia", role: "finance", job_numbers: ["2701"], confirmed: true });
    await call(teamUpdateMember, { person: "Sam", role: "pm", job_numbers: ["2701"], confirmed: true });
    await call(teamRemoveMember, { person: "Sam", confirmed: true });
    expect(db.audit.map((a) => a.action)).toEqual(["invite", "update", "remove"]);
    expect(db.audit.every((a) => a.actor === "owner-1" && a.at)).toBe(true);
    expect(db.audit[0].after).toMatchObject({ role: "ap" });
    expect(db.audit[1]).toMatchObject({ target: "super-1", before: { role: "super" }, after: { role: "pm" } });
    expect(db.audit[2]).toMatchObject({ target: "super-1", before: { role: "pm" }, after: null });
  });
  it("the migration logs before/after in every write function", () => {
    expect(MIG).toMatch(/mcp_team_log\(_company, _user, NULL, 'update', b, a\)/);
    expect(MIG).toMatch(/mcp_team_log\(_company, _user, NULL, 'remove', b, NULL\)/);
    expect(MIG).toMatch(/mcp_team_log\(_company, NULL, em, 'invite'/);
    expect(MIG).toMatch(/actor uuid NOT NULL,[\s\S]*before jsonb,\s*after jsonb,\s*created_at/);
  });
});

describe("seats", () => {
  it("at the cap the invite isn't sent and the owner is offered seats", async () => {
    db.limit = 2;
    const r = await call(teamInvite, { email: "new@example.test", name: "Nia", role: "pm", confirmed: true });
    expect(r.structuredContent).toMatchObject({ invited: false, seat_limit_reached: true, seats_used: 2, seat_limit: 2 });
    expect(r.content[0].text).toMatch(/seat limit \(2 of 2/);
    expect(r.content[0].text).toMatch(/\$49 per seat per month/);
    expect(sends).toHaveLength(0);
    expect(db.pending).toHaveLength(0);
  });
  it("pending invites count toward the cap", async () => {
    db.limit = 3;
    await call(teamInvite, { email: "a@example.test", name: "A", role: "pm", confirmed: true });
    const r = await call(teamInvite, { email: "b@example.test", name: "B", role: "pm", confirmed: true });
    expect(r.structuredContent.seat_limit_reached).toBe(true);
    expect(db.pending.map((p) => p.email)).toEqual(["a@example.test"]);
  });
  it("database counts members + pending under a lock; Circle = owner + 5 by default", () => {
    expect(MIG).toMatch(/used := \(u->>'members'\)::int \+ \(u->>'pending'\)::int/);
    expect(MIG).toMatch(/pg_advisory_xact_lock/);
    expect(MIG).toMatch(/\('circle',\s+5,/);
    expect(MIG).toMatch(/'limit', \(SELECT 1 \+ coalesce\(/);
    expect(seatLimitFromError("MCP_SEAT_LIMIT:6:6")).toEqual({ used: 6, limit: 6 });
  });
  it("add seats is off by default: no checkout", async () => {
    const r = await call(teamAddSeats, { seats: 2, confirmed: true });
    expect(r.structuredContent.checkout).toBeNull();
  });
});

describe("hosts", () => {
  it("team_list gives a numbered list; the ChatGPT card rides only in _meta (no HTML in other hosts)", async () => {
    const r = await call(teamList, {});
    expect(r.content[0].text).toMatch(/1\. Marshall, Owner, all jobs/);
    expect(r.content[0].text).toMatch(/2\. Sam, Super, jobs 2701/);
    expect(r._meta?.["openai/outputTemplate"]).toBe(TEAM_WIDGET_URI);
    // 0.8.16.1 / #116: the card HTML is no longer attached as a content block, so it can't leak into non-ChatGPT hosts.
    expect(r.content).toHaveLength(1);
    expect(JSON.stringify(r.content)).not.toMatch(/<html|<!doctype|<script/i);
    expect(r.guidance.join(" ")).toMatch(/Claude, Codex, Grok Bot/);
  });
  it("the card has checkboxes for jobs and a confirm step that passes confirmed true", () => {
    const h = teamWidgetHtml();
    expect(h).toContain('type="checkbox" name="j"');
    expect(h).toContain("Yes, make this change");
    expect(h).toContain("confirmed:true");
    expect(h).not.toMatch(/#DC2626/i);
  });
  it("list text never shows 'finance'", () => {
    const t = renderTeamList({ members: [{ user_id: "u", display_name: "Al", role: "ap", locked: true, jobs: [] }], pending: [], jobs: [], seats: { tier: "circle", limit: 6, members: 1, pending: 0 }, roles_allowed: null });
    expect(t).toMatch(/AP \(Accounts Payable\)/);
    expect(t).toMatch(/locked/);
    expect(t.toLowerCase()).not.toContain("finance");
  });
});

describe("invite email", () => {
  it("is off by default and never calls the sender", async () => {
    const sender = vi.fn(async () => ({ id: "x" }));
    const m = buildInviteEmail({ to: "nia@example.test", inviteeName: "Nia", ownerName: "Marshall", companyName: "ALP Construction", roleLabel: "PM" }, {});
    expect(await sendInvite(m, { env: {}, sender })).toBe("off");
    expect(sender).not.toHaveBeenCalled();
  });
  it("with the flag on, uses the stub sender and points at app.meetathena.io", async () => {
    const sender = vi.fn(async () => ({ id: "x" }));
    const m = buildInviteEmail({ to: "nia@example.test", inviteeName: "Nia", ownerName: "Marshall", companyName: "ALP <Co>", roleLabel: "PM" }, {});
    expect(await sendInvite(m, { env: { ATHENA_INVITE_EMAIL_ENABLED: "true" }, sender })).toBe("sent");
    expect(sender).toHaveBeenCalledOnce();
    expect(m.from).toMatch(/@meetathena\.io/);
    expect(m.text).toContain("https://app.meetathena.io/login");
    expect(m.html).toContain("ALP &lt;Co&gt;");
  });
});
