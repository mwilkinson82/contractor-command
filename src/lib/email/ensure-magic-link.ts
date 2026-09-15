import { buildTokenHashAuthUrl } from "@/lib/auth-link-url";

type SupabaseAdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

// Make sure the auth user exists, then return a one-click magic link that
// signs them straight into the portal. Falls back to null if link generation
// fails — the welcome email is never worth blocking on.
export async function ensureMagicLinkForMember(
  supabaseAdmin: SupabaseAdminClient,
  email: string,
  origin: string,
): Promise<string | null> {
  try {
    const perPage = 200;
    let exists = false;
    for (let page = 1; page <= 25; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const users = data?.users ?? [];
      if (users.some((u) => (u.email ?? "").toLowerCase() === email)) {
        exists = true;
        break;
      }
      if (users.length < perPage) break;
    }
    if (!exists) {
      const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { source: "stripe_purchase", invited_at: new Date().toISOString() },
      });
      // The existence scan above pages through listUsers and can MISS a real
      // user (past its paging window, or on a race). When it does, createUser
      // hits a duplicate-email DB constraint and returns a GENERIC
      // "Database error creating new user" — which contains none of
      // already/registered/exists. Do NOT throw on it: any failure here just
      // means we couldn't create the user, and if they already exist,
      // generateLink below still succeeds and issues their login link.
      if (createErr) {
        console.warn("createUser during welcome-link failed; proceeding to generateLink", {
          email,
          message: createErr.message,
          status: (createErr as { status?: number }).status,
          code: (createErr as { code?: string }).code,
        });
      }
    }
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${origin}/auth/callback` },
    });
    if (error) throw error;
    const tokenHash = data?.properties?.hashed_token;
    return tokenHash ? buildTokenHashAuthUrl({ origin, tokenHash, type: "magiclink" }) : null;
  } catch (err) {
    console.error("ensureMagicLinkForMember failed", { email, err });
    return null;
  }
}

export function appOrigin(): string {
  return (
    process.env.PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    "https://app.alpcontractorcircle.com"
  ).replace(/\/$/, "");
}
