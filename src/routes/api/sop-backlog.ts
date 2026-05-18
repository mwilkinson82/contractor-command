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
  type OptimizationPlay,
  type SopBacklogItem,
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

function text(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function normalizeResult(
  object: z.infer<typeof ResultSchema>,
  dept: SopDepartment,
  seatHeadcount: number,
  context?: string,
) {
  const plays: OptimizationPlay[] = object.plays.map((play, idx) => ({
    id: text(play.id, `P${idx + 1}`).toUpperCase(),
    name: text(play.name, `${dept} scope redesign`),
    diagnosis: text(play.diagnosis, `The constraint is not simply needing more ${dept} people; the seat's work is too broad and hard to hand off cleanly.`),
    mechanism: text(play.mechanism, `Narrow the seat into repeatable phases, define the hand-off gates, and let each person execute a smaller lane with less switching cost.`),
    expectedLift: text(play.expectedLift, `More signed work can move through the existing ${seatHeadcount}-person seat before hiring.`),
    risks: text(play.risks, "If the hand-off criteria are vague, work will still bounce back to the owner."),
  }));
  const topPlayId = text(object.topPlayId, plays[0]?.id ?? "P1");
  const backlog: SopBacklogItem[] = object.backlog.map((item, idx) => ({
    rank: item.rank ?? idx + 1,
    playId: text(item.playId, topPlayId),
    name: text(item.name, `${dept} phase hand-off SOP`),
    purpose: text(item.purpose, `Make the ${dept} seat transferable by defining the exact work, hand-off point, and standard of done.`),
    trigger: text(item.trigger, "When a job reaches the next phase gate or a new contract is ready to be onboarded."),
    owner: text(item.owner, `${dept} seat`),
    dependsOn: item.dependsOn ?? [],
    effort: item.effort ?? "M",
    why: text(item.why, "This removes owner judgment calls, reduces rework, and lets current capacity support more active work."),
  })).sort((a, b) => a.rank - b.rank);

  return {
    constraintReframe: text(object.constraintReframe, context?.trim() || `The ${dept} constraint is a scope-shape problem before it is a hiring problem.`),
    plays,
    topPlayId,
    headline: text(object.headline, `${dept} needs a narrower execution lane before another hire.`),
    buildOrderRationale: text(object.buildOrderRationale, "Build the hand-off and phase-gate SOPs first so every later SOP has a clear trigger, owner, and definition of done."),
    backlog,
  };
}

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

        const userPrompt = `${buildSopBacklogUserPrompt({
          department: dept,
          stage,
          seatHeadcount,
          context: body.context,
        })}\n\nReturn your answer as a single JSON object matching the schema.`;

        const tryGenerate = async (modelId: string) =>
          generateObject({
            model: gateway(modelId),
            schema: ResultSchema,
            mode: "json",
            system: `${SOP_BACKLOG_SYSTEM_PROMPT}\n\nReturn a valid JSON object that matches the requested schema.`,
            prompt: userPrompt,
          });

        try {
          let object;
          try {
            ({ object } = await tryGenerate("google/gemini-2.5-pro"));
          } catch (primaryErr) {
            console.warn("[sop-backlog] primary model failed, retrying with gpt-5-mini", primaryErr);
            ({ object } = await tryGenerate("openai/gpt-5-mini"));
          }

          const normalized = normalizeResult(object, dept, seatHeadcount, body.context);
          const sorted = normalized.backlog;
          const topSop = sorted[0];
          if (!topSop) return new Response("Empty backlog returned. Try again.", { status: 502 });

          return Response.json({
            department: dept,
            constraintReframe: normalized.constraintReframe,
            plays: normalized.plays,
            topPlayId: normalized.topPlayId,
            headline: normalized.headline,
            buildOrderRationale: normalized.buildOrderRationale,
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
