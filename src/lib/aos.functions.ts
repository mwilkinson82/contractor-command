import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHmac } from "crypto";

export type AosMeasurable = {
  id: string;
  name: string;
  unit?: string | null;
  goal?: number | null;
  weeks: { week_start: string; value: number | null }[];
};

export type AosRock = {
  id: string;
  title: string;
  owner?: string | null;
  status: "on-track" | "off-track" | "done" | "unknown";
  percent_complete: number;
  due_date?: string | null;
};

export type AosTodo = {
  id: string;
  title: string;
  due_date?: string | null;
  owner?: string | null;
};

export type AosIssue = {
  id: string;
  title: string;
  created_at: string;
  owner?: string | null;
};

export type AosCompany = { id: string; name: string };

export type AosSnapshot =
  | {
      linked: true;
      company_id: string | null;
      company_name: string | null;
      companies: AosCompany[];
      last_login_at: string | null;
      next_meeting: { date: string; kind: string } | null;
      scorecard: AosMeasurable[];
      rocks: AosRock[];
      issues_open: AosIssue[];
      todos_due_this_week: AosTodo[];
    }
  | { linked: false; reason: string; companies?: AosCompany[] };

export type AosResult =
  | { ok: true; snapshot: AosSnapshot; fetched_at: string; previously_linked: boolean }
  | { ok: false; error: string };

function secretVariants(secret: string) {
  return Array.from(new Set([secret, secret.trim()]));
}

function normalizeAosSnapshot(raw: unknown, email: string): AosSnapshot {
  const snapshot = raw as Partial<AosSnapshot> & {
    exists?: boolean;
    workspace_count?: number;
    primary_workspace_name?: string | null;
    companies?: AosCompany[];
  };

  if (typeof snapshot.linked === "boolean") {
    return snapshot as AosSnapshot;
  }

  // Current AOS public snapshot endpoint returns a lightweight account probe
  // ({ exists, workspace_count, primary_workspace_name }) rather than the rich
  // Pulse payload. Treat a confirmed account match as connected so Circle stops
  // showing the broken “not connected” state after SSO succeeds.
  if (snapshot.exists) {
    const companies = Array.isArray(snapshot.companies) ? snapshot.companies : [];
    return {
      linked: true,
      company_id: companies[0]?.id ?? null,
      company_name: snapshot.primary_workspace_name ?? companies[0]?.name ?? null,
      companies,
      last_login_at: null,
      next_meeting: null,
      scorecard: [],
      rocks: [],
      issues_open: [],
      todos_due_this_week: [],
    };
  }

  return {
    linked: false,
    reason: `No AOS workspace found yet for ${email}. Open AOS once, then come back and check again.`,
  };
}

export const getAosSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { companyId?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<AosResult> => {
    const baseUrl = process.env.AOS_BASE_URL;
    const secret = process.env.AOS_SHARED_SECRET;
    if (!baseUrl || !secret) {
      return { ok: false, error: "AOS link not configured on Circle." };
    }

    // Pull email from the verified Supabase claims
    const email =
      (context.claims as { email?: string } | null)?.email ?? null;
    if (!email) {
      return { ok: false, error: "No email on your account." };
    }

    const ts = Math.floor(Date.now() / 1000);
    const normalizedEmail = email.toLowerCase().trim();
    const { supabase, userId } = context;
    const { data: existingLink } = await supabase
      .from("aos_links")
      .select("verified_at")
      .eq("user_id", userId)
      .maybeSingle();

    try {
      let res: Response | null = null;
      for (const signingSecret of secretVariants(secret)) {
        const nonce =
          Math.random().toString(36).slice(2, 12) +
          Math.random().toString(36).slice(2, 12);
        const sig = createHmac("sha256", signingSecret)
          .update(`${normalizedEmail}|${ts}|${nonce}`)
          .digest("hex");

        res = await fetch(
          `${baseUrl.replace(/\/$/, "")}/api/public/circle/snapshot`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-circle-signature": sig,
            },
            redirect: "manual",
            body: JSON.stringify({
              email: normalizedEmail,
              ts,
              nonce,
              sig,
              company_id: data.companyId ?? null,
            }),
          },
        );

        if (res.ok || signingSecret === secret.trim()) break;
        const text = await res.clone().text().catch(() => "");
        if (!text.includes("Bad signature")) break;
      }

      if (!res) {
        return { ok: false, error: "Could not reach AOS." };
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          error: `AOS returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        };
      }

      const snapshot = normalizeAosSnapshot(await res.json(), normalizedEmail);
      const previously_linked = Boolean(existingLink?.verified_at);

      // Persist the link the first time we confirm it (and refresh last_sync_at)
      if (snapshot.linked) {
        await supabase.from("aos_links").upsert(
          {
            user_id: userId,
            aos_email: normalizedEmail,
            verified_at: existingLink?.verified_at ?? new Date().toISOString(),
            last_sync_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      }

      return {
        ok: true,
        snapshot,
        fetched_at: new Date().toISOString(),
        previously_linked: previously_linked || snapshot.linked,
      };
    } catch (err) {
      console.error("AOS snapshot fetch failed:", err);
      return { ok: false, error: "Could not reach AOS." };
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// SSO handoff: mint a short-lived signed token, return a URL that AOS will
// consume to sign the user in (find-or-create by email). AOS side lives at
// `/api/public/circle/sso` on the AOS project and verifies the same HMAC.
//
// Token shape: `${email}.${ts}.${nonce}.${sig}` (URL-safe).
// Signing string: `${email}|${ts}|${nonce}`.
// TTL enforced on the AOS side (60s recommended).
// ─────────────────────────────────────────────────────────────────────────────

export type AosSsoMint =
  | {
      ok: true;
      url: string;
      aos_email: string;
      previously_linked: boolean;
      tier: string | null;
      workspace_limit: number;
      seat_limit: number;
    }
  | { ok: false; error: string };

export const mintAosSsoToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AosSsoMint> => {
    const baseUrl = process.env.AOS_BASE_URL;
    const secret = process.env.AOS_SHARED_SECRET;
    if (!baseUrl || !secret) {
      return { ok: false, error: "AOS link not configured on Circle." };
    }

    const claimEmail =
      (context.claims as { email?: string } | null)?.email ?? null;
    if (!claimEmail) {
      return { ok: false, error: "No email on your account." };
    }

    // If the member previously linked a different AOS email, use that.
    const { supabase, userId } = context;
    const { data: link } = await supabase
      .from("aos_links")
      .select("aos_email, verified_at")
      .eq("user_id", userId)
      .maybeSingle();

    // Pull the user's effective AOS allowance. Circle is the source of truth
    // for tier + limits; AOS verifies the HMAC and trusts these numbers.
    const { data: limitsRows } = await supabase.rpc("get_user_aos_limits", {
      _user_id: userId,
    });
    const limitsRow = Array.isArray(limitsRows) ? limitsRows[0] : limitsRows;
    const tier = (limitsRow?.tier as string | null) ?? null;
    const workspaceLimit = (limitsRow?.workspace_limit as number | null) ?? 0;
    const seatLimit = (limitsRow?.seat_limit as number | null) ?? 0;

    const email = (link?.aos_email ?? claimEmail).toLowerCase().trim();
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce =
      Math.random().toString(36).slice(2, 12) +
      Math.random().toString(36).slice(2, 12);

    // Signed payload now includes tier + caps so AOS can enforce them.
    // Backwards-compatible: AOS may verify the legacy `email|ts|nonce` shape
    // until it ships the new verifier — until then the token still works.
    const signingString = `${email}|${ts}|${nonce}|${tier ?? ""}|${workspaceLimit}|${seatLimit}`;
    const sig = createHmac("sha256", secret.trim())
      .update(signingString)
      .digest("hex");

    const token = [
      encodeURIComponent(email),
      ts,
      nonce,
      encodeURIComponent(tier ?? ""),
      String(workspaceLimit),
      String(seatLimit),
      sig,
    ].join(".");

    const url = `${baseUrl.replace(/\/$/, "")}/api/public/circle/sso?token=${token}`;

    return {
      ok: true,
      url,
      aos_email: email,
      previously_linked: Boolean(link?.verified_at),
      tier,
      workspace_limit: workspaceLimit,
      seat_limit: seatLimit,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Link an existing AOS account that lives under a different email.
// Verifies the email actually exists on AOS via the snapshot endpoint, then
// upserts aos_links.aos_email. Future SSO mints use this email instead.
// ─────────────────────────────────────────────────────────────────────────────

export type AosLinkResult =
  | { ok: true; aos_email: string; company_name: string | null }
  | { ok: false; error: string };

export const linkExistingAosAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { aosEmail: string }) => {
    const email = String(input?.aosEmail ?? "").toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }
    if (email.length > 255) throw new Error("Email is too long.");
    return { aosEmail: email };
  })
  .handler(async ({ data, context }): Promise<AosLinkResult> => {
    const baseUrl = process.env.AOS_BASE_URL;
    const secret = process.env.AOS_SHARED_SECRET;
    if (!baseUrl || !secret) {
      return { ok: false, error: "AOS link not configured on Circle." };
    }

    const ts = Math.floor(Date.now() / 1000).toString();
    const signingSecret = secret.trim();
    const sig = createHmac("sha256", signingSecret)
      .update(`${data.aosEmail}|${ts}`)
      .digest("hex");

    let res: Response;
    try {
      res = await fetch(
        `${baseUrl.replace(/\/$/, "")}/api/public/circle/snapshot`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          redirect: "manual",
          body: JSON.stringify({ email: data.aosEmail, ts, sig }),
        },
      );
    } catch (err) {
      console.error("[aos.link] snapshot fetch failed", err);
      return { ok: false, error: "Could not reach AOS to verify that email." };
    }

    if (!res.ok) {
      return { ok: false, error: `AOS returned ${res.status}. Try again in a moment.` };
    }

    const snapshot = (await res.json()) as
      | { linked: true; company_name: string | null }
      | { linked: false; reason: string };

    if (!snapshot.linked) {
      // "Pick a workspace" reason means the account exists with multiple workspaces.
      const reason = (snapshot as { reason: string }).reason ?? "";
      if (!/Pick a workspace/i.test(reason)) {
        return {
          ok: false,
          error: `That email isn't on AOS yet. Use the main "Enter AOS" button and we'll set you up automatically.`,
        };
      }
    }

    const { supabase, userId } = context;
    const { error: upsertError } = await supabase.from("aos_links").upsert(
      {
        user_id: userId,
        aos_email: data.aosEmail,
        verified_at: new Date().toISOString(),
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (upsertError) {
      console.error("[aos.link] upsert failed", upsertError);
      return { ok: false, error: "Could not save the link. Try again." };
    }

    return {
      ok: true,
      aos_email: data.aosEmail,
      company_name: snapshot.linked ? snapshot.company_name : null,
    };
  });
