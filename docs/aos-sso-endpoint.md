# AOS-side endpoint to paste into the AOS project

This goes in the **AOS** project (the alpos.alpcontractorcircle.com app),
NOT in this Circle repo. It's the consume side of the SSO handoff.

## File: `src/routes/api/public/circle/sso.ts`

> Assumes AOS is also a TanStack Start + Supabase project (it is). If the
> file path conventions differ slightly, adjust — the logic is what matters.

```ts
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Token from Circle: `${encodeURIComponent(email)}.${ts}.${nonce}.${sig}`
// Signing string: `${email}|${ts}|${nonce}`
// TTL: 60s (replay window).

const TOKEN_TTL_SECONDS = 60;

export const Route = createFileRoute("/api/public/circle/sso")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (!token) return redirectToLoginWithError("missing_token");

        const parts = token.split(".");
        if (parts.length !== 4) return redirectToLoginWithError("bad_token");
        const [emailEnc, ts, nonce, sig] = parts;

        let email: string;
        try {
          email = decodeURIComponent(emailEnc).toLowerCase().trim();
        } catch {
          return redirectToLoginWithError("bad_token");
        }

        const secret = process.env.AOS_SHARED_SECRET;
        if (!secret) {
          console.error("[circle/sso] AOS_SHARED_SECRET not set");
          return redirectToLoginWithError("server_misconfig");
        }

        // Verify signature (constant-time)
        const expected = createHmac("sha256", secret.trim())
          .update(`${email}|${ts}|${nonce}`)
          .digest("hex");
        try {
          const a = Buffer.from(sig, "hex");
          const b = Buffer.from(expected, "hex");
          if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return redirectToLoginWithError("bad_signature");
          }
        } catch {
          return redirectToLoginWithError("bad_signature");
        }

        // Replay window
        const tsNum = Number(ts);
        const now = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > TOKEN_TTL_SECONDS) {
          return redirectToLoginWithError("token_expired");
        }

        // Find-or-create the AOS user by email
        // (Use whichever AOS auth helper exists; this is the generic pattern.)
        const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
        let userId = existing?.users?.find(
          (u) => u.email?.toLowerCase() === email,
        )?.id;

        if (!userId) {
          const { data: created, error: createErr } =
            await supabaseAdmin.auth.admin.createUser({
              email,
              email_confirm: true,
              user_metadata: { provisioned_by: "circle_sso" },
            });
          if (createErr || !created?.user) {
            console.error("[circle/sso] createUser failed", createErr);
            return redirectToLoginWithError("provision_failed");
          }
          userId = created.user.id;
        }

        // Generate a one-time magic link and immediately redirect through its
        // `action_link` — Supabase sets the session cookie on consume.
        // Set the post-consume `redirectTo` to AOS's dashboard (or workspace
        // picker / onboarding — your routing decides based on user state).
        const { data: linkData, error: linkErr } =
          await supabaseAdmin.auth.admin.generateLink({
            type: "magiclink",
            email,
            options: {
              // Where Supabase sends the user AFTER consuming the magic link.
              // Pick the AOS landing you want — dashboard is the common case.
              redirectTo: `${process.env.AOS_PUBLIC_URL ?? ""}/dashboard`,
            },
          });

        if (linkErr || !linkData?.properties?.action_link) {
          console.error("[circle/sso] generateLink failed", linkErr);
          return redirectToLoginWithError("link_failed");
        }

        // 302 to the magic link. Supabase exchanges the token for a session
        // cookie, then redirects to `redirectTo`.
        return Response.redirect(linkData.properties.action_link, 302);
      },
    },
  },
});

function redirectToLoginWithError(code: string) {
  // Fall back to AOS's normal login screen with an error banner.
  const base = process.env.AOS_PUBLIC_URL ?? "";
  return Response.redirect(`${base}/login?circle_error=${code}`, 302);
}
```

## Required env vars on AOS

- `AOS_SHARED_SECRET` — MUST match the value already set on Circle.
- `AOS_PUBLIC_URL` — e.g. `https://alpos.alpcontractorcircle.com` (used for
  the post-consume redirect). If your AOS project uses a different name for
  this (e.g. `SITE_URL`, `PUBLIC_URL`), substitute it.
- `SUPABASE_SERVICE_ROLE_KEY` — already present on AOS.

## Behavior matrix (matches Circle's expectations)

| AOS account state | What happens |
|---|---|
| Exists with 1 workspace | Magic link → session → land on `/dashboard` |
| Exists with multiple workspaces | Magic link → session → AOS workspace picker (your existing flow) |
| Exists with no workspace | Magic link → session → AOS onboarding |
| Does not exist | `admin.createUser` → magic link → session → AOS onboarding |

## Security notes

- HMAC verified with `timingSafeEqual` — no string comparison shortcuts.
- 60s replay window — short, but long enough to survive a slow redirect.
- `email_confirm: true` on create — these users came from a verified Circle
  signup, no need to re-verify.
- Only `/api/public/*` is exempted from Lovable's auth gate, so no auth
  middleware blocks the inbound redirect.

## After deploying

Test with:
```bash
# On the Circle side, sign in and click "Enter AOS" — you should land
# inside AOS already signed in. No second login screen.
```

If the redirect lands on `/login?circle_error=<code>`, the code tells you
exactly which step failed.
