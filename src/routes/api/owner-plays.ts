import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import type { OptimizationPlay, SopBacklogItem } from "@/lib/tools/sop-department";
import {
  OWNER_PLAYS_SYSTEM_PROMPT,
  buildOwnerPlaysUserPrompt,
  type OwnerPlaysResult,
} from "@/lib/tools/owner-plays";

type Body = {
  area?: string;
  hoursPerWeek?: number;
  blastRadius?: number;
  setupEffort?: number;
  frequency?: number;
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
  id: z.string().optional(),
  name: z.string().optional(),
  diagnosis: z.string().optional(),
  mechanism: z.string().optional(),
  expectedLift: z.string().optional(),
  risks: z.string().optional(),
});

const ItemSchema = z.object({
  rank: z.coerce.number().optional(),
  playId: z.string().optional(),
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
  headline: z.string().optional(),
  plays: z.array(PlaySchema).min(1).max(5),
  topPlayId: z.string().optional(),
  backlog: z.array(ItemSchema).min(1).max(6),
});

function text(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function extractJsonObject(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found in model response.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function normalize(
  object: z.infer<typeof ResultSchema>,
  area: string,
  hoursPerWeek: number,
): OwnerPlaysResult {
  const plays: OptimizationPlay[] = object.plays.map((p, idx) => ({
    id: text(p.id, `P${idx + 1}`).toUpperCase(),
    name: text(p.name, `${area} extraction play`),
    diagnosis: text(p.diagnosis, `The owner is still inside ${area} because the decision rights and recurring rhythm live in their head, not in a seat.`),
    mechanism: text(p.mechanism, `Transfer the work to a named seat with a written cadence, decision thresholds, and a fallback if the seat needs to escalate.`),
    expectedLift: text(p.expectedLift, `Roughly ${Math.max(1, Math.round(hoursPerWeek * 0.6))}h/wk of owner time recovered.`),
    risks: text(p.risks, "If the escalation thresholds are vague, the work bounces back to the owner inside 30 days."),
  }));
  const topPlayId = text(object.topPlayId, plays[0]?.id ?? "P1");
  const backlog: SopBacklogItem[] = object.backlog.map((it, idx) => ({
    rank: it.rank ?? idx + 1,
    playId: text(it.playId, topPlayId),
    name: text(it.name, `${area} transfer SOP`),
    purpose: text(it.purpose, `Make the ${area} work transferable by defining who runs it, when, and where the owner stays involved.`),
    trigger: text(it.trigger, "Standing weekly cadence."),
    owner: text(it.owner, "Designated seat"),
    dependsOn: it.dependsOn ?? [],
    effort: it.effort ?? "M",
    why: text(it.why, `Recovers ~${Math.max(1, Math.round(hoursPerWeek * 0.6))}h/wk of owner capacity once it sticks.`),
  })).sort((a, b) => a.rank - b.rank);

  const topSop = backlog[0];

  return {
    area,
    hoursPerWeek,
    annualHoursAtStake: hoursPerWeek * 50,
    constraintReframe: text(
      object.constraintReframe,
      `${area} still routes through the owner because the seat that should own it either does not exist yet or has no written rhythm to run.`,
    ),
    headline: text(object.headline, `Extract the owner from ${area} by transferring it with rules, not vibes.`),
    plays,
    topPlayId,
    backlog,
    topSop,
  };
}

function fallback(area: string, hoursPerWeek: number, context?: string): OwnerPlaysResult {
  const recovered = Math.max(1, Math.round(hoursPerWeek * 0.65));
  const plays: OptimizationPlay[] = [
    {
      id: "P1",
      name: `Delegate · Move ${area.toLowerCase()} to a named seat with a written cadence`,
      diagnosis: `${area} still routes through the owner because no seat owns the recurring rhythm with clear decision thresholds.`,
      mechanism: "Pick the seat that already has the relationship surface area, write the cadence (when, what, to whom), and define what escalates back to the owner.",
      expectedLift: `~${recovered}h/wk of owner time recovered, with no degradation in quality if escalation thresholds are explicit.`,
      risks: "If the seat lacks authority to make routine decisions, the work bounces back inside 2-3 weeks.",
    },
    {
      id: "P2",
      name: `Batch · Collapse ${area.toLowerCase()} into two fixed owner windows per week`,
      diagnosis: "The owner gets pulled in continuously because there is no protected window — every request feels urgent because there is no scheduled answer-time.",
      mechanism: "Publish two recurring windows (e.g. Tue/Thu 9-10am). Outside those windows, the seat handles or queues. Owner only touches what's queued.",
      expectedLift: `Cuts ${area.toLowerCase()} context-switching by ~70% without changing what gets answered.`,
      risks: "The first 2 weeks the owner has to refuse out-of-window asks. Without that discipline, the batch dies.",
    },
    {
      id: "P3",
      name: `Systematize · Decision log + escalation thresholds so others can answer in the owner's voice`,
      diagnosis: "Decisions live in the owner's head, so the seat has to ask every time.",
      mechanism: "Write a 1-page decision log: 'For X under $Y, answer Z. Over $Y, escalate.' Updated after every owner intervention.",
      expectedLift: "Removes 60-80% of the 'quick question' interruptions within 30 days.",
      risks: "The log decays if it is not updated after each new exception. Assign maintenance to the seat that uses it.",
    },
  ];
  const backlog: SopBacklogItem[] = [
    {
      rank: 1,
      playId: "P1",
      name: `${area} — Seat Transfer Charter SOP`,
      purpose: `Name the seat that owns ${area.toLowerCase()}, what decisions they can make, what escalates to the owner, and the cadence they run.`,
      trigger: "Before the first delegated cycle. Reviewed quarterly.",
      owner: "Owner (one-time author) → seat owner thereafter",
      dependsOn: [],
      effort: "M",
      why: `Without an explicit charter, the seat will ask the owner anyway and the ${recovered}h/wk recovery never lands.`,
    },
    {
      rank: 2,
      playId: "P1",
      name: `${area} — Standing Cadence SOP`,
      purpose: "Define the recurring rhythm (day/time/format) the seat runs without owner involvement.",
      trigger: "Calendar — weekly or bi-weekly recurring.",
      owner: "Designated seat",
      dependsOn: [`${area} — Seat Transfer Charter SOP`],
      effort: "S",
      why: "A predictable cadence is the lowest-cost way to prevent ad-hoc interruptions.",
    },
    {
      rank: 3,
      playId: "P1",
      name: `${area} — Escalation Threshold SOP`,
      purpose: "List the exact dollar, schedule, and risk thresholds that route a decision back to the owner.",
      trigger: "Any request the seat is unsure about during the standing cadence.",
      owner: "Designated seat",
      dependsOn: [`${area} — Seat Transfer Charter SOP`],
      effort: "M",
      why: "Clear thresholds are what separate a transferred function from a delayed one.",
    },
  ];
  return {
    area,
    hoursPerWeek,
    annualHoursAtStake: hoursPerWeek * 50,
    constraintReframe: context?.trim()
      ? `In the owner's own words: "${context.trim().slice(0, 220)}" — this is a seat/cadence problem, not an owner-skill problem.`
      : `${area} still routes through the owner because no seat owns the recurring rhythm and decision thresholds. That's a structural gap, not a discipline gap.`,
    headline: `Transfer ${area.toLowerCase()} to a named seat with written rules. Recover ~${recovered}h/wk.`,
    plays,
    topPlayId: "P1",
    backlog,
    topSop: backlog[0],
  };
}

export const Route = createFileRoute("/api/owner-plays")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const userId = await getUserId(request);
        if (!userId) return new Response("Unauthorized", { status: 401 });

        const body = (await request.json()) as Body;
        const area = (body.area ?? "").trim();
        if (!area) return new Response("Missing area.", { status: 400 });
        const hoursPerWeek = Math.max(0, Math.min(80, Number(body.hoursPerWeek ?? 0) || 0));
        const blastRadius = Math.max(1, Math.min(5, Number(body.blastRadius ?? 3) || 3));
        const setupEffort = Math.max(1, Math.min(5, Number(body.setupEffort ?? 3) || 3));
        const frequency = Math.max(1, Math.min(5, Number(body.frequency ?? 3) || 3));

        const key = process.env.LOVABLE_API_KEY;
        if (!key) {
          return Response.json(fallback(area, hoursPerWeek, body.context));
        }

        const gateway = createLovableAiGatewayProvider(key);
        const userPrompt = `${buildOwnerPlaysUserPrompt({
          area, hoursPerWeek, blastRadius, setupEffort, frequency, context: body.context,
        })}\n\nReturn your answer as a single JSON object.`;

        const jsonShape = `Required JSON shape: {"constraintReframe":"string","headline":"string","plays":[{"id":"P1","name":"Delegate · ...","diagnosis":"string","mechanism":"string","expectedLift":"string","risks":"string"}],"topPlayId":"P1","backlog":[{"rank":1,"playId":"P1","name":"string","purpose":"string","trigger":"string","owner":"string","dependsOn":[],"effort":"M","why":"string"}]}`;

        const tryGenerate = async (modelId: string, signal: AbortSignal) => {
          const { text: t } = await generateText({
            model: gateway(modelId),
            system: `${OWNER_PLAYS_SYSTEM_PROMPT}\n\nReturn only valid JSON. No markdown. No prose outside the JSON object.`,
            prompt: `${userPrompt}\n\n${jsonShape}`,
            abortSignal: signal,
          });
          return ResultSchema.parse(extractJsonObject(t));
        };

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 18000);
          try {
            const object = await tryGenerate("google/gemini-3-flash-preview", controller.signal);
            const normalized = normalize(object, area, hoursPerWeek);
            return Response.json(normalized);
          } finally {
            clearTimeout(timer);
          }
        } catch (err) {
          console.error("owner-plays generation failed, returning fallback", err);
          return Response.json(fallback(area, hoursPerWeek, body.context));
        }
      },
    },
  },
});
