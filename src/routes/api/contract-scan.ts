import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import {
  CONTRACT_SCAN_SYSTEM_PROMPT,
  buildContractScanUserPrompt,
} from "@/lib/tools/contract-readiness";

type Body = { contractText?: string; projectContext?: string };

async function getUserId(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

// Loose schema — Gemini structured output rejects min/max/length constraints
// silently and returns "response did not match schema". Validate softly after.
const DimensionEnum = z.enum(["cash", "schedule", "scope", "margin"]);
const ScanSchema = z.object({
  overallScore: z.number(),
  status: z.enum(["ready", "tighten", "do-not-sign"]),
  headline: z.string(),
  topRisk: z.string(),
  financialConsequence: z.string(),
  recommendedAction: z.string(),
  dimensions: z.array(
    z.object({
      dimension: DimensionEnum,
      score: z.number(),
      status: z.enum(["strong", "weak", "missing"]),
      finding: z.string(),
      clauseToAddOrFix: z.string(),
    }),
  ),
  missingClauses: z.array(z.string()),
});

export const Route = createFileRoute("/api/contract-scan")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const userId = await getUserId(request);
        if (!userId) return new Response("Unauthorized", { status: 401 });

        const { contractText, projectContext } = (await request.json()) as Body;
        if (!contractText || contractText.trim().length < 200) {
          return new Response(
            "Paste more contract text — at least a few hundred characters so the scan has something to read.",
            { status: 400 },
          );
        }
        // Gemini handles long contexts fine but very long prompts cost a lot
        // and risk truncation. Cap input around 120k chars.
        const safeContract =
          contractText.length > 120000 ? contractText.slice(0, 120000) : contractText;

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        try {
          const { text } = await generateText({
            model,
            system:
              CONTRACT_SCAN_SYSTEM_PROMPT +
              "\n\nReturn ONLY a single JSON object. No prose, no markdown, no code fences. The JSON must match this TypeScript type:\n" +
              `{
  overallScore: number,         // 0-100
  status: "ready" | "tighten" | "do-not-sign",
  headline: string,
  topRisk: string,
  financialConsequence: string,
  recommendedAction: string,
  dimensions: Array<{
    dimension: "cash" | "schedule" | "scope" | "margin",
    score: number,              // 0-10
    status: "strong" | "weak" | "missing",
    finding: string,
    clauseToAddOrFix: string
  }>,                            // include all four dimensions
  missingClauses: string[]      // up to 8
}`,
            prompt: buildContractScanUserPrompt({
              contractText: safeContract,
              projectContext,
            }),
          });

          const raw = extractJson(text);
          const parsed = ScanSchema.safeParse(raw);
          if (!parsed.success) {
            console.error("[contract-scan] schema mismatch", parsed.error.issues);
            return new Response(
              "The model returned an unreadable response. Try again, or trim the contract to the key sections.",
              { status: 502 },
            );
          }
          const object = parsed.data;
          const normalized = {
            ...object,
            overallScore: clamp(Math.round(object.overallScore), 0, 100),
            dimensions: ensureDimensions(object.dimensions),
            missingClauses: (object.missingClauses ?? []).slice(0, 8),
          };
          return Response.json(normalized);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Scan failed.";
          if (msg.includes("429")) {
            return new Response("Rate limit. Try again in a moment.", { status: 429 });
          }
          if (msg.includes("402")) {
            return new Response(
              "AI credits exhausted. Add credits in Settings → Workspace → Usage.",
              { status: 402 },
            );
          }
          console.error("[contract-scan] failed", err);
          return new Response(
            "The model returned an unreadable response. Try again, or trim the contract to the key sections.",
            { status: 502 },
          );
        }
      },
    },
  },
});

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function extractJson(text: string): unknown {
  if (!text) return null;
  let t = text.trim();
  // Strip code fences if present
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Find first { and last } to tolerate leading/trailing prose
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  const slice = t.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

type Dim = z.infer<typeof ScanSchema>["dimensions"][number];
function ensureDimensions(dims: Dim[]): Dim[] {
  const order: Dim["dimension"][] = ["cash", "schedule", "scope", "margin"];
  return order.map((d) => {
    const found = dims.find((x) => x.dimension === d);
    if (found) {
      return { ...found, score: clamp(Math.round(found.score), 0, 10) };
    }
    return {
      dimension: d,
      score: 0,
      status: "missing" as const,
      finding: "Model did not return a finding for this dimension.",
      clauseToAddOrFix: "Re-run the scan or paste the relevant section.",
    };
  });
}

