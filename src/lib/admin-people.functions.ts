// Admin · People — the unified identity view.
//
// One row per *person* (deduped across profiles, auth.users, subscriptions,
// pending_claims by lower(email) + auth user_id). Shows everything we know
// about a person and flags broken states so they can be repaired one-click.
//
// Phase 1 of the entitlements work — see .lovable/plan.md. We are NOT
// rewriting the underlying tables yet. We're giving you a single sane view
// over the mess so you can stop seeing duplicates and stop guessing why a
// person can't see what they paid for.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type SupabaseAdmin = Awaited<ReturnType<typeof getSupabaseAdmin>>;

async function assertAdmin(userId: string, supabaseAdmin: SupabaseAdmin) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r) => r.role === "admin");
  if (!isAdmin) throw new Error("Forbidden");
}

function originRoot(): string {
  const o =
    process.env.PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    "https://app.alpcontractorcircle.com";
  return o.replace(/\/$/, "");
}

const LIVE_STATUSES = new Set(["active", "trialing"]);
const DEAD_STATUSES = new Set(["canceled", "superseded", "incomplete_expired", "incomplete"]);
const PENDING_CLAIM_WINDOW_DAYS = 30;

function isLiveSubscription(row: { status: string | null; is_comped: boolean }) {
  if (DEAD_STATUSES.has(row.status ?? "")) return false;
  return row.is_comped || LIVE_STATUSES.has(row.status ?? "") || row.status === "comped";
}

function isPeopleRelevantSubscription(row: {
  tier: string | null;
  status: string | null;
  is_comped: boolean;
  stripe_subscription_id?: string | null;
}) {
  if (!isLiveSubscription(row)) return false;

  // `aos_only` Stripe rows were the noisy catch-all for unrelated Stripe products
  // like ALP University. AOS is granted through the portal, not treated as a buyer tier here.
  if (row.tier === "aos_only" && !row.is_comped && row.stripe_subscription_id) return false;

  return true;
}

function isRecentOpenClaim(row: { claimed_at: string | null; created_at: string }) {
  if (row.claimed_at) return false;
  const createdAt = new Date(row.created_at).getTime();
  if (!Number.isFinite(createdAt)) return false;
  const cutoff = Date.now() - PENDING_CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return createdAt >= cutoff;
}

// What can be wrong with a person.
export type PersonIssue =
  | "no_auth_account" // Has sub/claim, no auth.users row → never invited or never signed up.
  | "never_signed_in" // Has auth row, never signed in → invite stale.
  | "email_unconfirmed" // Auth row exists, email not confirmed → invite link not opened.
  | "subscription_unlinked" // Sub row exists with no user_id → won't show on profile.
  | "tier_disagrees" // get_user_tier disagrees with what their sub says.
  | "duplicate_subscriptions" // More than one sub for the same identity.
  | "unclaimed_pending_claim" // Pending claim exists but person has an auth account.
  | "no_company"; // Profile exists but no company link (mostly cosmetic).

export type PersonRow = {
  // Stable id we display. Prefers auth.users.id, falls back to profile id,
  // falls back to "email:<email>" if neither exists yet.
  key: string;
  email: string;
  fullName: string | null;
  authUserId: string | null;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  invitedAt: string | null;
  isAdmin: boolean;
  // Resolved tier (best-effort, mirrors get_user_tier).
  tier: string | null;
  hasActiveSubscription: boolean;
  isComped: boolean;
  subscriptionCount: number;
  subscriptionIds: string[];
  pendingClaimCount: number;
  issues: PersonIssue[];
};

export type PeopleAudit = {
  people: PersonRow[];
  totals: {
    people: number;
    withIssues: number;
    duplicates: number;
    unlinkedSubs: number;
    pendingClaims: number;
  };
};

type AuthUserLite = {
  id: string;
  email: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  confirmed_at: string | null;
  invited_at: string | null;
  created_at: string;
};

async function loadAuthUsers(supabaseAdmin: SupabaseAdmin): Promise<AuthUserLite[]> {
  const out: AuthUserLite[] = [];
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const batch = (data?.users ?? []) as unknown as AuthUserLite[];
    out.push(...batch);
    if (batch.length < perPage) break;
  }
  return out;
}

const TIER_RANK: Record<string, number> = {
  aos_only: 0,
  book_buyer: 1,
  intensive: 3,
  power_hour: 4,
  sm_school: 4,
  contractor_school: 4,
  circle: 4,
  hardcore: 5,
};

function bestTier(rows: { tier: string | null; status: string | null; is_comped: boolean }[]): {
  tier: string | null;
  active: boolean;
} {
  let best: string | null = null;
  let bestRank = -1;
  let active = false;
  for (const r of rows) {
    const live = r.is_comped || r.status === "active" || r.status === "trialing";
    if (!live) continue;
    active = true;
    const rank = TIER_RANK[r.tier ?? ""] ?? -1;
    if (rank > bestRank) {
      bestRank = rank;
      best = r.tier;
    }
  }
  return { tier: best, active };
}

export const auditPeople = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PeopleAudit> => {
    const supabaseAdmin = await getSupabaseAdmin();
    await assertAdmin(context.userId, supabaseAdmin);

    const [authUsers, { data: profiles }, { data: subs }, { data: claims }, { data: roles }] =
      await Promise.all([
        loadAuthUsers(supabaseAdmin),
        supabaseAdmin.from("profiles").select("id,email,full_name,created_at"),
        supabaseAdmin
          .from("subscriptions")
          .select(
            "id,user_id,email,status,is_comped,is_founding,tier,stripe_subscription_id,stripe_customer_id,current_period_end",
          ),
        supabaseAdmin
          .from("pending_claims")
          .select("id,email,status,claimed_at,metadata,created_at"),
        supabaseAdmin.from("user_roles").select("user_id,role"),
      ]);

    const relevantSubs = (subs ?? []).filter(isPeopleRelevantSubscription);
    const relevantClaims = (claims ?? []).filter(isRecentOpenClaim);

    const adminIds = new Set(
      (roles ?? []).filter((r) => r.role === "admin").map((r) => r.user_id),
    );

    // Index everything by lowercase email — our dedupe key.
    type Bucket = {
      email: string;
      auth: AuthUserLite[];
      profiles: NonNullable<typeof profiles>;
      subs: NonNullable<typeof subs>;
      claims: NonNullable<typeof claims>;
    };
    const buckets = new Map<string, Bucket>();
    function bucket(email: string | null | undefined): Bucket | null {
      if (!email) return null;
      const key = email.toLowerCase();
      let b = buckets.get(key);
      if (!b) {
        b = { email: key, auth: [], profiles: [], subs: [], claims: [] };
        buckets.set(key, b);
      }
      return b;
    }

    for (const u of authUsers) bucket(u.email)?.auth.push(u);
    for (const p of profiles ?? []) bucket(p.email)?.profiles.push(p);
    for (const s of relevantSubs) bucket(s.email)?.subs.push(s);
    for (const c of relevantClaims) bucket(c.email)?.claims.push(c);

    const people: PersonRow[] = [];
    for (const b of buckets.values()) {
      const auth = b.auth[0] ?? null;
      const prof = b.profiles[0] ?? null;
      const authId = auth?.id ?? prof?.id ?? null;
      const isAdmin = authId ? adminIds.has(authId) : false;

      // This view is for entitlement cleanup. Do not surface random auth/profile
      // rows unless they have a relevant subscription/claim or are an admin.
      if (!isAdmin && b.subs.length === 0 && b.claims.length === 0) continue;

      const { tier, active } = bestTier(b.subs);
      const isComped = b.subs.some((s) => s.is_comped);

      const issues: PersonIssue[] = [];
      if ((b.subs.length > 0 || b.claims.length > 0) && !auth) issues.push("no_auth_account");
      if (b.subs.some((s) => !s.user_id)) issues.push("subscription_unlinked");
      if (b.subs.length > 1) issues.push("duplicate_subscriptions");
      if (auth && b.claims.some((c) => !c.claimed_at)) issues.push("unclaimed_pending_claim");
      if (!prof && auth) {
        // no profile row — usually means handle_new_user trigger didn't fire (rare).
      }

      people.push({
        key: authId ?? `email:${b.email}`,
        email: b.email,
        fullName: prof?.full_name ?? null,
        authUserId: auth?.id ?? null,
        lastSignInAt: auth?.last_sign_in_at ?? null,
        emailConfirmedAt: auth?.email_confirmed_at ?? auth?.confirmed_at ?? null,
        invitedAt: auth?.invited_at ?? null,
        isAdmin,
        tier: isAdmin ? "circle" : tier,
        hasActiveSubscription: active,
        isComped,
        subscriptionCount: b.subs.length,
        subscriptionIds: b.subs.map((s) => s.id),
        pendingClaimCount: b.claims.filter((c) => !c.claimed_at).length,
        issues,
      });
    }

    people.sort((a, b) => {
      if (a.issues.length !== b.issues.length) return b.issues.length - a.issues.length;
      return a.email.localeCompare(b.email);
    });

    const totals = {
      people: people.length,
      withIssues: people.filter((p) => p.issues.length > 0).length,
      duplicates: people.filter((p) => p.subscriptionCount > 1).length,
      unlinkedSubs: relevantSubs.filter((s) => !s.user_id).length,
      pendingClaims: relevantClaims.length,
    };

    return { people, totals };
  });

// ---------- per-person repair ----------

const RepairInput = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  // Caller asserts the issues they want repaired. Repair is idempotent and
  // safe to run even if the issue is already gone.
  actions: z
    .array(
      z.enum([
        "link_subscriptions", // attach orphan subs to the auth user
        "claim_pending", // run pending_claims for this email
        "send_reset", // password reset link
        "send_invite", // invite (creates auth user if missing)
        "dedupe_subscriptions", // keep best sub, mark others canceled
      ]),
    )
    .min(1),
});

export type RepairResult = {
  email: string;
  performed: string[];
  notes: string[];
  errors: string[];
};

export const repairPerson = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(RepairInput.parse)
  .handler(async ({ data, context }): Promise<RepairResult> => {
    const supabaseAdmin = await getSupabaseAdmin();
    await assertAdmin(context.userId, supabaseAdmin);

    const performed: string[] = [];
    const notes: string[] = [];
    const errors: string[] = [];

    // Resolve auth user (if any).
    const authUsers = await loadAuthUsers(supabaseAdmin);
    const auth = authUsers.find((u) => (u.email ?? "").toLowerCase() === data.email) ?? null;

    if (data.actions.includes("link_subscriptions")) {
      if (!auth) {
        notes.push("No auth user — skipped link_subscriptions.");
      } else {
        const { data: orphans } = await supabaseAdmin
          .from("subscriptions")
          .select("id")
          .ilike("email", data.email)
          .is("user_id", null);
        if (orphans && orphans.length > 0) {
          const { error } = await supabaseAdmin
            .from("subscriptions")
            .update({ user_id: auth.id })
            .in(
              "id",
              orphans.map((o) => o.id),
            );
          if (error) errors.push(`link_subscriptions: ${error.message}`);
          else performed.push(`Linked ${orphans.length} subscription(s) to auth user.`);
        } else {
          notes.push("No orphan subscriptions to link.");
        }
      }
    }

    if (data.actions.includes("claim_pending")) {
      if (!auth) {
        notes.push("No auth user — pending claims will be applied automatically on first sign-up.");
      } else {
        // The claim_pending_subscription DB trigger runs on auth.users INSERT,
        // not on demand. We mimic its effect: insert subs from any unclaimed
        // claims and mark them claimed.
        const { data: open } = await supabaseAdmin
          .from("pending_claims")
          .select("*")
          .ilike("email", data.email)
          .is("claimed_at", null);
        let claimed = 0;
        for (const c of open ?? []) {
          const product = (c.metadata as Record<string, unknown> | null)?.product;
          const tier =
            product === "book_v2"
              ? "book_buyer"
              : product === "intensive"
                ? "intensive"
                : "circle";
          const ins = await supabaseAdmin.from("subscriptions").insert({
            user_id: auth.id,
            email: data.email,
            stripe_customer_id: c.stripe_customer_id,
            stripe_subscription_id: c.stripe_subscription_id,
            price_id: c.price_id,
            status: c.status ?? "active",
            current_period_end: c.current_period_end,
            metadata: c.metadata,
            tier,
          });
          if (ins.error) {
            // Likely a duplicate stripe_subscription_id — fine, treat as claimed.
            if (!/duplicate/i.test(ins.error.message)) {
              errors.push(`claim_pending(${c.id}): ${ins.error.message}`);
              continue;
            }
          }
          const upd = await supabaseAdmin
            .from("pending_claims")
            .update({ claimed_at: new Date().toISOString(), claimed_by: auth.id })
            .eq("id", c.id);
          if (upd.error) errors.push(`mark_claimed(${c.id}): ${upd.error.message}`);
          else claimed++;
        }
        if (claimed > 0) performed.push(`Claimed ${claimed} pending claim(s).`);
        else notes.push("No open pending claims.");
      }
    }

    if (data.actions.includes("dedupe_subscriptions")) {
      const { data: rows } = await supabaseAdmin
        .from("subscriptions")
        .select("id,status,is_comped,stripe_subscription_id,stripe_customer_id,tier,created_at")
        .ilike("email", data.email);
      if (rows && rows.length > 1) {
        // Winner rule (in order):
        //   1. Higher tier rank wins (hardcore > circle > intensive > book_buyer > aos_only).
        //      A comped hardcore beats a paid book_buyer — the person actually has hardcore.
        //   2. Within the same tier: real Stripe sub id > customer id > comped flag.
        //   3. Tiebreak: newest created_at.
        const tierRank: Record<string, number> = {
          aos_only: 0, book_buyer: 1, intensive: 3,
          power_hour: 4, sm_school: 4, contractor_school: 4, circle: 4,
          hardcore: 5,
        };
        const stripeScore = (s: (typeof rows)[number]) =>
          (s.stripe_subscription_id ? 4 : 0) +
          (s.stripe_customer_id ? 2 : 0) +
          (s.is_comped ? 1 : 0);
        const sorted = [...rows].sort((a, b) => {
          const dt = (tierRank[b.tier ?? ""] ?? -1) - (tierRank[a.tier ?? ""] ?? -1);
          if (dt !== 0) return dt;
          const ds = stripeScore(b) - stripeScore(a);
          if (ds !== 0) return ds;
          return (b.created_at ?? "").localeCompare(a.created_at ?? "");
        });
        const losers = sorted.slice(1).map((r) => r.id);
        if (losers.length > 0) {
          const { error } = await supabaseAdmin
            .from("subscriptions")
            .update({ status: "canceled", metadata: { source: "admin_dedupe" } })
            .in("id", losers);
          if (error) errors.push(`dedupe_subscriptions: ${error.message}`);
          else performed.push(`Marked ${losers.length} duplicate subscription(s) canceled.`);
        }
      } else {
        notes.push("Nothing to dedupe.");
      }
    }

    if (data.actions.includes("send_reset")) {
      if (!auth) {
        notes.push("No auth user — use Send invite instead.");
      } else {
        const { error } = await supabaseAdmin.auth.resetPasswordForEmail(data.email, {
          redirectTo: `${originRoot()}/reset-password`,
        });
        if (error) errors.push(`send_reset: ${error.message}`);
        else performed.push("Reset link sent.");
      }
    }

    if (data.actions.includes("send_invite")) {
      const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
        data: { source: "admin_people_repair", invited_at: new Date().toISOString() },
        redirectTo: `${originRoot()}/welcome`,
      });
      if (error) {
        if (/already/i.test(error.message) || /registered/i.test(error.message)) {
          // Fall through to a reset link instead.
          const { error: rerr } = await supabaseAdmin.auth.resetPasswordForEmail(data.email, {
            redirectTo: `${originRoot()}/reset-password`,
          });
          if (rerr) errors.push(`send_invite_fallback_reset: ${rerr.message}`);
          else performed.push("Already registered — sent password reset instead.");
        } else {
          errors.push(`send_invite: ${error.message}`);
        }
      } else {
        performed.push("Invite sent.");
      }
    }

    return { email: data.email, performed, notes, errors };
  });

// Admin-only: mint a one-time sign-in URL for a member when email delivery
// is failing (spam quarantine, iOS Mail prefetch burning tokens, etc.).
// Returns the URL so the operator can hand-deliver it (text/Slack/etc.).
// The URL is single-use and short-lived — Supabase enforces both.
export const mintSignInLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().trim().toLowerCase().email(),
        type: z.enum(["magiclink", "recovery"]).default("magiclink"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    await assertAdmin(context.userId, supabaseAdmin);

    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: data.type,
      email: data.email,
      options: {
        redirectTo:
          data.type === "recovery"
            ? `${originRoot()}/reset-password`
            : `${originRoot()}/auth/callback`,
      },
    });
    if (error) throw new Error(error.message);
    const url = link.properties?.action_link;
    if (!url) throw new Error("No action_link returned from Supabase");
    return { url, email: data.email, type: data.type };
  });

// Admin-only: mint a magic-link AND send it through our branded transactional
// pipeline (same one that delivers welcome emails — usually lands when the
// raw Supabase Auth email gets quarantined). Subject is friendly ("Your seat
// is waiting"), not "Sign in" / "Reset password", so spam filters are kinder.
export const emailSignInLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        email: z.string().trim().toLowerCase().email(),
        firstName: z.string().trim().max(80).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabaseAdmin = await getSupabaseAdmin();
    await assertAdmin(context.userId, supabaseAdmin);

    // 1. Mint a one-time sign-in URL.
    const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: data.email,
      options: { redirectTo: `${originRoot()}/auth/callback` },
    });
    if (linkErr) throw new Error(linkErr.message);
    const confirmationUrl = link.properties?.action_link;
    if (!confirmationUrl) throw new Error("No action_link returned from Supabase");

    // 2. Resolve firstName from profile if not provided.
    let firstName = data.firstName;
    if (!firstName) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .ilike("email", data.email)
        .maybeSingle();
      const full = prof?.full_name?.trim();
      if (full) firstName = full.split(/\s+/)[0];
    }

    // 3. Send via the branded transactional pipeline.
    const { enqueueLoginNudge } = await import("@/lib/email/enqueue-login-nudge");
    const result = await enqueueLoginNudge({
      supabaseAdmin,
      email: data.email,
      firstName: firstName ?? null,
      confirmationUrl,
      idempotencyKey: `admin-signin-${data.email}-${Date.now()}`,
    });

    return { ok: true, email: data.email, status: result.status };
  });

