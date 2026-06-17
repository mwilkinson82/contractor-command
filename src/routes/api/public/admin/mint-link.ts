// Emergency mint-link endpoint. Allow-listed emails only.
// Used during incident response when Supabase recovery emails aren't landing.
// Returns a one-time recovery URL that an operator can hand-deliver.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const ALLOWED = new Set<string>([
  "tyler@honeyrockoutdoors.com",
]);

export const Route = createFileRoute("/api/public/admin/mint-link")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
        const type =
          (url.searchParams.get("type") as "recovery" | "magiclink") || "magiclink";
        if (!ALLOWED.has(email)) {
          return Response.json({ ok: false, error: "not_allowlisted" }, { status: 403 });
        }
        const sb = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false } },
        );
        const { data, error } = await sb.auth.admin.generateLink({
          type,
          email,
          options: {
            redirectTo:
              type === "recovery"
                ? "https://app.alpcontractorcircle.com/reset-password"
                : "https://app.alpcontractorcircle.com/",
          },
        });
        if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
        return Response.json({ ok: true, action_link: data.properties?.action_link });
      },
    },
  },
});
