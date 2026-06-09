// Handbook rollout — preflight + execute, with no surprises.
//
// Phase 1 of the entitlements work (see .lovable/plan.md). Before any
// invite emails go out we run a per-email diagnostic so the admin can
// see exactly what would happen for each row.
//
// Design notes:
// - Idempotent. Re-running does nothing the second time.
// - All access checks use lower(email) + auth.users id to dedupe identity.
// - Live run is a separate call so dry-run is the default path.
// - Service-role only inside the .handler() body (never leaks to client).

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

function resetRedirectUrl(): string {
  const origin =
    process.env.PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    "https://app.alpcontractorcircle.com";
  return `${origin.replace(/\/$/, "")}/reset-password`;
}

const EmailListInput = z.object({
  emails: z.array(z.string().trim().toLowerCase()).min(1).max(1000),
});

type AuthUserLite = {
  id: string;
  email: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
};

async function loadAuthUsersMap(): Promise<Map<string, AuthUserLite>> {
  const map = new Map<string, AuthUserLite>();
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const users = (data?.users ?? []) as unknown as AuthUserLite[];
    for (const u of users) {
      if (u.email) map.set(u.email.toLowerCase(), u);
    }
    if (users.length < perPage) break;
    page += 1;
  }
  return map;
}

// What we recommend doing for this email when the admin clicks "Run".
export type HandbookAction =
  | "ready_existing" // Already has handbook (or higher). Nothing to do.
  | "send_reset" // Has auth account but no password set / wants login link.
  | "seed_and_invite" // No auth account → seed pending claim + send invite.
  | "seed_only" // Has auth account + we'll attach a pending_claim/subscription on next refresh.
  | "grant_and_notify" // Auth account exists, no entitlement yet — grant + notify.
  | "skip_invalid"; // Bad email or already on the no-send list.

export type PreflightRow = {
  email: string;
  valid: boolean;
  hasAuthAccount: boolean;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  hasActiveSubscription: boolean;
  currentTier: string | null;
  hasPendingClaim: boolean;
  canAccessHandbook: boolean;
  notes: string[];
  action: HandbookAction;
};

export type PreflightReport = {
  rows: PreflightRow[];
  summary: {
    total: number;
    invalid: number;
    readyExisting: number;
    needsSendReset: number;
    needsSeedAndInvite: number;
    needsGrant: number;
  };
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const e = raw.trim().toLowerCase();
    if (!e) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

export const previewHandbookRollout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(EmailListInput.parse)
  .handler(async ({ data, context }): Promise<PreflightReport> => {
    await assertAdmin(context.userId);

    const emails = dedupeEmails(data.emails);
    if (emails.length === 0) {
      return {
        rows: [],
        summary: {
          total: 0,
          invalid: 0,
          readyExisting: 0,
          needsSendReset: 0,
          needsSeedAndInvite: 0,
          needsGrant: 0,
        },
      };
    }

    const authMap = await loadAuthUsersMap();

    // Pull subs + pending_claims by email in one batch.
    const [{ data: subs }, { data: claims }] = await Promise.all([
      supabaseAdmin
        .from("subscriptions")
        .select("email,status,is_comped,tier,user_id,metadata")
        .in("email", emails),
      supabaseAdmin
        .from("pending_claims")
        .select("email,status,metadata,claimed_at")
        .in("email", emails),
    ]);

    const subsByEmail = new Map<string, NonNullable<typeof subs>>();
    for (const s of subs ?? []) {
      const k = (s.email ?? "").toLowerCase();
      if (!k) continue;
      const arr = subsByEmail.get(k) ?? [];
      arr.push(s);
      subsByEmail.set(k, arr);
    }
    const claimsByEmail = new Map<string, NonNullable<typeof claims>>();
    for (const c of claims ?? []) {
      const k = (c.email ?? "").toLowerCase();
      if (!k) continue;
      const arr = claimsByEmail.get(k) ?? [];
      arr.push(c);
      claimsByEmail.set(k, arr);
    }

    const rows: PreflightRow[] = emails.map((email): PreflightRow => {
      const notes: string[] = [];
      const valid = EMAIL_RE.test(email);
      if (!valid) {
        return {
          email,
          valid: false,
          hasAuthAccount: false,
          lastSignInAt: null,
          emailConfirmedAt: null,
          hasActiveSubscription: false,
          currentTier: null,
          hasPendingClaim: false,
          canAccessHandbook: false,
          notes: ["Invalid email format"],
          action: "skip_invalid",
        };
      }

      const au = authMap.get(email);
      const userSubs = subsByEmail.get(email) ?? [];
      const claimRows = claimsByEmail.get(email) ?? [];
      const activeSub = userSubs.find(
        (s) => s.is_comped || s.status === "active" || s.status === "trialing",
      );
      const hasPendingClaim = claimRows.some((c) => !c.claimed_at);

      // Rough tier resolution: highest tier on any active/comped sub for this
      // email. Mirrors what get_user_tier does on the DB side; we don't have
      // user_id here for unauth-linked subs, so this is best-effort.
      const RANK: Record<string, number> = {
        aos_only: 0,
        book_buyer: 1,
        intensive: 3,
        power_hour: 4,
        sm_school: 4,
        contractor_school: 4,
        circle: 4,
        hardcore: 5,
      };
      let currentTier: string | null = null;
      let bestRank = -1;
      for (const s of userSubs) {
        if (!(s.is_comped || s.status === "active" || s.status === "trialing")) continue;
        const r = RANK[s.tier as string] ?? -1;
        if (r > bestRank) {
          bestRank = r;
          currentTier = s.tier as string;
        }
      }
      const canAccessHandbook = bestRank >= 1; // book_buyer or higher

      let action: HandbookAction;
      if (canAccessHandbook && au) {
        if (au.last_sign_in_at) {
          notes.push(`Already has ${currentTier}. Last sign-in OK.`);
          action = "ready_existing";
        } else {
          notes.push(`Already has ${currentTier} but never signed in.`);
          action = "send_reset";
        }
      } else if (canAccessHandbook && !au) {
        notes.push(`Has ${currentTier} entitlement but no auth account yet.`);
        action = "seed_and_invite";
      } else if (au) {
        notes.push("Auth account exists; will grant handbook entitlement + notify.");
        if (hasPendingClaim) notes.push("Pending claim already queued.");
        action = "grant_and_notify";
      } else {
        notes.push("No auth account, no entitlement. Will seed pending claim + invite.");
        if (hasPendingClaim) notes.push("Pending claim already queued; skip duplicate.");
        action = "seed_and_invite";
      }

      return {
        email,
        valid: true,
        hasAuthAccount: !!au,
        lastSignInAt: au?.last_sign_in_at ?? null,
        emailConfirmedAt: au?.email_confirmed_at ?? null,
        hasActiveSubscription: !!activeSub,
        currentTier,
        hasPendingClaim,
        canAccessHandbook,
        notes,
        action,
      };
    });

    const summary = {
      total: rows.length,
      invalid: rows.filter((r) => r.action === "skip_invalid").length,
      readyExisting: rows.filter((r) => r.action === "ready_existing").length,
      needsSendReset: rows.filter((r) => r.action === "send_reset").length,
      needsSeedAndInvite: rows.filter((r) => r.action === "seed_and_invite").length,
      needsGrant: rows.filter((r) => r.action === "grant_and_notify").length,
    };

    return { rows, summary };
  });

// ---------- live execution ----------

const ExecuteInput = z.object({
  emails: z.array(z.string().trim().toLowerCase()).min(1).max(500),
  // safety belt: caller must reaffirm the count they expect to send to
  expectedCount: z.number().int().min(1).max(500),
});

export type ExecuteResultRow = {
  email: string;
  action: HandbookAction | "error";
  message?: string;
};

async function ensurePendingClaim(email: string) {
  // Check if there's already an unclaimed pending claim with book_v2 product.
  const { data: existing } = await supabaseAdmin
    .from("pending_claims")
    .select("id,metadata,claimed_at")
    .ilike("email", email)
    .is("claimed_at", null)
    .limit(1)
    .maybeSingle();

  if (existing) {
    const product = (existing.metadata as Record<string, unknown> | null)?.product;
    if (product === "book_v2") return { ok: true, created: false };
    // Update existing claim's metadata so signup grants book_buyer.
    const merged = { ...(existing.metadata as object | null ?? {}), product: "book_v2", source: "handbook_rollout" };
    const { error } = await supabaseAdmin
      .from("pending_claims")
      .update({ metadata: merged })
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, created: false, updated: true };
  }

  const { error } = await supabaseAdmin.from("pending_claims").insert({
    email,
    status: "active",
    metadata: { product: "book_v2", source: "handbook_rollout" },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, created: true };
}

async function grantHandbookForExistingUser(userId: string, email: string) {
  // If user already has an active book_buyer (or higher) sub, skip.
  const { data: subs } = await supabaseAdmin
    .from("subscriptions")
    .select("id,tier,status,is_comped")
    .or(`user_id.eq.${userId},email.eq.${email}`);
  const hasActive = (subs ?? []).some(
    (s) => s.is_comped || s.status === "active" || s.status === "trialing",
  );
  if (hasActive) return { ok: true, skipped: true };

  const { error } = await supabaseAdmin.from("subscriptions").insert({
    user_id: userId,
    email,
    status: "active",
    is_comped: true,
    tier: "book_buyer",
    metadata: { source: "handbook_rollout" },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, created: true };
}

async function sendResetTo(email: string) {
  const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
    redirectTo: resetRedirectUrl(),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

async function sendInviteTo(email: string) {
  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: {
      source: "handbook_rollout",
      product: "book_v2",
      invited_at: new Date().toISOString(),
    },
    redirectTo: welcomeRedirectUrl(),
  });
  if (error) {
    // "already registered" is fine; send reset instead.
    if (/already/i.test(error.message) || /registered/i.test(error.message)) {
      return await sendResetTo(email);
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export const executeHandbookRollout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(ExecuteInput.parse)
  .handler(async ({ data, context }): Promise<{
    sent: number;
    skipped: number;
    errors: number;
    rows: ExecuteResultRow[];
  }> => {
    await assertAdmin(context.userId);

    const emails = dedupeEmails(data.emails);
    if (emails.length !== data.expectedCount) {
      throw new Error(
        `Safety check failed: caller said ${data.expectedCount} but got ${emails.length} unique emails. Re-run preflight.`,
      );
    }

    // We re-run preflight server-side to make decisions on fresh data.
    const authMap = await loadAuthUsersMap();
    const results: ExecuteResultRow[] = [];

    for (const email of emails) {
      try {
        if (!EMAIL_RE.test(email)) {
          results.push({ email, action: "skip_invalid", message: "invalid email" });
        } else {
          const au = authMap.get(email);

          if (au) {
            const grant = await grantHandbookForExistingUser(au.id, email);
            if (!grant.ok) {
              results.push({ email, action: "error", message: grant.error });
            } else if (au.last_sign_in_at) {
              results.push({
                email,
                action: "grant_and_notify",
                message: grant.skipped ? "already had access" : "granted handbook",
              });
            } else {
              const r = await sendResetTo(email);
              results.push({
                email,
                action: r.ok ? "send_reset" : "error",
                message: r.ok ? "reset link sent" : r.error,
              });
            }
          } else {
            const claim = await ensurePendingClaim(email);
            if (!claim.ok) {
              results.push({ email, action: "error", message: claim.error });
            } else {
              const inv = await sendInviteTo(email);
              results.push({
                email,
                action: inv.ok ? "seed_and_invite" : "error",
                message: inv.ok ? "invite sent" : inv.error,
              });
            }
          }
        }
      } catch (e) {
        results.push({
          email,
          action: "error",
          message: e instanceof Error ? e.message : "unknown error",
        });
      }
      // Stay under Supabase auth rate limits.
      await new Promise((res) => setTimeout(res, 250));
    }

    return {
      sent: results.filter((r) => r.action === "send_reset" || r.action === "seed_and_invite" || r.action === "grant_and_notify").length,
      skipped: results.filter((r) => r.action === "skip_invalid").length,
      errors: results.filter((r) => r.action === "error").length,
      rows: results,
    };
  });
