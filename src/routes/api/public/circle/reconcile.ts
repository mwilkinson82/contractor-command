import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { membershipDb } from "@/lib/membership/circle.server";
import { drainCircleAudienceSync } from "@/lib/membership/reconcile.server";

/** Opt-in scheduler endpoint. No schedule or credential is created by this change. */
export async function handleCircleSweep(request: Request): Promise<Response> {
  if (process.env.CIRCLE_RECONCILIATION_ENABLED !== "true")
    return new Response("Disabled", { status: 503 });
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const actual = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (
    !expected ||
    !actual ||
    actual.length !== expected.length ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  )
    return new Response("Unauthorized", { status: 401 });
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    const { error } = await membershipDb(supabaseAdmin).rpc("queue_circle_audience_sweep");
    if (error) throw new Error(error.message);
    const result = await drainCircleAudienceSync(supabaseAdmin, {
      apiKey: process.env.RESEND_API_KEY ?? "",
    });
    return Response.json(result, { status: result.failed ? 503 : 200 });
  } catch (error) {
    console.error("Circle expiry sweep failed", error);
    return new Response("Circle reconciliation failed", { status: 503 });
  }
}
export const Route = createFileRoute("/api/public/circle/reconcile")({
  server: { handlers: { POST: ({ request }) => handleCircleSweep(request) } },
});
