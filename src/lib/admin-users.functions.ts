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

export type AdminUserRow = {
  id: string; // profile / auth user id (may be null if subscription unclaimed)
  email: string;
  fullName: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  invitedAt: string | null;
  hasAuthAccount: boolean;
  subscription: {
    id: string | null;
    status: string | null; // active / trialing / canceled / past_due / null
    isComped: boolean;
    isFounding: boolean;
    cancelAtPeriodEnd: boolean;
    currentPeriodEnd: string | null;
    priceId: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  } | null;
  isAdmin: boolean;
};


export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    await assertAdmin(context.userId);

    // Fetch all auth users (paginate through admin API)
    type AuthUser = {
      id: string;
      email: string | null;
      last_sign_in_at: string | null;
      email_confirmed_at: string | null;
      confirmed_at: string | null;
      invited_at: string | null;
      created_at: string;
    };
    const authUsers: AuthUser[] = [];
    let page = 1;
    const perPage = 200;
    // Safety cap at 50 pages (10k users)
    for (let i = 0; i < 50; i++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (error) break;
      const batch = (data?.users ?? []) as unknown as AuthUser[];
      authUsers.push(...batch);
      if (batch.length < perPage) break;
      page++;
    }
    const authById = new Map<string, AuthUser>();
    for (const u of authUsers) authById.set(u.id, u);

    const [{ data: profiles }, { data: subs }, { data: roles }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id,email,full_name,created_at")
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("subscriptions")
        .select(
          "id,user_id,email,status,is_comped,is_founding,cancel_at_period_end,current_period_end,price_id,stripe_customer_id,stripe_subscription_id",
        ),
      supabaseAdmin.from("user_roles").select("user_id,role"),
    ]);

    const adminIds = new Set(
      (roles ?? []).filter((r) => r.role === "admin").map((r) => r.user_id),
    );

    type SubRow = NonNullable<typeof subs>[number];
    const subByUserId = new Map<string, SubRow>();
    const subByEmail = new Map<string, SubRow>();
    for (const s of subs ?? []) {
      if (s.user_id) subByUserId.set(s.user_id, s);
      if (s.email) subByEmail.set(s.email.toLowerCase(), s);
    }

    const rows: AdminUserRow[] = [];
    const seenSubIds = new Set<string>();
    const seenAuthIds = new Set<string>();

    for (const p of profiles ?? []) {
      const sub =
        subByUserId.get(p.id) ??
        (p.email ? subByEmail.get(p.email.toLowerCase()) : undefined) ??
        null;
      if (sub) seenSubIds.add(sub.id);
      const au = authById.get(p.id);
      if (au) seenAuthIds.add(au.id);
      rows.push({
        id: p.id,
        email: p.email,
        fullName: p.full_name,
        createdAt: p.created_at,
        lastSignInAt: au?.last_sign_in_at ?? null,
        emailConfirmedAt: au?.email_confirmed_at ?? au?.confirmed_at ?? null,
        invitedAt: au?.invited_at ?? null,
        hasAuthAccount: !!au,
        isAdmin: adminIds.has(p.id),
        subscription: sub
          ? {
              id: sub.id,
              status: sub.status,
              isComped: sub.is_comped,
              isFounding: sub.is_founding,
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              currentPeriodEnd: sub.current_period_end,
              priceId: sub.price_id,
              stripeCustomerId: sub.stripe_customer_id,
              stripeSubscriptionId: sub.stripe_subscription_id,
            }
          : null,
      });
    }

    // Auth users without a profile row (invited but never finished setup)
    for (const au of authUsers) {
      if (seenAuthIds.has(au.id)) continue;
      if (!au.email) continue;
      const sub = subByUserId.get(au.id) ?? subByEmail.get(au.email.toLowerCase()) ?? null;
      if (sub) seenSubIds.add(sub.id);
      rows.push({
        id: au.id,
        email: au.email,
        fullName: null,
        createdAt: au.created_at,
        lastSignInAt: au.last_sign_in_at,
        emailConfirmedAt: au.email_confirmed_at ?? au.confirmed_at,
        invitedAt: au.invited_at,
        hasAuthAccount: true,
        isAdmin: adminIds.has(au.id),
        subscription: sub
          ? {
              id: sub.id,
              status: sub.status,
              isComped: sub.is_comped,
              isFounding: sub.is_founding,
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              currentPeriodEnd: sub.current_period_end,
              priceId: sub.price_id,
              stripeCustomerId: sub.stripe_customer_id,
              stripeSubscriptionId: sub.stripe_subscription_id,
            }
          : null,
      });
    }

    // Surface subscriptions that don't have a matching profile or auth user
    // (paid but hasn't created the portal account).
    for (const s of subs ?? []) {
      if (seenSubIds.has(s.id)) continue;
      rows.push({
        id: s.user_id ?? `sub:${s.id}`,
        email: s.email,
        fullName: null,
        createdAt: null,
        lastSignInAt: null,
        emailConfirmedAt: null,
        invitedAt: null,
        hasAuthAccount: false,
        isAdmin: false,
        subscription: {
          id: s.id,
          status: s.status,
          isComped: s.is_comped,
          isFounding: s.is_founding,
          cancelAtPeriodEnd: s.cancel_at_period_end,
          currentPeriodEnd: s.current_period_end,
          priceId: s.price_id,
          stripeCustomerId: s.stripe_customer_id,
          stripeSubscriptionId: s.stripe_subscription_id,
        },
      });
    }

    return rows;
  });


export const setUserComped = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        subscriptionId: z.string().uuid().nullable(),
        userId: z.string().uuid().nullable(),
        email: z.string().email(),
        fullName: z.string().nullable().optional(),
        isComped: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);

    if (data.subscriptionId) {
      const update: { is_comped: boolean; status?: string } = { is_comped: data.isComped };
      if (data.isComped) update.status = "active";
      const { error } = await supabaseAdmin
        .from("subscriptions")
        .update(update)
        .eq("id", data.subscriptionId);
      if (error) throw error;
      return { ok: true };
    }

    // No subscription row yet — create a comped one tied to this email/user.
    if (!data.isComped) {
      // Nothing to un-comp.
      return { ok: true };
    }
    const { error } = await supabaseAdmin.from("subscriptions").insert({
      user_id: data.userId,
      email: data.email,
      status: "active",
      is_comped: true,
      is_founding: false,
      cancel_at_period_end: false,
      metadata: { source: "admin_comp" },
    });
    if (error) throw error;
    return { ok: true };
  });
