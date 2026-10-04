import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const m = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  states: {} as Record<string, { state: string; hasAccess: boolean; reason: string }>,
  writes: [] as { table: string; rows: Row[] }[],
  queue: [] as Row[],
  failTable: "",
  failWrite: "",
  failMembership: false,
  fetch: vi.fn(),
  send: vi.fn(),
  render: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  signedIn: [] as { email: string; last_sign_in_at: string }[],
  baseline: [] as { email: string; baselineState: string }[],
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let parse = (data: unknown) => data;
    const chain = {
      middleware: () => chain,
      inputValidator: (validator: typeof parse) => {
        parse = validator;
        return chain;
      },
      handler:
        (handler: (input: { context: { userId: string }; data: unknown }) => unknown) =>
        (input: { data: unknown }) =>
          handler({ context: { userId: "admin" }, data: parse(input.data) }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: m.from,
    rpc: m.rpc,
    auth: { admin: { listUsers: async () => ({ data: { users: m.signedIn }, error: null }) } },
  },
}));
vi.mock("@/lib/control-admin.functions", () => ({
  loadMemberControlRowsForAdmin: async () => m.baseline,
}));
vi.mock("@/lib/email-templates/registry", () => ({
  TEMPLATES: { "member-announcement": { component: () => null } },
}));
vi.mock("@react-email/components", () => ({ render: m.render }));
vi.mock("@lovable.dev/email-js", () => ({ sendLovableEmail: m.send }));
vi.mock("@/lib/resend/circle-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/resend/circle-sync")>();
  return {
    ...actual,
    circleResendClient: (key: string) => actual.circleResendClient(key, m.fetch, 0),
  };
});

import {
  previewReviewedCircleAnnouncement,
  previewMemberAnnouncementAudience,
  sendMemberAnnouncement,
} from "@/lib/announce.functions";
import { circleAnnouncementAllowed } from "./announcement-guard.server";

const ready = "ready@example.test",
  held = "hold@example.test",
  muted = "muted@example.test";
const input = {
  subject: "Weekly recap",
  headline: "This week",
  body: "Approved recap",
  audience: "circle" as const,
};
const preview = () => previewReviewedCircleAnnouncement({ data: { audience: "circle" } });
const review = (snapshot: Awaited<ReturnType<typeof preview>>) => ({
  snapshotHash: snapshot.snapshotHash,
  excludedReviewEmails: snapshot.reviewHolds.map((r) => r.email),
});
const decision = (state: string, reason = state) => ({
  state,
  reason,
  hasAccess: state !== "ineligible",
});
const logs = () => m.writes.filter((w) => w.table === "email_send_log").flatMap((w) => w.rows);
const addIdentity = (email: string, state = "eligible") => {
  m.tables.profiles.push({ id: email, email, full_name: "Synthetic Member" });
  m.tables.subscriptions.push({ id: email, user_id: email, email, tier: "circle" });
  m.states[email] = decision(state);
  m.tables.email_unsubscribe_tokens.push({ email, token: `token-${email}`, used_at: null });
};

beforeEach(() => {
  vi.clearAllMocks();
  m.tables = {
    user_roles: [{ user_id: "admin", role: "admin" }],
    profiles: [],
    subscriptions: [],
    circle_owner_grants: [],
    circle_source_aliases: [],
    suppressed_emails: [],
    email_unsubscribe_tokens: [],
  };
  m.states = {};
  m.writes = [];
  m.queue = [];
  m.failTable = "";
  m.failWrite = "";
  m.failMembership = false;
  m.signedIn = [];
  m.baseline = [];
  process.env.RESEND_API_KEY = "synthetic-test-only";
  m.fetch.mockImplementation(async () => new Response("{}", { status: 404 }));
  m.render.mockResolvedValue("approved-template-content");
  m.from.mockImplementation((table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let single = false;
    let writeRows: Row[] | undefined;
    const result = () => {
      if (writeRows) {
        m.writes.push({ table, rows: writeRows });
        return { data: null, error: m.failWrite === table ? { message: "write failure" } : null };
      }
      const rows = (m.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      return {
        data: single ? (rows[0] ?? null) : rows,
        error: m.failTable === table ? { message: "read failure" } : null,
      };
    };
    const chain = {
      select: () => chain,
      order: () => chain,
      range: () => chain,
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
        return chain;
      },
      in: (key: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[key]));
        return chain;
      },
      not: (key: string) => {
        filters.push((row) => row[key] != null);
        return chain;
      },
      maybeSingle: () => {
        single = true;
        return chain;
      },
      insert: (rows: Row | Row[]) => {
        writeRows = Array.isArray(rows) ? rows : [rows];
        return chain;
      },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return chain;
  });
  m.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === "get_circle_entitlement")
      return {
        data: m.states[String(args._email)] ?? decision("ineligible"),
        error: m.failMembership ? { message: "membership unavailable" } : null,
      };
    if (name === "enqueue_email") {
      m.queue.push(args.payload as Row);
      return { error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  addIdentity(ready);
  addIdentity(held, "review");
  addIdentity(muted);
  m.tables.suppressed_emails.push({ email: muted });
});

describe("admin-reviewed Circle announcement exclusions", () => {
  it("previews the exact verified, held and suppressed partitions using only reads", async () => {
    const snapshot = await preview();
    expect(snapshot.recipients.map((r) => r.email)).toEqual([ready]);
    expect(snapshot.reviewHolds).toEqual([{ email: held, userId: held, reason: "review" }]);
    expect(snapshot.suppressions).toEqual([
      { email: muted, userId: muted, reason: "hub_suppressed" },
    ]);
    expect(m.fetch).toHaveBeenCalledTimes(1);
    expect(m.fetch.mock.calls[0][1].method).toBe("GET");
    expect(m.writes).toEqual([]);
    expect(m.queue).toEqual([]);
    expect(m.send).not.toHaveBeenCalled();
  });
  it("preserves fail-closed behavior for old preview and send calls", async () => {
    await expect(
      previewMemberAnnouncementAudience({ data: { audience: "circle" } }),
    ).rejects.toThrow("membership review");
    await expect(sendMemberAnnouncement({ data: input })).rejects.toThrow("membership review");
    expect(m.writes).toEqual([]);
    expect(m.queue).toEqual([]);
  });
  it("queues only the reviewed verified recipient and audits exclusions without putting them in the email", async () => {
    const snapshot = await preview();
    const result = await sendMemberAnnouncement({
      data: { ...input, circleReview: review(snapshot) },
    });
    expect(result).toMatchObject({ queued: 1, failed: 0, total: 1 });
    expect(m.queue).toHaveLength(1);
    expect(m.queue[0]).toMatchObject({
      to: ready,
      from: "Contractor Circle <noreply@notify.mail.alpcontractorcircle.com>",
      label: "member-announcement",
      circle_membership_required: true,
    });
    expect(JSON.stringify(m.queue)).not.toContain(held);
    expect(JSON.stringify(m.queue)).not.toContain("review_holds");
    expect(
      logs()
        .filter((l) => l.status === "suppressed")
        .map((l) => l.recipient_email)
        .sort(),
    ).toEqual([held, muted]);
    const metadata = logs().find((l) => l.status === "pending")?.metadata as Row;
    expect(metadata.audience_review).toMatchObject({
      snapshot_hash: snapshot.snapshotHash,
      reviewed_by: "admin",
      selected_emails: [ready],
    });
    expect(m.send).not.toHaveBeenCalled();
    expect(
      m.writes.every((w) => ["member_announcements", "email_send_log"].includes(w.table)),
    ).toBe(true);
  });
  it.each(["missing", "extra", "duplicate", "hash"])(
    "rejects %s exclusions before any write",
    async (kind) => {
      const snapshot = await preview();
      const submitted = review(snapshot);
      if (kind === "missing") submitted.excludedReviewEmails = [];
      if (kind === "extra") submitted.excludedReviewEmails.push(ready);
      if (kind === "duplicate") submitted.excludedReviewEmails.push(held);
      if (kind === "hash") submitted.snapshotHash = "0".repeat(64);
      await expect(
        sendMemberAnnouncement({ data: { ...input, circleReview: submitted } }),
      ).rejects.toThrow("review the audience again");
      expect(m.writes).toEqual([]);
      expect(m.queue).toEqual([]);
    },
  );
  it.each(["expiry", "reversal", "new-recipient", "new-hold", "suppression", "hold-reason"])(
    "requires a new review after %s",
    async (change) => {
      const snapshot = await preview();
      if (change === "expiry") m.states[ready] = decision("ineligible", "expired");
      if (change === "reversal") m.states[ready] = decision("review", "payment_review_required");
      if (change === "new-recipient") addIdentity("new@example.test");
      if (change === "new-hold") addIdentity("new@example.test", "review");
      if (change === "suppression") m.tables.suppressed_emails.push({ email: ready });
      if (change === "hold-reason") m.states[held].reason = "changed_identity";
      await expect(
        sendMemberAnnouncement({ data: { ...input, circleReview: review(snapshot) } }),
      ).rejects.toThrow("review the audience again");
      expect(m.writes).toEqual([]);
      expect(m.queue).toEqual([]);
    },
  );
  it.each(["expired", "payment_reversed", "suppression"])(
    "withholds %s between snapshot verification and enqueue",
    async (reason) => {
      const snapshot = await preview();
      m.render.mockImplementation(async () => {
        if (reason === "suppression") m.tables.suppressed_emails.push({ email: ready });
        else m.states[ready] = decision(reason === "expired" ? "ineligible" : "review", reason);
        return "approved-template-content";
      });
      expect(
        await sendMemberAnnouncement({ data: { ...input, circleReview: review(snapshot) } }),
      ).toMatchObject({ queued: 0, suppressed: 1 });
      expect(m.queue).toEqual([]);
      expect(logs().find((l) => l.recipient_email === ready)?.status).toBe("suppressed");
    },
  );
  it("continues to guard a queued recipient when membership changes before delivery", async () => {
    const snapshot = await preview();
    await sendMemberAnnouncement({ data: { ...input, circleReview: review(snapshot) } });
    m.states[ready] = decision("ineligible", "paid_period_ended");
    expect(
      await circleAnnouncementAllowed({ from: m.from, rpc: m.rpc }, String(m.queue[0].to), {
        apiKey: "synthetic",
      }),
    ).toEqual({ allowed: false, reason: "paid_period_ended" });
  });
  it.each(["membership", "suppression", "provider", "credential"])(
    "fails the entire preview and send on %s errors",
    async (failure) => {
      const snapshot = await preview();
      if (failure === "membership") m.failMembership = true;
      if (failure === "suppression") m.failTable = "suppressed_emails";
      if (failure === "provider")
        m.fetch.mockImplementation(async () => new Response("{}", { status: 500 }));
      if (failure === "credential") delete process.env.RESEND_API_KEY;
      await expect(preview()).rejects.toThrow();
      await expect(
        sendMemberAnnouncement({ data: { ...input, circleReview: review(snapshot) } }),
      ).rejects.toThrow();
      expect(m.writes).toEqual([]);
      expect(m.queue).toEqual([]);
    },
  );
  it("records a failure instead of a suppression if the final guard cannot verify the provider", async () => {
    const snapshot = await preview();
    m.render.mockImplementation(async () => {
      m.fetch.mockRejectedValue(new Error("provider unavailable"));
      return "content";
    });
    expect(
      await sendMemberAnnouncement({ data: { ...input, circleReview: review(snapshot) } }),
    ).toMatchObject({ queued: 0, failed: 1, suppressed: 0 });
    expect(logs().find((l) => l.recipient_email === ready)).toMatchObject({
      status: "failed",
      error_message: "provider unavailable",
    });
    expect(m.queue).toEqual([]);
  });
  it.each(["member_announcements", "email_send_log"])(
    "does not enqueue when %s audit cannot persist",
    async (table) => {
      const snapshot = await preview();
      m.failWrite = table;
      await expect(
        sendMemberAnnouncement({ data: { ...input, circleReview: review(snapshot) } }),
      ).rejects.toThrow();
      expect(m.queue).toEqual([]);
    },
  );
  it("requires admin access for detailed preview and reviewed send", async () => {
    const snapshot = await preview();
    m.tables.user_roles = [];
    await expect(preview()).rejects.toThrow("Forbidden");
    await expect(
      sendMemberAnnouncement({ data: { ...input, circleReview: review(snapshot) } }),
    ).rejects.toThrow("Forbidden");
    expect(m.writes).toEqual([]);
  });
  it("binds campaign filters into the review hash while keeping holds visible", async () => {
    const snapshot = await preview();
    m.signedIn = [{ email: ready, last_sign_in_at: "2026-01-01" }];
    const inactive = await previewReviewedCircleAnnouncement({
      data: { audience: "circle_inactive" },
    });
    expect(inactive.count).toBe(0);
    expect(inactive.reviewHolds).toEqual(snapshot.reviewHolds);
    expect(inactive.snapshotHash).not.toBe(snapshot.snapshotHash);
    m.baseline = [{ email: ready, baselineState: "missing" }];
    const baseline = await previewReviewedCircleAnnouncement({
      data: { audience: "control_baseline" },
    });
    expect(baseline.count).toBe(1);
    expect(baseline.snapshotHash).not.toBe(snapshot.snapshotHash);
  });
  it("keeps the hash stable when database row order changes", async () => {
    const snapshot = await preview();
    m.tables.subscriptions.reverse();
    expect((await preview()).snapshotHash).toBe(snapshot.snapshotHash);
  });
  it("treats a provider unsubscribe as a suppression without altering membership", async () => {
    m.fetch.mockImplementation(
      async () => new Response(JSON.stringify({ id: "contact", unsubscribed: true })),
    );
    const snapshot = await preview();
    expect(snapshot.count).toBe(0);
    expect(snapshot.suppressions).toContainEqual({
      email: ready,
      userId: ready,
      reason: "resend_unsubscribed",
    });
    expect(m.states[ready].state).toBe("eligible");
    expect(m.writes).toEqual([]);
  });
  it("rejects a malformed provider response instead of assuming delivery permission", async () => {
    m.fetch.mockImplementation(async () => new Response(JSON.stringify({ id: "contact" })));
    await expect(preview()).rejects.toThrow("Cannot verify Resend contact suppression");
    expect(m.writes).toEqual([]);
  });
  it("does not enqueue if the final recipient audit fails when there are no exclusions", async () => {
    m.states[held] = decision("ineligible");
    m.states[muted] = decision("ineligible");
    const snapshot = await preview();
    m.failWrite = "email_send_log";
    expect(
      await sendMemberAnnouncement({ data: { ...input, circleReview: review(snapshot) } }),
    ).toMatchObject({ queued: 0, failed: 1 });
    expect(m.queue).toEqual([]);
  });
  it("includes paid unclaimed destinations and omits definitively ineligible identities", async () => {
    m.tables.profiles = m.tables.profiles.filter((p) => p.email !== ready);
    m.tables.subscriptions.find((s) => s.email === ready)!.user_id = null;
    addIdentity("expired@example.test", "ineligible");
    const snapshot = await preview();
    expect(snapshot.recipients).toEqual([{ email: ready, userId: null, firstName: null }]);
    expect(JSON.stringify(snapshot)).not.toContain("expired@example.test");
  });
});
