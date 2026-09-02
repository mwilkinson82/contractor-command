import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { upsertResendCapture } from "@/lib/resend/capture";
import { captureCorsHeaders } from "@/lib/resend/cors";
import { CAPTURE_SEGMENTS, DEFAULT_CAPTURE_SEGMENT } from "@/lib/resend/segments";

const CaptureBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  segment: z.enum(CAPTURE_SEGMENTS).optional(),
  source: z.string().trim().max(500).optional(),
  source_url: z.string().trim().max(2000).optional(),
  magnet: z.string().trim().max(500).optional(),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  company: z.string().trim().max(200).optional(),
});

function jsonResponse(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...captureCorsHeaders(origin),
    },
  });
}

export const Route = createFileRoute("/api/public/resend/capture")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        return new Response(null, {
          status: 204,
          headers: captureCorsHeaders(request.headers.get("origin")),
        });
      },
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");

        let parsed: z.infer<typeof CaptureBodySchema>;
        try {
          parsed = CaptureBodySchema.parse(await request.json());
        } catch {
          return jsonResponse({ ok: false, error: "Invalid body" }, 400, origin);
        }

        const segment = parsed.segment ?? DEFAULT_CAPTURE_SEGMENT;
        const source = parsed.source || parsed.source_url || parsed.magnet || "unknown";

        try {
          const result = await upsertResendCapture({
            email: parsed.email,
            segment,
            source,
            source_url: parsed.source_url,
            magnet: parsed.magnet,
            firstName: parsed.firstName,
            lastName: parsed.lastName,
            company: parsed.company,
          });
          return jsonResponse(
            {
              ok: true,
              contactId: result.contactId,
              segment: result.segment,
              ...(result.skipped ? { skipped: true } : {}),
            },
            200,
            origin,
          );
        } catch (err) {
          console.error("Resend capture failed", { email: parsed.email, segment, err });
          return jsonResponse({ ok: false, error: "Capture failed" }, 500, origin);
        }
      },
    },
  },
});
