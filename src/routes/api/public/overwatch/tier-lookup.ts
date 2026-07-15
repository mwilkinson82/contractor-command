import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  isOverwatchIncludedTier,
  overwatchEntitlementSigningString,
  verifyOverwatchEntitlementSignature,
} from "@/lib/overwatch-entitlement";

const BodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  ts: z.number().int(),
  nonce: z.string().min(4).max(128),
});

export const Route = createFileRoute("/api/public/overwatch/tier-lookup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CONTRACTOR_CIRCLE_SHARED_SECRET;
        if (!secret) {
          return new Response("OverWatch membership sync is not configured", { status: 500 });
        }

        const signature = request.headers.get("x-overwatch-signature");
        if (!signature) return new Response("Missing signature", { status: 401 });

        let parsed: z.infer<typeof BodySchema>;
        try {
          parsed = BodySchema.parse(await request.json());
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - parsed.ts) > 60) {
          return new Response("Timestamp out of window", { status: 401 });
        }

        const signingString = overwatchEntitlementSigningString(parsed);
        const secrets = [secret, secret.trim()].filter(
          (value, index, values) => value && values.indexOf(value) === index,
        );
        const verified = verifyOverwatchEntitlementSignature({
          signature,
          signingString,
          secrets,
        });
        if (!verified) return new Response("Bad signature", { status: 401 });

        const { data, error } = await supabaseAdmin.rpc("get_user_aos_limits_by_email", {
          _email: parsed.email,
        });
        if (error) {
          console.error("[overwatch-tier-lookup] membership lookup failed", {
            email: parsed.email,
            error,
          });
          return new Response("Lookup failed", { status: 500 });
        }

        const row = Array.isArray(data) ? data[0] : data;
        const tier = typeof row?.tier === "string" ? row.tier : null;
        return new Response(
          JSON.stringify({
            email: parsed.email,
            tier,
            eligible: isOverwatchIncludedTier(tier),
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          },
        );
      },
    },
  },
});
