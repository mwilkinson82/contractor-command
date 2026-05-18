import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateObject } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import {
  SOP_BACKLOG_SYSTEM_PROMPT,
  SOP_DEPARTMENTS,
  buildSopBacklogUserPrompt,
  type SopDepartment,
} from "@/lib/tools/sop-department";

type Body = {
  department?: string;
  stage?: "starting" | "scaling" | "mature";
  seatHeadcount?: number;
  context?: string;
};

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

const PlaySchema = z.object({
  id: z.string().optional().describe("P1, P2, or P3"),
  name: z.string().optional().describe("short, action-led play name"),
  diagnosis: z.string().optional().describe("1-2 sentences reframing the stated problem"),
  mechanism: z.string().optional().describe("1-2 sentences on how the play unlocks throughput"),
  expectedLift: z.string().optional().describe("concrete outcome — projects/week, hours saved, margin pts"),
  risks: z.string().optional().describe("1 sentence on what to watch for"),
});

const ItemSchema = z.object({
  rank: z.coerce.number().optional(),
  playId: z.string().optional().describe("which play this SOP operationalizes — must match a play id"),
  name: z.string().optional(),
  purpose: z.string().optional(),
  trigger: z.string().optional(),
  owner: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  effort: z.enum(["S", "M", "L"]).optional(),
  why: z.string().optional(),
});

const ResultSchema = z.object({
  constraintReframe: z.string().optional(),
  plays: z.array(PlaySchema).min(1).max(3),
  topPlayId: z.string().optional(),
  headline: z.string().optional(),
  buildOrderRationale: z.string().optional(),
  backlog: z.array(ItemSchema).min(1).max(14),
});

export const Route = createFileRoute("/api/sop-backlog")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const userId = await getUserId(request);
        if (!userId) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json()) as Body;
        const dept = (body.department ?? "") as SopDepartment;
        if (!SOP_DEPARTMENTS.includes(dept)) {
          return new Response("Pick a department to build a backlog for.", { status: 400 });
        }
        const stage = body.stage ?? "scaling";
        const seatHeadcount = Math.max(1, Math.min(50, body.seatHeadcount ?? 1));

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const gateway = createLovableAiGatewayProvider(key);

        const tryGenerate = async (modelId: string) =>
          generateObject({
            model: gateway(modelId),
            schema: ResultSchema,
            system: SOP_BACKLOG_SYSTEM_PROMPT,
            prompt: buildSopBacklogUserPrompt({
              department: dept,
              stage,
              seatHeadcount,
              context: body.context,
            }),
          });

        try {
          let object;
          try {
            ({ object } = await tryGenerate("google/gemini-2.5-flash"));
          } catch (primaryErr) {
            console.warn("[sop-backlog] primary model failed, retrying with gpt-5-mini", primaryErr);
            ({ object } = await tryGenerate("openai/gpt-5-mini"));
          }

          const sorted = [...object.backlog].sort((a, b) => a.rank - b.rank);
          const topSop = sorted[0];
          if (!topSop) return new Response("Empty backlog returned. Try again.", { status: 502 });

          return Response.json({
            department: dept,
            constraintReframe: object.constraintReframe,
            plays: object.plays,
            topPlayId: object.topPlayId,
            headline: object.headline,
            buildOrderRationale: object.buildOrderRationale,
            topSop,
            backlog: sorted.slice(0, 12),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed.";
          if (msg.includes("429")) return new Response("Rate limit. Try again in a moment.", { status: 429 });
          if (msg.includes("402")) {
            return new Response("AI credits exhausted. Add credits in Settings → Workspace → Usage.", { status: 402 });
          }
          console.error("[sop-backlog] failed", err);
          return new Response("The model returned an unreadable response. Try again.", { status: 502 });
        }
      },
    },
  },
});
