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

    const ts = Math.floor(Date.now() / 1000).toString();
    const normalizedEmail = email.toLowerCase().trim();

    try {
      let res: Response | null = null;
      for (const signingSecret of secretVariants(secret)) {
        const sig = createHmac("sha256", signingSecret)
          .update(`${normalizedEmail}|${ts}`)
          .digest("hex");

        res = await fetch(
          `${baseUrl.replace(/\/$/, "")}/api/public/circle/snapshot`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            redirect: "manual",
            body: JSON.stringify({
              email: normalizedEmail,
              ts,
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

      const snapshot = (await res.json()) as AosSnapshot;

      // Look up any previously-verified link for this Circle user
      const { supabase, userId } = context;
      const { data: existingLink } = await supabase
        .from("aos_links")
        .select("verified_at")
        .eq("user_id", userId)
        .maybeSingle();
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
