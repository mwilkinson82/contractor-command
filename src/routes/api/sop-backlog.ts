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

const ItemSchema = z.object({
  rank: z.number().describe("1-based position in build order"),
  name: z.string().describe("specific SOP name"),
  purpose: z.string().describe("one sentence on what this SOP exists to do"),
  trigger: z.string().describe("event, cadence, or threshold that fires this SOP"),
  owner: z.string().describe("seat name, not a person"),
  dependsOn: z.array(z.string()).describe("names of earlier SOPs in this backlog this one depends on"),
  effort: z.enum(["S", "M", "L"]),
  why: z.string().describe("what breaks today without this SOP"),
});

const ResultSchema = z.object({
  headline: z.string().describe("one-line read on the backlog"),
  buildOrderRationale: z.string().describe("1-2 sentences on why the sequence is in this order"),
  backlog: z.array(ItemSchema).min(8).max(12),
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
        const model = gateway("google/gemini-3-flash-preview");

        try {
          const { object } = await generateObject({
            model,
            schema: ResultSchema,
            system: SOP_BACKLOG_SYSTEM_PROMPT,
            prompt: buildSopBacklogUserPrompt({
              department: dept,
              stage,
              seatHeadcount,
              context: body.context,
            }),
          });

          const sorted = [...object.backlog].sort((a, b) => a.rank - b.rank);
          const topSop = sorted[0];
          if (!topSop) {
            return new Response("Empty backlog returned. Try again.", { status: 502 });
          }
          return Response.json({
            department: dept,
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

