// Circle → AOS pull-based tier sync.
//
// Called by the AOS project when a user signs into AOS directly (i.e. not
// through the Circle SSO handoff). Returns the same tier/limits that
// get_user_aos_limits would resolve, so AOS can overwrite its cached caps.
//
// Auth: HMAC of the canonical signing string using AOS_SHARED_SECRET. The
// signing string format matches the existing SSO token convention:
//   "{email}|{ts}|{nonce}"
// Header: x-aos-signature (hex sha256). Timestamp must be within 60s.

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  ts: z.number().int(),
  nonce: z.string().min(4).max(128),
});

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/public/aos/tier-lookup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.AOS_SHARED_SECRET;
        if (!secret) {
          return new Response("AOS not configured", { status: 500 });
        }

        const sigHeader = request.headers.get("x-aos-signature");
        if (!sigHeader) {
          return new Response("Missing signature", { status: 401 });
        }

        let raw: string;
        try {
          raw = await request.text();
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(JSON.parse(raw));
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        // Replay protection: 60s window.
        const now = Math.floor(Date.now() / 1000);
        if (!Number.isFinite(parsed.ts) || Math.abs(now - parsed.ts) > 60) {
          return new Response("Timestamp out of window", { status: 401 });
        }

        // Verify HMAC against both raw + trimmed secret (matches the SSO
        // handler's tolerance for trailing whitespace in the env var).
        const signingString = `${parsed.email}|${parsed.ts}|${parsed.nonce}`;
        const variants = [secret, secret.trim()].filter(
          (v, i, arr) => v && arr.indexOf(v) === i,
        );
        let ok = false;
        for (const s of variants) {
          const expected = createHmac("sha256", s).update(signingString).digest("hex");
          if (safeEqualHex(sigHeader, expected)) {
            ok = true;
            break;
          }
        }
        if (!ok) {
          return new Response("Bad signature", { status: 401 });
        }

        // Resolve via the email-based RPC. Bypasses RLS via service role.
        const { data, error } = await supabaseAdmin.rpc(
          "get_user_aos_limits_by_email",
          { _email: parsed.email },
        );
        if (error) {
          console.error("[aos-tier-lookup] rpc failed", error);
          return new Response("Lookup failed", { status: 500 });
        }
        const row = Array.isArray(data) ? data[0] : data;
        const tier = (row?.tier as string | null) ?? null;
        const workspaceLimit = (row?.workspace_limit as number | null) ?? 0;
        const seatLimit = (row?.seat_limit as number | null) ?? 0;

        return new Response(
          JSON.stringify({
            email: parsed.email,
            tier, // may be null when no active subscription resolves
            workspaceLimit, // -1 unlimited, 0 no access
            seatLimit, // -1 unlimited, 0 no access
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      },
    },
  },
});
