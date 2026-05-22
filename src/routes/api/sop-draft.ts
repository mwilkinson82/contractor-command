import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import {
  SOP_DRAFT_SYSTEM_PROMPT,
  buildSopDraftPrompt,
  type SopDocument,
  type SopStep,
} from "@/lib/tools/sop-draft";

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
  number: z.coerce.number().optional(),
  action: z.string().optional(),
  detail: z.string().optional(),
});

const DocSchema = z.object({
  title: z.string().optional(),
  department: z.string().optional(),
  owner: z.string().optional(),
  purpose: z.string().optional(),
  scope: z.string().optional(),
  trigger: z.string().optional(),
  inputs: z.array(z.string()).optional(),
  steps: z.array(StepSchema).optional(),
  outputs: z.array(z.string()).optional(),
  definitionOfDone: z.string().optional(),
  kpis: z.array(z.string()).optional(),
  exceptions: z.array(z.string()).optional(),
  revisionCadence: z.string().optional(),
});

function s(v: string | undefined, fallback: string) {
  return v?.trim() || fallback;
}
function arr(v: string[] | undefined, fallback: string[]) {
  const cleaned = (v ?? []).map((x) => x?.trim()).filter((x): x is string => !!x);
  return cleaned.length ? cleaned : fallback;
}

function extractJsonObject(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found in model response.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function generateWithTimeout<T>(task: (signal: AbortSignal) => Promise<T>, ms = 16000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort("SOP draft timed out");
      reject(new Error("SOP draft timed out"));
    }, ms);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fallbackDoc(body: Required<Pick<Body, "sopName" | "purpose" | "trigger" | "owner" | "department">>): SopDocument {
  const { sopName, purpose, trigger, owner, department } = body;
  const steps: SopStep[] = [
    { number: 1, action: `Open the ${department} workspace and locate the current ${sopName} record.`, detail: "Confirm you have the latest version before making any edits." },
    { number: 2, action: "Confirm the trigger condition is actually met.", detail: trigger },
    { number: 3, action: "Pull required inputs into one folder or record.", detail: "Bid recap, contract exhibits, prior hand-off notes, scope-of-work sheet." },
    { number: 4, action: "Verify scope, authority, and ownership boundaries for this work.", detail: "Anything outside the defined lane gets escalated, not absorbed." },
    { number: 5, action: "Execute the core action defined by this SOP.", detail: "Follow the phase standard; do not invent steps." },
    { number: 6, action: "Document decisions, exceptions, and any deviation from standard.", detail: "Use the SOP log; one line per decision." },
    { number: 7, action: "Hand off to the next owner with the standard packet.", detail: "Packet must include: status, blockers, decisions made, what the next owner must do next." },
    { number: 8, action: "Mark the SOP record complete and update the seat scorecard.", detail: "Capture cycle time and any rework events." },
  ];
  return {
    title: sopName,
    department,
    owner,
    purpose,
    scope: `In scope: the ${sopName.toLowerCase()} workflow as owned by the ${owner}. Out of scope: upstream intake decisions and downstream client communication unless escalated.`,
    trigger,
    inputs: [
      "Current contract / scope-of-work",
      "Prior hand-off packet (if any)",
      "Active project schedule",
      "Open RFIs and decision log",
    ],
    steps,
    outputs: [
      "Completed hand-off packet",
      "Updated SOP log entry",
      "Scorecard metric updates",
    ],
    definitionOfDone: `The next seat can act on the packet without asking the ${owner} a single clarifying question.`,
    kpis: [
      "Cycle time from trigger to hand-off → < 48h",
      "Rework events per 10 completions → < 1",
      "Escalations per 10 completions → < 2",
    ],

    exceptions: [
      "Missing inputs at trigger → escalate to seat lead, do not start.",
      "Scope change discovered mid-execution → pause, log, escalate to owner before proceeding.",
      "Downstream seat rejects the packet → reopen this SOP, log root cause, do not silently fix.",
    ],
    revisionCadence: "Review quarterly, or any time the scorecard shows 2 consecutive weeks of rework or escalation breaches.",
  };
}

function normalize(
  raw: z.infer<typeof DocSchema>,
  body: Required<Pick<Body, "sopName" | "purpose" | "trigger" | "owner" | "department">>,
): SopDocument {
  const fb = fallbackDoc(body);
  const steps = (raw.steps ?? [])
    .map((st, i) => ({
      number: typeof st.number === "number" && Number.isFinite(st.number) ? st.number : i + 1,
      action: s(st.action, fb.steps[i]?.action ?? "Execute the next defined step."),
      detail: st.detail?.trim() || undefined,
    }))
    .filter((st) => !!st.action)
    .sort((a, b) => a.number - b.number)
    .map((st, i) => ({ ...st, number: i + 1 }));

  return {
    title: s(raw.title, fb.title),
    department: s(raw.department, fb.department),
    owner: s(raw.owner, fb.owner),
    purpose: s(raw.purpose, fb.purpose),
    scope: s(raw.scope, fb.scope),
    trigger: s(raw.trigger, fb.trigger),
    inputs: arr(raw.inputs, fb.inputs),
    steps: steps.length >= 6 ? steps.slice(0, 14) : fb.steps,
    outputs: arr(raw.outputs, fb.outputs),
    definitionOfDone: s(raw.definitionOfDone, fb.definitionOfDone),
    kpis: arr(raw.kpis, fb.kpis),
    exceptions: arr(raw.exceptions, fb.exceptions),
    revisionCadence: s(raw.revisionCadence, fb.revisionCadence),
  };
}

const jsonShape = `Required JSON shape: {"title":"string","department":"string","owner":"string","purpose":"string","scope":"string","trigger":"string","inputs":["string"],"steps":[{"number":1,"action":"string","detail":"string"}],"outputs":["string"],"definitionOfDone":"string","kpis":["string"],"exceptions":["string"],"revisionCadence":"string"}`;

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

        const required = {
          sopName: body.sopName,
          purpose: body.purpose,
          trigger: body.trigger,
          owner: body.owner,
          department: body.department,
        };

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const gateway = createLovableAiGatewayProvider(key);

        const userPrompt = `${buildSopDraftPrompt({
          sopName: body.sopName,
          purpose: body.purpose,
          trigger: body.trigger,
          owner: body.owner,
          department: body.department,
          parentPlay: body.parentPlay?.name && body.parentPlay?.mechanism
            ? { name: body.parentPlay.name, mechanism: body.parentPlay.mechanism }
            : undefined,
          context: body.context,
        })}\n\nReturn your answer as a single JSON object matching the schema.\n\n${jsonShape}`;

        const tryGenerate = async (modelId: string, signal: AbortSignal) => {
          const { text } = await generateText({
            model: gateway(modelId),
            system: `${SOP_DRAFT_SYSTEM_PROMPT}\n\nReturn only valid JSON. No markdown. No prose outside the JSON object.`,
            prompt: userPrompt,
            abortSignal: signal,
          });
          return DocSchema.parse(extractJsonObject(text));
        };

        try {
          let raw: z.infer<typeof DocSchema>;
          try {
            raw = await generateWithTimeout((signal) => tryGenerate("google/gemini-2.5-pro", signal));
          } catch (primaryErr) {
            const msg = primaryErr instanceof Error ? primaryErr.message : "Failed.";
            if (msg.includes("429")) return new Response("Rate limit. Try again in a moment.", { status: 429 });
            if (msg.includes("402")) return new Response("AI credits exhausted. Add credits in Settings → Workspace → Usage.", { status: 402 });
            console.warn("[sop-draft] model failed, using deterministic SOP draft", primaryErr);
            return Response.json(fallbackDoc(required));
          }

          return Response.json(normalize(raw, required));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Failed.";
          if (msg.includes("429")) return new Response("Rate limit. Try again in a moment.", { status: 429 });
          if (msg.includes("402")) {
            return new Response("AI credits exhausted. Add credits in Settings → Workspace → Usage.", { status: 402 });
          }
          console.error("[sop-draft] failed", err);
          // Last-resort: still give the user a usable draft instead of a hard error.
          return Response.json(fallbackDoc(required));
        }
      },
    },
  },
});
