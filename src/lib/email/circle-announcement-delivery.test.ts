import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Row = Record<string, unknown>;
const m = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), send: vi.fn() }));
vi.mock("@lovable.dev/email-js", () => ({ sendLovableEmail: m.send }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => m }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/lib/resend/circle-sync", () => ({
  circleResendClient: () => {
    throw new Error("Unexpected Resend dependency");
  },
}));
import { processEmailQueues } from "./process-queue.server";
import { Route } from "@/routes/lovable/email/queue/process";

let tables: Record<string, Row[]>;
let state: string;
let failTable: string;
let failMembership: boolean;
let payload: Row;
let writes: Row[];
const email = "synthetic@example.test";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("LOVABLE_API_KEY", "synthetic-only");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-only");
  vi.stubEnv("VITE_SUPABASE_URL", "https://synthetic.example.test");
  state = "eligible";
  failTable = "";
  failMembership = false;
  writes = [];
  tables = {
    email_send_state: [{ send_delay_ms: 0 }],
    email_send_log: [],
    profiles: [{ id: "user", email }],
    subscriptions: [{ id: "sub", user_id: "user", email, tier: "circle" }],
    circle_owner_grants: [],
    circle_source_aliases: [],
    suppressed_emails: [],
    email_unsubscribe_tokens: [{ email, token: "synthetic-token", used_at: null }],
    member_announcements: [{ announcement_id: "announcement", audience: "circle" }],
  };
  payload = {
    message_id: "message",
    to: email,
    from: "Contractor Circle <members@example.test>",
    reply_to: "reply@example.test",
    sender_domain: "example.test",
    subject: "Approved recap",
    html: "<p>Approved recap</p>",
    text: "Approved recap",
    purpose: "transactional",
    label: "member-announcement",
    circle_membership_required: true,
    unsubscribe_token: "synthetic-token",
  };
  m.from.mockImplementation((table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let single = false;
    let insert: Row | undefined;
    let patch: Row | undefined;
    const result = () => {
      if (insert) {
        writes.push(insert);
        return { data: null, error: null };
      }
      const rows = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
      if (patch) {
        if (table === failTable) return { data: null, error: { message: "synthetic read failure" } };
        for (const row of rows) Object.assign(row, patch);
        writes.push({ table, op: "update", ...patch });
        return { data: rows.map((row) => ({ id: row.id })), error: null };
      }
      return {
        data: single ? (rows[0] ?? null) : rows,
        error: table === failTable ? { message: "synthetic read failure" } : null,
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
      is: (key: string, value: unknown) => {
        filters.push((row) => (value === null ? row[key] == null : row[key] === value));
        return chain;
      },
      ilike: (key: string, value: unknown) => {
        const expected = String(value).replace(/\\([%_\\])/g, "$1").toLowerCase();
        filters.push((row) => String(row[key] ?? "").toLowerCase() === expected);
        return chain;
      },
      filter: (key: string, _op: string, value: unknown) => {
        if (key === "metadata->>idempotency_key") {
          filters.push((row) => {
            const metadata = row.metadata;
            if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
            return (metadata as Row).idempotency_key === value;
          });
        }
        return chain;
      },
      limit: () => chain,
      update: (row: Row) => {
        patch = row;
        return chain;
      },
      single: () => {
        single = true;
        return chain;
      },
      maybeSingle: () => {
        single = true;
        return chain;
      },
      insert: (row: Row) => {
        insert = row;
        return chain;
      },
      then: (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return chain;
  });
  m.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === "get_circle_entitlement")
      return {
        data: { state, hasAccess: state === "eligible", reason: state },
        error: failMembership ? { message: "synthetic membership failure" } : null,
      };
    if (name === "read_email_batch")
      return {
        data:
          args.queue_name === "transactional_emails"
            ? [{ msg_id: 1, read_ct: 1, message: payload }]
            : [],
        error: null,
      };
    if (["delete_email", "move_to_dlq"].includes(name)) return { error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  m.send.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

const workers = {
  admin: () =>
    processEmailQueues({
      supabase: m as unknown as SupabaseClient<Database>,
      apiKey: "synthetic-only",
    }),
  http: async () => {
    const route = Route as unknown as {
      server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } };
    };
    const response = await route.server.handlers.POST({
      request: new Request("https://synthetic.example.test/lovable/email/queue/process", {
        method: "POST",
        headers: { Authorization: "Bearer synthetic-service-only" },
      }),
    });
    expect(response.status).toBe(200);
    return response.json();
  },
};
for (const [worker, run] of Object.entries(workers))
  describe(`${worker} Circle delivery`, () => {
    it.each(["canceled", "changed", "past", "unavailable"])(
      "withholds stale call session: %s",
      async (reason) => {
        const id = "11111111-1111-4111-8111-111111111111";
        payload.circle_session = { id, version: 1 };
        tables.circle_sessions = [
          {
            id,
            version: reason === "changed" ? 2 : 1,
            status: reason === "canceled" ? "canceled" : "scheduled",
            starts_at: reason === "past" ? "2000-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
            meeting_url: "https://meet.google.com/abc-defg-hij",
          },
        ];
        if (reason === "unavailable") failTable = "circle_sessions";
        await run();
        expect(m.send).not.toHaveBeenCalled();
      },
    );
    it("delivers through the existing branded Lovable path without Resend", async () => {
      await run();
      expect(m.send).toHaveBeenCalledTimes(1);
      expect(m.send.mock.calls[0][0]).toMatchObject({
        to: email,
        from: payload.from,
        reply_to: payload.reply_to,
        subject: payload.subject,
        html: payload.html,
        unsubscribe_token: "synthetic-token",
      });
      expect(writes).toContainEqual(expect.objectContaining({ status: "sent" }));
    });
    it.each(["ineligible", "review", "suppressed", "used_token"])(
      "withholds a queued message after %s changes despite its saved token",
      async (reason) => {
        if (reason === "suppressed")
          tables.suppressed_emails.push({ email, reason: "unsubscribe" });
        else if (reason === "used_token")
          tables.email_unsubscribe_tokens[0].used_at = new Date().toISOString();
        else state = reason;
        await run();
        expect(m.send).not.toHaveBeenCalled();
        expect(writes).toContainEqual(
          expect.objectContaining({ status: worker === "admin" ? "suppressed" : "dlq" }),
        );
      },
    );
    it.each(["membership", "suppression", "tokens"])(
      "retains a retryable failure when %s cannot be verified",
      async (reason) => {
        if (reason === "membership") failMembership = true;
        else
          failTable = reason === "suppression" ? "suppressed_emails" : "email_unsubscribe_tokens";
        await run();
        expect(m.send).not.toHaveBeenCalled();
        expect(writes).toContainEqual(expect.objectContaining({ status: "failed" }));
        expect(
          m.rpc.mock.calls.some(([name]) => ["delete_email", "move_to_dlq"].includes(name)),
        ).toBe(false);
      },
    );
    it("honors never-email rules at delivery", async () => {
      tables.profiles[0].full_name = "Synthetic Pro-Build";
      await run();
      expect(m.send).not.toHaveBeenCalled();
    });
    it("retains the existing retry behavior for Lovable delivery failures", async () => {
      m.send.mockRejectedValue(new Error("synthetic delivery unavailable"));
      await run();
      expect(writes).toContainEqual(
        expect.objectContaining({
          status: "failed",
          error_message: "synthetic delivery unavailable",
        }),
      );
      expect(
        m.rpc.mock.calls.some(([name]) => ["delete_email", "move_to_dlq"].includes(name)),
      ).toBe(false);
    });
    it("resolves legacy Circle entries through their saved announcement", async () => {
      delete payload.circle_membership_required;
      tables.email_send_log.push({
        message_id: "message",
        status: "pending",
        metadata: { announcement_id: "announcement" },
      });
      state = "ineligible";
      await run();
      expect(m.send).not.toHaveBeenCalled();
    });
    it("holds unknown legacy audience entries for review", async () => {
      delete payload.circle_membership_required;
      await run();
      expect(m.send).not.toHaveBeenCalled();
      expect(writes).toContainEqual(
        expect.objectContaining({
          status: "failed",
          error_message: "Legacy queued announcement requires audience review",
        }),
      );
    });
    it("preserves delivery for other announcement audiences", async () => {
      payload.circle_membership_required = false;
      state = "ineligible";
      await run();
      expect(m.send).toHaveBeenCalledTimes(1);
      expect(m.rpc.mock.calls.some(([name]) => name === "get_circle_entitlement")).toBe(false);
    });
    it.each([
      ["circle-welcome", "welcome_sent_at"],
      ["login-nudge", "login_nudge_sent_at"],
      ["discord-nudge", "discord_nudge_sent_at"],
    ] as const)("stamps %s after the provider accepts the send", async (label, column) => {
      payload.label = label;
      if (label === "circle-welcome") payload.idempotency_key = "circle-welcome-sub_missing";
      tables.subscriptions[0].stripe_subscription_id = "sub_real";
      tables.profiles[0].id = "11111111-1111-4111-8111-111111111111";
      tables.subscriptions[0].user_id = tables.profiles[0].id;
      await run();
      expect(m.send).toHaveBeenCalledTimes(1);
      expect(tables.subscriptions[0][column]).toEqual(expect.any(String));
      expect(writes).toContainEqual(expect.objectContaining({ status: "sent" }));
    });
    it("retries the stamp without sending again when the sent log already exists", async () => {
      payload.label = "circle-welcome";
      tables.email_send_log.push({
        message_id: "message",
        status: "sent",
        created_at: "2026-10-14T19:50:05.000Z",
      });
      await run();
      expect(m.send).not.toHaveBeenCalled();
      expect(tables.subscriptions[0].welcome_sent_at).toBe("2026-10-14T19:50:05.000Z");
    });
  });
