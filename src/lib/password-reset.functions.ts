// Public password-reset entry point.
//
// The default supabase.auth.resetPasswordForEmail() silently no-ops when the
// email isn't in auth.users — which is true for ~27/29 of our migrated
// members. So "forgot password" appeared broken: the UI said "check your
// inbox" but Supabase never sent anything.
//
// This server fn:
//   1. Looks up the email in auth.users (admin).
//   2. If the user exists → sends a normal recovery email.
//   3. If not, but they have a subscription → sends an invite (welcome flow),
//      which lets them set a password for the first time.
//   4. Otherwise → returns ok without leaking existence.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Input = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
});

function appOrigin(): string {
  return (
    process.env.PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    "https://app.alpcontractorcircle.com"
  ).replace(/\/$/, "");
}

async function findAuthUserByEmail(email: string) {
  // listUsers doesn't support filtering by email server-side, so we page.
  // Capped to keep this snappy; we only have ~hundreds of users.
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit;
    if (users.length < perPage) return null;
  }
  return null;
}

export type ResetResult = {
  ok: true;
  action: "recovery_sent" | "invite_sent" | "noop";
};

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator(Input.parse)
  .handler(async ({ data }): Promise<ResetResult> => {
    const email = data.email;
    const origin = appOrigin();

    const existing = await findAuthUserByEmail(email);

    if (existing) {
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/reset-password`,
      });
      if (error) throw new Error(error.message);
      return { ok: true, action: "recovery_sent" };
    }

    // No auth account yet — check if they're an active paid/comped member we migrated.
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("email")
      .ilike("email", email)
      .or("status.in.(active,trialing),is_comped.eq.true")
      .limit(1)
      .maybeSingle();

    if (sub) {
      const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { migrated_from: "manus", migrated_at: new Date().toISOString() },
        redirectTo: `${origin}/welcome`,
      });
      if (error) throw new Error(error.message);
      return { ok: true, action: "invite_sent" };
    }

    // Unknown email — do not leak existence.
    return { ok: true, action: "noop" };
  });
