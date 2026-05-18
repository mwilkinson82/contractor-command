import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateText, Output } from "ai";
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

const ScanSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  status: z.enum(["ready", "tighten", "do-not-sign"]),
  headline: z.string().min(1).max(220),
  topRisk: z.string().min(1).max(400),
  financialConsequence: z.string().min(1).max(400),
  recommendedAction: z.string().min(1).max(400),
  dimensions: z
    .array(
      z.object({
        dimension: z.enum(["cash", "schedule", "scope", "margin"]),
        score: z.number().int().min(0).max(10),
        status: z.enum(["strong", "weak", "missing"]),
        finding: z.string().min(1).max(400),
        clauseToAddOrFix: z.string().min(1).max(400),
      }),
    )
    .length(4),
  missingClauses: z.array(z.string().min(1).max(220)).max(8),
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
        if (contractText.length > 60000) {
          return new Response("Contract too long. Trim to ~50k characters.", {
            status: 413,
          });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        try {
          const { experimental_output } = await generateText({
            model,
            system: CONTRACT_SCAN_SYSTEM_PROMPT,
            prompt: buildContractScanUserPrompt({ contractText, projectContext }),
            experimental_output: Output.object({ schema: ScanSchema }),
          });
          return Response.json(experimental_output);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Scan failed.";
          // Surface gateway-specific failures clearly.
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
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});
