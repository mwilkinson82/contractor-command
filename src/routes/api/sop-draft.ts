import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateObject } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { SOP_DRAFT_SYSTEM_PROMPT, buildSopDraftPrompt } from "@/lib/tools/sop-draft";

type Body = {
  sopName?: string;
  purpose?: string;
  trigger?: string;
  owner?: string;
  department?: string;
  parentPlay?: { name?: string; mechanism?: string };
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

const StepSchema = z.object({
  number: z.number(),
  action: z.string(),
  detail: z.string().optional().default(""),
});

const DocSchema = z.object({
  title: z.string(),
  department: z.string(),
  owner: z.string(),
  purpose: z.string(),
  scope: z.string(),
  trigger: z.string(),
  inputs: z.array(z.string()).min(1),
  steps: z.array(StepSchema).min(6).max(14),
  outputs: z.array(z.string()).min(1),
  definitionOfDone: z.string(),
  kpis: z.array(z.string()).min(2).max(4),
  exceptions: z.array(z.string()).min(1),
  revisionCadence: z.string(),
});

export const Route = createFileRoute("/api/sop-draft")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const userId = await getUserId(request);
        if (!userId) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json()) as Body;
        if (!body.sopName || !body.department || !body.owner || !body.trigger || !body.purpose) {
          return new Response("Missing required SOP context.", { status: 400 });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const gateway = createLovableAiGatewayProvider(key);
        const model = gateway("google/gemini-3-flash-preview");

        try {
          const { object } = await generateObject({
            model,
            schema: DocSchema,
            system: SOP_DRAFT_SYSTEM_PROMPT,
            prompt: buildSopDraftPrompt({
              sopName: body.sopName,
              purpose: body.purpose,
              trigger: body.trigger,
              owner: body.owner,
              department: body.department,
              parentPlay: body.parentPlay?.name && body.parentPlay?.mechanism
                ? { name: body.parentPlay.name, mechanism: body.parentPlay.mechanism }
                : undefined,
              context: body.context,
            }),
          });

          const steps = [...object.steps]
            .sort((a, b) => a.number - b.number)
            .map((s, i) => ({ ...s, number: i + 1 }));

          return Response.json({ ...object, steps });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed.";
          if (msg.includes("429")) return new Response("Rate limit. Try again in a moment.", { status: 429 });
          if (msg.includes("402")) {
            return new Response("AI credits exhausted. Add credits in Settings → Workspace → Usage.", { status: 402 });
          }
          console.error("[sop-draft] failed", err);
          return new Response("The model returned an unreadable response. Try again.", { status: 502 });
        }
      },
    },
  },
});
