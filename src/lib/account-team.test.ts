import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  OWNER_ONLY_MESSAGE as PAGE_OWNER_ONLY,
  SEATS_COMING_SOON,
  TERMS_SENTENCE,
  TERMS_URL,
  addSeatsMessage,
  canApproveConnect,
  friendlyTeamError,
  inviteMember,
  inviteSavedMessage,
  loadAccountTeam,
  planLabel,
  planRate,
  recordTermsAcceptance,
  removeMember,
  roleUsesJobList,
  seatSummary,
  seatsLeft,
  updateMember,
  validateInvite,
  type AccountDb,
} from "./account-team";
import { OWNER_ONLY_MESSAGE } from "./mcp/tools/team-tools";

function fakeDb(
  rpcs: Record<string, { data?: unknown; error?: { message: string } | null }>,
  companies: unknown[] = [{ id: "c1", name: "Harbor" }],
  settings: unknown[] = [],
  settingsError: { message: string } | null = null,
) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const db: AccountDb = {
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      calls.push([fn, args]);
      const r = rpcs[fn] ?? {};
      return { data: r.data ?? null, error: r.error ?? null };
    }),
    from: (table) => ({
      select: async () => ({
        data: table === "mcp_user_settings" ? settings : companies,
        error: table === "mcp_user_settings" ? settingsError : null,
      }),
    }),
  };
  return { db, calls };
}
const seats = { tier: "circle", limit: 6, members: 3, pending: 1, extra_seats: 0 };

describe("plan line", () => {
  it("reads the real plan instead of a fixed label", () => {
    expect(planLabel("circle")).toBe("Contractor Circle");
    expect(planLabel("athena_pm")).toBe("Athena PM");
    expect(planLabel("athena_office")).toBe("Athena Office");
    expect(planLabel(null)).toBe("No Athena plan yet");
    expect(planRate("athena_office")).toBe("$397 / month");
    expect(planRate("circle")).toBeNull(); // comps and Circle rates vary, so no price is shown
  });
  it("shows seats used and limit", () => {
    expect(seatSummary(seats)).toBe("4 of 6 in use (1 pending)");
    expect(seatsLeft(seats)).toBe(2);
    expect(seatSummary({ ...seats, limit: null, pending: 0 })).toBe("3 in use");
  });
});

describe("add seats", () => {
  it("keeps the $49 price and never offers a payment link", () => {
    expect(SEATS_COMING_SOON).toContain("$49 per seat per month");
    expect(addSeatsMessage(false)).toMatch(/coming soon/);
    expect(addSeatsMessage(true)).toMatch(/ask Athena in chat/);
    for (const m of [addSeatsMessage(true), addSeatsMessage(false)])
      expect(m).not.toMatch(/stripe|checkout|https?:/i);
  });
});

describe("team writes use the same database functions as the chat tools", () => {
  it("loads the team only for owners", async () => {
    const owner = fakeDb({
      mcp_is_company_owner: { data: true },
      mcp_seat_usage: { data: seats },
      mcp_team_list: { data: { members: [], pending: [], jobs: [], seats, roles_allowed: null } },
    });
    const a = await loadAccountTeam(owner.db);
    expect(a.isOwner).toBe(true);
    expect(a.team).not.toBeNull();
    const member = fakeDb({
      mcp_is_company_owner: { data: false },
      mcp_seat_usage: { data: seats },
    });
    const b = await loadAccountTeam(member.db);
    expect(b.team).toBeNull();
    expect(member.calls.map((c) => c[0])).not.toContain("mcp_team_list");
    expect(b.seats?.tier).toBe("circle");
  });
  it("no company means nothing to manage", async () => {
    const { db } = fakeDb({}, []);
    expect((await loadAccountTeam(db)).companyId).toBeNull();
  });
  it("uses the saved accessible Athena company rather than the first membership", async () => {
    const { db, calls } = fakeDb(
      {},
      [
        { id: "aop", name: "AOP Construction" },
        { id: "alp", name: "ALP Construction" },
      ],
      [{ current_company: "alp" }],
    );
    expect(await loadAccountTeam(db)).toMatchObject({
      companyId: "alp",
      companyName: "ALP Construction",
    });
    expect(calls.every(([, args]) => args?._company === "alp")).toBe(true);
  });
  it("keeps an explicit accessible selection ahead of the saved selection", async () => {
    const { db, calls } = fakeDb(
      {},
      [
        { id: "a", name: "Harbor" },
        { id: "b", name: "Northline" },
      ],
      [{ current_company: "b" }],
    );
    expect((await loadAccountTeam(db, "a")).companyName).toBe("Harbor");
    expect(calls.every(([, args]) => args?._company === "a")).toBe(true);
  });
  it("never uses an inaccessible saved company for owner, seat or team calls", async () => {
    const { db, calls } = fakeDb(
      {},
      [{ id: "a", name: "Harbor" }],
      [{ current_company: "foreign" }],
    );
    expect((await loadAccountTeam(db)).companyId).toBe("a");
    expect(calls.every(([, args]) => args?._company === "a")).toBe(true);
  });
  it.each([[], [{ current_company: null }], [{ current_company: "deleted-company" }], [{}]])(
    "keeps an accessible fallback for a missing or stale saved selection: %j",
    async (...rows) => {
      const settings = rows as unknown[];
      const { db, calls } = fakeDb({}, [{ id: "a", name: "Harbor" }], settings);
      expect((await loadAccountTeam(db)).companyId).toBe("a");
      expect(calls.every(([, args]) => args?._company === "a")).toBe(true);
    },
  );
  it("uses the valid saved company when an explicit preference is inaccessible", async () => {
    const { db, calls } = fakeDb(
      {},
      [
        { id: "a", name: "Harbor" },
        { id: "b", name: "Northline" },
      ],
      [{ current_company: "b" }],
    );
    expect((await loadAccountTeam(db, "foreign")).companyId).toBe("b");
    expect(calls.every(([, args]) => args?._company === "b")).toBe(true);
  });
  it("keeps the existing accessible fallback if the settings read is unavailable", async () => {
    const { db, calls } = fakeDb(
      {},
      [{ id: "a", name: "Harbor" }],
      [{ current_company: "foreign" }],
      { message: "Unavailable" },
    );
    expect((await loadAccountTeam(db)).companyId).toBe("a");
    expect(calls.every(([, args]) => args?._company === "a")).toBe(true);
  });
  it("makes no owner, seat or team calls when there are no accessible companies", async () => {
    const { db, calls } = fakeDb({}, [], [{ current_company: "foreign" }]);
    expect((await loadAccountTeam(db)).companyId).toBeNull();
    expect(calls).toEqual([]);
  });
  it("rechecks owner scope when the accessible selection changes", async () => {
    const { db } = fakeDb({}, [
      { id: "a", name: "Harbor" },
      { id: "b", name: "Northline" },
    ]);
    const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => ({
      data:
        fn === "mcp_is_company_owner"
          ? args?._company === "a"
          : fn === "mcp_team_list"
            ? { members: [], pending: [], jobs: [], seats, roles_allowed: null }
            : seats,
      error: null,
    }));
    db.rpc = rpc;
    expect((await loadAccountTeam(db, "a")).isOwner).toBe(true);
    rpc.mockClear();
    const selected = await loadAccountTeam(db, "b");
    expect(selected).toMatchObject({ companyId: "b", isOwner: false, team: null });
    expect(rpc.mock.calls.every(([, args]) => args?._company === "b")).toBe(true);
    expect(rpc.mock.calls.some(([fn]) => fn === "mcp_team_list")).toBe(false);
  });
  it("invite drops job list for all-jobs roles and maps the seat-limit error", async () => {
    const { db, calls } = fakeDb({});
    await inviteMember(db, "c1", { email: "a@b.co", name: "Ana", role: "ap", jobs: ["2701"] });
    expect(calls[0]).toEqual([
      "mcp_team_invite",
      { _company: "c1", _email: "a@b.co", _display_name: "Ana", _role: "ap", _jobs: [] },
    ]);
    const full = fakeDb({ mcp_team_invite: { error: { message: "MCP_SEAT_LIMIT:6:6" } } });
    const r = await inviteMember(full.db, "c1", {
      email: "a@b.co",
      name: "Ana",
      role: "pm",
      jobs: [],
    });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("$49 per seat per month") });
  });
  it("update and remove pass owner checks through to the database", async () => {
    const { db, calls } = fakeDb({
      mcp_team_remove_member: { error: { message: "Only a company owner can do that" } },
    });
    await updateMember(db, "c1", "u2", "pm", ["2701"]);
    expect(calls[0]).toEqual([
      "mcp_team_update_member",
      { _company: "c1", _user: "u2", _role: "pm", _jobs: ["2701"] },
    ]);
    expect(await removeMember(db, "c1", { user: "u2" })).toEqual({
      ok: false,
      error: PAGE_OWNER_ONLY,
    });
  });
  it("owner-only wording matches the chat tool", () =>
    expect(PAGE_OWNER_ONLY).toBe(OWNER_ONLY_MESSAGE));
  it("validates invites and plan roles", () => {
    expect(validateInvite({ email: "x", name: "A", role: "pm", jobs: [] }, null)).toEqual({
      ok: false,
      error: "Enter a valid email.",
    });
    expect(
      validateInvite({ email: "a@b.co", name: "A", role: "super", jobs: [] }, ["owner", "pm"]),
    ).toEqual({ ok: false, error: "Super isn't included in your plan." });
    expect(validateInvite({ email: "a@b.co", name: "A", role: "Finance", jobs: [] }, null)).toEqual(
      { ok: true, role: "ap" },
    );
    expect(roleUsesJobList("pm")).toBe(true);
    expect(roleUsesJobList("owner")).toBe(false);
  });
  it("invite note says to sign in at app.meetathena.io and promises no email", () => {
    expect(inviteSavedMessage("Ana", "a@b.co")).toBe(
      "Ana is invited. Tell them to sign in at app.meetathena.io with a@b.co; they join your team the first time they sign in.",
    );
    expect(friendlyTeamError("weird")).not.toMatch(/MCP_|database|postgres/i);
  });
});

describe("connect Terms", () => {
  it("has the exact sentence and link", () => {
    expect(TERMS_SENTENCE).toBe(
      "I agree to the Terms and won't copy, extract or reverse engineer Athena.",
    );
    expect(TERMS_URL).toBe("https://meetathena.io/terms");
  });
  it("blocks approve until the box is ticked", () => {
    expect(canApproveConnect(true, false)).toBe(false);
    expect(canApproveConnect(false, true)).toBe(false);
    expect(canApproveConnect(true, true)).toBe(true);
  });
  it("records who/when through mcp_accept_terms and fails closed", async () => {
    const ok = fakeDb({});
    expect(await recordTermsAcceptance(ok.db, "auth-1", "UA")).toEqual({ ok: true });
    expect(ok.calls[0][0]).toBe("mcp_accept_terms");
    expect(ok.calls[0][1]).toMatchObject({
      _url: TERMS_URL,
      _context: "connect",
      _authorization: "auth-1",
    });
    const bad = fakeDb({ mcp_accept_terms: { error: { message: "x" } } });
    expect((await recordTermsAcceptance(bad.db, "a", null)).ok).toBe(false);
  });
  it("consent page wires the checkbox, link and save before approve", () => {
    const src = readFileSync("src/routes/oauth.consent.tsx", "utf8");
    expect(src).toContain("disabled={busy || !canApprove}");
    expect(src).toContain("recordTermsAcceptance(");
    expect(src.indexOf("recordTermsAcceptance(")).toBeLessThan(
      src.indexOf("decideAuthorization(authorization_id"),
    );
    expect(src).toContain("href={TERMS_URL}");
  });
});

describe("no vendor names on the new member-facing pieces", () => {
  it("team section, account page messages and consent copy stay clean", () => {
    const files = ["src/components/account/team-section.tsx", "src/lib/account-team.ts"];
    for (const f of files) {
      const visible = readFileSync(f, "utf8")
        .split("\n")
        .filter(
          (l) =>
            !l.trim().startsWith("//") &&
            !l.includes("import ") &&
            !l.includes("supabase as unknown as AccountDb"),
        )
        .join("\n");
      expect(visible, f).not.toMatch(/lovable|supabase|vercel|openai|stripe/i);
    }
  });
});

describe("privacy migration", () => {
  const sql = readFileSync(
    "supabase/migrations/20261022120000_athena_account_team_privacy_terms.sql",
    "utf8",
  );
  const rb = readFileSync(
    "supabase/rollbacks/20261022120000_athena_account_team_privacy_terms.rollback.sql",
    "utf8",
  );
  it("PM scope no longer trusts the job creator", () => {
    const pm = /WHEN m\.role = 'pm' THEN CASE WHEN ([^\n]+)/.exec(sql)![1];
    expect(pm).not.toContain("j.user_id = auth.uid()");
    expect(sql).toMatch(/WHEN m\.role IN \('owner','all_access','ap'\) THEN 'full'/);
  });
  it("adds restrictive guards on jobs and related tables", () => {
    for (const t of [
      "mcp_jobs",
      "mcp_answers",
      "mcp_item_events",
      "mcp_item_evidence",
      "mcp_carry_forwards",
    ])
      expect(sql).toMatch(new RegExp(`ON public\\.${t} AS RESTRICTIVE FOR SELECT`));
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.mcp_terms_acceptances");
  });
  it("rollback restores the creator clause and drops every new guard", () => {
    expect(rb).toContain("OR j.user_id = auth.uid()");
    const created = sql
      .match(/CREATE POLICY "[^"]+" ON public\.\w+/g)!
      .map((p) => p.replace("CREATE POLICY", "DROP POLICY IF EXISTS"));
    for (const p of created) expect(rb).toContain(p);
    expect(rb).toMatch(/^-- DROP TABLE IF EXISTS public\.mcp_terms_acceptances/m);
  });
});
