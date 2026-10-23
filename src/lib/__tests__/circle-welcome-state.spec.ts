import { describe, expect, it, vi } from "vitest";
import {
  CIRCLE_WELCOME_TEMPLATE,
  circleWelcomeIdempotencyKey,
  emailSendLogMetadata,
  ilikeExact,
  isUniqueViolation,
  stampMembershipEmailSent,
  stripeSubscriptionIdFromCircleWelcomeKey,
} from "@/lib/email/circle-welcome-state";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

describe("circle welcome send-state helpers", () => {
  it("builds and parses the Stripe subscription idempotency key", () => {
    expect(circleWelcomeIdempotencyKey("sub_1UFu4NJdDAUSVXbNypl54dXg")).toBe(
      "circle-welcome-sub_1UFu4NJdDAUSVXbNypl54dXg",
    );
    expect(
      stripeSubscriptionIdFromCircleWelcomeKey("circle-welcome-sub_1UFu4NJdDAUSVXbNypl54dXg"),
    ).toBe("sub_1UFu4NJdDAUSVXbNypl54dXg");
  });

  it("does not treat admin/backfill keys as Stripe subscription ids", () => {
    expect(
      stripeSubscriptionIdFromCircleWelcomeKey("circle-welcome-backfill-dalton@wtcelectric.com"),
    ).toBeNull();
    expect(
      stripeSubscriptionIdFromCircleWelcomeKey("circle-welcome-admin-dalton@wtcelectric.com-1"),
    ).toBeNull();
    expect(stripeSubscriptionIdFromCircleWelcomeKey("magic-link-sub_x")).toBeNull();
    expect(
      stripeSubscriptionIdFromCircleWelcomeKey("circle-welcome-luis.a@infinitycontractor.net"),
    ).toBeNull();
  });

  it("escapes LIKE wildcards in an email", () => {
    expect(ilikeExact("a_b%@example.com")).toBe("a\\_b\\%@example.com");
  });

  it("copies idempotency_key onto the sent log metadata", () => {
    expect(
      emailSendLogMetadata({
        idempotencyKey: "circle-welcome-sub_1",
        queue: "transactional_emails",
      }),
    ).toEqual({
      idempotency_key: "circle-welcome-sub_1",
      queue: "transactional_emails",
    });
    expect(emailSendLogMetadata({})).toBeNull();
  });

  it("detects unique-constraint races as duplicates", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ message: "duplicate key value violates unique constraint" })).toBe(
      true,
    );
    expect(isUniqueViolation({ code: "42501", message: "permission denied" })).toBe(false);
  });

  it("keeps the hub mailer template name stable", () => {
    expect(CIRCLE_WELCOME_TEMPLATE).toBe("circle-welcome");
  });
});

type Row = Record<string, unknown>;

function stampClient(tables: Record<string, Row[]>) {
  const filtersSeen: { table: string; op: string; filters: { op: string; key: string; value: unknown }[] }[] =
    [];
  const client = {
    from(table: string) {
      const filters: { op: string; key: string; value: unknown }[] = [];
      let patch: Row | null = null;
      let single = false;
      const matches = () =>
        (tables[table] ?? []).filter((row) =>
          filters.every((filter) => {
            const cell = row[filter.key];
            if (filter.op === "eq") return cell === filter.value;
            if (filter.op === "is") return filter.value === null ? cell == null : cell === filter.value;
            if (filter.op === "ilike") {
              const expected = String(filter.value).replace(/\\([%_\\])/g, "$1").toLowerCase();
              return String(cell ?? "").toLowerCase() === expected;
            }
            return false;
          }),
        );
      const chain = {
        select: () => chain,
        update: (row: Row) => {
          patch = row;
          return chain;
        },
        eq: (key: string, value: unknown) => {
          filters.push({ op: "eq", key, value });
          return chain;
        },
        is: (key: string, value: unknown) => {
          filters.push({ op: "is", key, value });
          return chain;
        },
        ilike: (key: string, value: unknown) => {
          filters.push({ op: "ilike", key, value });
          return chain;
        },
        limit: () => chain,
        maybeSingle: () => {
          single = true;
          return chain;
        },
        then: (resolve: (value: unknown) => unknown) => {
          filtersSeen.push({ table, op: patch ? "update" : "select", filters: [...filters] });
          const rows = matches();
          if (patch) {
            for (const row of rows) Object.assign(row, patch);
            return Promise.resolve({ data: rows.map((row) => ({ id: row.id })), error: null }).then(resolve);
          }
          return Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(resolve);
        },
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, filtersSeen, tables };
}

const memberId = "11111111-1111-4111-8111-111111111111";

describe("stampMembershipEmailSent", () => {
  it("falls through to email when the Stripe id matches no row", async () => {
    const db = stampClient({
      profiles: [{ id: memberId, email: "luis.a@infinitycontractor.net" }],
      subscriptions: [
        {
          id: "row",
          email: "Luis.A@infinitycontractor.net",
          user_id: memberId,
          stripe_subscription_id: "sub_real",
          welcome_sent_at: null,
        },
      ],
    });
    const result = await stampMembershipEmailSent({
      supabase: db.client,
      templateName: "circle-welcome",
      recipientEmail: "luis.a@infinitycontractor.net",
      idempotencyKey: "circle-welcome-sub_missing",
      sentAt: "2026-10-14T19:50:05.000Z",
    });
    expect(result).toEqual({ stamped: 1, error: null });
    expect(db.tables.subscriptions[0].welcome_sent_at).toBe("2026-10-14T19:50:05.000Z");
    expect(
      db.filtersSeen.some(
        (call) =>
          call.op === "update" &&
          call.filters.some((filter) => filter.key === "stripe_subscription_id" && filter.value === "sub_missing"),
      ),
    ).toBe(true);
  });

  it("stamps login and discord nudges by user id when the subscription email differs", async () => {
    const db = stampClient({
      profiles: [{ id: memberId, email: "member@example.com" }],
      subscriptions: [
        {
          id: "row",
          email: "billing@example.com",
          user_id: memberId,
          login_nudge_sent_at: null,
          discord_nudge_sent_at: null,
        },
      ],
    });
    const login = await stampMembershipEmailSent({
      supabase: db.client,
      templateName: "login-nudge",
      recipientEmail: "member@example.com",
      sentAt: "2026-10-01T00:00:00.000Z",
    });
    const discord = await stampMembershipEmailSent({
      supabase: db.client,
      templateName: "discord-nudge",
      recipientEmail: "member@example.com",
      sentAt: "2026-10-02T00:00:00.000Z",
    });
    expect(login.stamped).toBe(1);
    expect(discord.stamped).toBe(1);
    expect(db.tables.subscriptions[0].login_nudge_sent_at).toBe("2026-10-01T00:00:00.000Z");
    expect(db.tables.subscriptions[0].discord_nudge_sent_at).toBe("2026-10-02T00:00:00.000Z");
  });

  it("does not overwrite a stamp that is already set", async () => {
    const db = stampClient({
      profiles: [],
      subscriptions: [
        {
          id: "row",
          email: "member@example.com",
          welcome_sent_at: "2026-10-14T19:50:05.000Z",
        },
      ],
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await stampMembershipEmailSent({
      supabase: db.client,
      templateName: "circle-welcome",
      recipientEmail: "member@example.com",
      sentAt: "2026-10-22T00:00:00.000Z",
    });
    expect(result).toEqual({ stamped: 0, error: null });
    expect(db.tables.subscriptions[0].welcome_sent_at).toBe("2026-10-14T19:50:05.000Z");
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("leaves sign-in mail alone", async () => {
    const db = stampClient({
      profiles: [],
      subscriptions: [{ id: "row", email: "member@example.com", login_nudge_sent_at: null }],
    });
    const result = await stampMembershipEmailSent({
      supabase: db.client,
      templateName: "magic-link",
      recipientEmail: "member@example.com",
    });
    expect(result).toEqual({ stamped: 0, error: null });
    expect(db.tables.subscriptions[0].login_nudge_sent_at).toBeNull();
    expect(db.filtersSeen).toEqual([]);
  });

  it("escapes underscore addresses so the email match stays exact", async () => {
    const db = stampClient({
      profiles: [],
      subscriptions: [{ id: "row", email: "a_b@example.com", welcome_sent_at: null }],
    });
    await stampMembershipEmailSent({
      supabase: db.client,
      templateName: "circle-welcome",
      recipientEmail: "a_b@example.com",
      sentAt: "2026-10-14T19:50:05.000Z",
    });
    expect(db.tables.subscriptions[0].welcome_sent_at).toBe("2026-10-14T19:50:05.000Z");
    expect(
      db.filtersSeen.some((call) =>
        call.filters.some((filter) => filter.op === "ilike" && filter.value === "a\\_b@example.com"),
      ),
    ).toBe(true);
  });
});
