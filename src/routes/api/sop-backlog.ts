import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateText } from "ai";
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
  rank: z.number(),
  name: z.string(),
  purpose: z.string(),
  trigger: z.string(),
  owner: z.string(),
  dependsOn: z.array(z.string()).default([]),
  effort: z.enum(["S", "M", "L"]),
  why: z.string(),
});

const ResultSchema = z.object({
  headline: z.string(),
  buildOrderRationale: z.string(),
  backlog: z.array(ItemSchema),
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
          const { text } = await generateText({
            model,
            system:
              SOP_BACKLOG_SYSTEM_PROMPT +
              "\n\nReturn ONLY a single JSON object. No prose, no markdown, no code fences. Shape:\n" +
              `{
  headline: string,             // one-line read on the backlog
  buildOrderRationale: string,  // 1-2 sentences on why the sequence
  backlog: Array<{
    rank: number,               // 1-based, in build order
    name: string,               // specific SOP name
    purpose: string,            // one sentence
    trigger: string,            // event / cadence / threshold
    owner: string,              // seat name, not a person
    dependsOn: string[],        // names of earlier SOPs in this backlog
    effort: "S" | "M" | "L",
    why: string                 // what breaks today without this
  }>                            // 8 to 12 items
}`,
            prompt: buildSopBacklogUserPrompt({
              department: dept,
              stage,
              seatHeadcount,
              context: body.context,
            }),
          });

          const raw = extractJson(text);
          const parsed = ResultSchema.safeParse(raw);
          if (!parsed.success) {
            console.error("[sop-backlog] schema mismatch", parsed.error.issues);
            return new Response(
              "The model returned an unreadable response. Try again.",
              { status: 502 },
            );
          }
          const sorted = [...parsed.data.backlog].sort((a, b) => a.rank - b.rank);
          const topSop = sorted[0];
          if (!topSop) {
            return new Response("Empty backlog returned. Try again.", { status: 502 });
          }
          return Response.json({
            department: dept,
            headline: parsed.data.headline,
            buildOrderRationale: parsed.data.buildOrderRationale,
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

function extractJson(text: string): unknown {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}
