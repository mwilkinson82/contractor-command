import { describe, expect, it, vi } from "vitest";
import { applyUserComped, splitPersonName } from "@/lib/admin-comp";
import type { CompSubscriptionClient, SyncCompedResend } from "@/lib/admin-comp";

function mockSubscriptions(opts?: {
  updateError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  const updates: Array<{ row: Record<string, unknown>; id: string }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const client: CompSubscriptionClient = {
    from: (table) => {
      if (table !== "subscriptions") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        update: (row) => ({
          eq: async (column, value) => {
            updates.push({ row, id: String(value) });
            expect(column).toBe("id");
            return { error: opts?.updateError ?? null };
          },
        }),
        insert: async (row) => {
          inserts.push(row);
          return { error: opts?.insertError ?? null };
        },
      };
    },
  };
  return { client, updates, inserts };
}

describe("splitPersonName", () => {
  it("splits a first and last name", () => {
    expect(splitPersonName("Marshall Wilkinson")).toEqual({
      firstName: "Marshall",
      lastName: "Wilkinson",
    });
  });

  it("returns nulls when empty", () => {
    expect(splitPersonName(null)).toEqual({ firstName: null, lastName: null });
    expect(splitPersonName("   ")).toEqual({ firstName: null, lastName: null });
  });
});

describe("applyUserComped", () => {
  it("updates an existing row and attempts Resend circle sync when granting", async () => {
    const { client, updates, inserts } = mockSubscriptions();
    const syncResend = vi.fn<SyncCompedResend>(async (input) => ({
      ok: true,
      contactId: "contact_comp",
      segment: "circle",
    }));

    const result = await applyUserComped(
      {
        subscriptionId: "11111111-1111-1111-1111-111111111111",
        userId: "22222222-2222-2222-2222-222222222222",
        email: "comped@example.com",
        fullName: "Pat Rivera",
        isComped: true,
      },
      { supabase: client, syncResend },
    );

    expect(result.ok).toBe(true);
    expect(updates).toEqual([
      {
        row: { is_comped: true, status: "active" },
        id: "11111111-1111-1111-1111-111111111111",
      },
    ]);
    expect(inserts).toHaveLength(0);
    expect(syncResend).toHaveBeenCalledTimes(1);
    expect(syncResend).toHaveBeenCalledWith({
      email: "comped@example.com",
      firstName: "Pat",
      lastName: "Rivera",
      source: "admin_comp",
    });
    expect(result.resend).toEqual({
      ok: true,
      contactId: "contact_comp",
      segment: "circle",
    });
  });

  it("inserts a new admin_comp row and attempts Resend sync when no subscription exists", async () => {
    const { client, updates, inserts } = mockSubscriptions();
    const syncResend = vi.fn<SyncCompedResend>(async () => ({
      ok: true,
      contactId: "contact_new",
      segment: "circle",
    }));

    const result = await applyUserComped(
      {
        subscriptionId: null,
        userId: "22222222-2222-2222-2222-222222222222",
        email: "new.comp@example.com",
        isComped: true,
      },
      { supabase: client, syncResend },
    );

    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(0);
    expect(inserts).toEqual([
      {
        user_id: "22222222-2222-2222-2222-222222222222",
        email: "new.comp@example.com",
        status: "active",
        is_comped: true,
        is_founding: false,
        cancel_at_period_end: false,
        metadata: { source: "admin_comp" },
      },
    ]);
    expect(syncResend).toHaveBeenCalledTimes(1);
    expect(syncResend).toHaveBeenCalledWith({
      email: "new.comp@example.com",
      firstName: null,
      lastName: null,
      source: "admin_comp",
    });
  });

  it("does not call Resend when removing a comp", async () => {
    const { client, updates } = mockSubscriptions();
    const syncResend = vi.fn<SyncCompedResend>(async () => {
      throw new Error("should not sync on un-comp");
    });

    const result = await applyUserComped(
      {
        subscriptionId: "11111111-1111-1111-1111-111111111111",
        userId: null,
        email: "comped@example.com",
        isComped: false,
      },
      { supabase: client, syncResend },
    );

    expect(result).toEqual({ ok: true, resend: { skipped: true, reason: "uncomp" } });
    expect(updates).toEqual([
      { row: { is_comped: false }, id: "11111111-1111-1111-1111-111111111111" },
    ]);
    expect(syncResend).not.toHaveBeenCalled();
  });

  it("does not insert or sync when un-comping a person with no subscription", async () => {
    const { client, inserts } = mockSubscriptions();
    const syncResend = vi.fn<SyncCompedResend>(async () => {
      throw new Error("should not sync on un-comp");
    });

    const result = await applyUserComped(
      {
        subscriptionId: null,
        userId: null,
        email: "nobody@example.com",
        isComped: false,
      },
      { supabase: client, syncResend },
    );

    expect(result).toEqual({ ok: true, resend: { skipped: true, reason: "uncomp" } });
    expect(inserts).toHaveLength(0);
    expect(syncResend).not.toHaveBeenCalled();
  });

  it("still grants the comp when Resend sync fails", async () => {
    const { client, updates } = mockSubscriptions();
    const syncResend = vi.fn<SyncCompedResend>(async () => ({
      ok: false,
      reason: "RESEND_API_KEY is not configured",
    }));

    const result = await applyUserComped(
      {
        subscriptionId: "11111111-1111-1111-1111-111111111111",
        userId: null,
        email: "comped@example.com",
        isComped: true,
      },
      { supabase: client, syncResend },
    );

    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect(syncResend).toHaveBeenCalledTimes(1);
    expect(result.resend).toEqual({
      ok: false,
      reason: "RESEND_API_KEY is not configured",
    });
  });

  it("throws when the subscription update fails and does not call Resend", async () => {
    const { client } = mockSubscriptions({ updateError: { message: "db down" } });
    const syncResend = vi.fn<SyncCompedResend>(async () => ({
      ok: true,
      contactId: "x",
      segment: "circle",
    }));

    await expect(
      applyUserComped(
        {
          subscriptionId: "11111111-1111-1111-1111-111111111111",
          userId: null,
          email: "comped@example.com",
          isComped: true,
        },
        { supabase: client, syncResend },
      ),
    ).rejects.toEqual({ message: "db down" });
    expect(syncResend).not.toHaveBeenCalled();
  });
});
