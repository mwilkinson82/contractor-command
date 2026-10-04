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
    const result = () => {
      if (insert) {
        writes.push(insert);
        return { data: null, error: null };
      }
      const rows = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
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
  });
