// Phase-2 migration tooling: bulk-invite existing Manus members into the
// new portal. Each invite is a Supabase-issued magic link that lands on
// /welcome, where the member sets their password.
//
// Admin-only. All writes go through the service-role admin client.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r) => r.role === "admin");
  if (!isAdmin) throw new Error("Forbidden");
}

function welcomeRedirectUrl(): string {
  const origin =
    process.env.PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    "https://app.alpcontractorcircle.com";
  return `${origin.replace(/\/$/, "")}/welcome`;
}

const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  fullName: z.string().trim().min(1).max(160).optional(),
});

const BulkInviteInput = z.object({
  members: z.array(InviteInput).min(1).max(500),
});

export type InviteResult = {
  email: string;
  status: "invited" | "already_existed" | "error";
  message?: string;
};

async function inviteOne(input: z.infer<typeof InviteInput>): Promise<InviteResult> {
  const { email, fullName } = input;
  try {
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: fullName ?? null,
        migrated_from: "manus",
        migrated_at: new Date().toISOString(),
      },
      redirectTo: welcomeRedirectUrl(),
    });
    if (error) {
      const msg = error.message || "";
      if (/already/i.test(msg) || /registered/i.test(msg)) {
        return { email, status: "already_existed", message: msg };
      }
      return { email, status: "error", message: msg };
    }
    return { email, status: "invited" };
  } catch (e) {
    return {
      email,
      status: "error",
      message: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

export const inviteMembersBulk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(BulkInviteInput.parse)
  .handler(async ({ data, context }): Promise<{
    invited: number;
    alreadyExisted: number;
    errors: number;
    results: InviteResult[];
  }> => {
    await assertAdmin(context.userId);

    const results: InviteResult[] = [];
    // Sequential to keep well under Supabase's auth rate limits; ~2/sec.
    for (const member of data.members) {
      const r = await inviteOne(member);
      results.push(r);
      await new Promise((res) => setTimeout(res, 250));
    }
    return {
      invited: results.filter((r) => r.status === "invited").length,
      alreadyExisted: results.filter((r) => r.status === "already_existed").length,
      errors: results.filter((r) => r.status === "error").length,
      results,
    };
  });

export type MigrationStatus = {
  totalMigrated: number;
  activated: number;
  pending: number;
};

export const getMigrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MigrationStatus> => {
    await assertAdmin(context.userId);

    // Page through auth users to find ones tagged migrated_from=manus.
    let totalMigrated = 0;
    let activated = 0;
    let page = 1;
    const perPage = 200;
    // Hard cap to avoid runaway loops.
    for (let i = 0; i < 25; i++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) break;
      const users = data?.users ?? [];
      if (users.length === 0) break;

      for (const u of users) {
        const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
        if (meta.migrated_from === "manus") {
          totalMigrated += 1;
          if (u.last_sign_in_at) activated += 1;
        }
      }

      if (users.length < perPage) break;
      page += 1;
    }

    return {
      totalMigrated,
      activated,
      pending: Math.max(0, totalMigrated - activated),
    };
  });
