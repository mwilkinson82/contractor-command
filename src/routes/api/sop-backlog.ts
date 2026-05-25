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

type NormalizedBacklog = ReturnType<typeof normalizeResult> & { topSop: SopBacklogItem };

function extractJsonObject(raw: string) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object found in model response.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

const CONTEXT_STOP_WORDS = new Set([
  "about", "after", "again", "also", "because", "before", "being", "company", "context",
  "create", "department", "does", "else", "from", "have", "into", "just", "make", "more",
  "need", "needs", "other", "process", "project", "seat", "something", "that", "their",
  "them", "then", "there", "they", "this", "when", "where", "which", "with", "workflow",
]);

const DEPARTMENT_KEYWORDS: Record<SopDepartment, string[]> = {
  Estimating: ["estimate", "estimating", "bid", "bids", "takeoff", "pricing", "proposal"],
  "Project Management": ["project manager", "project management", "pm", "violation", "violations", "fine", "fines", "dispute", "disputed", "payment", "permit", "parking"],
  "Field Operations": ["superintendent", "field", "crew", "site walk", "install", "foreman", "production"],
  "Pre-Construction": ["pre-con", "preconstruction", "submittal", "buyout", "schedule", "procurement"],
  Safety: ["safety", "incident", "osha", "toolbox", "ppe", "hazard"],
  "Admin & Finance": ["invoice", "billing", "collections", "payables", "receivables", "payroll"],
  "Business Development": ["lead", "pipeline", "sales", "proposal", "follow-up", "opportunity"],
};

function extractSignalWords(input?: string) {
  return [...new Set(
    (input ?? "")
      .toLowerCase()
      .match(/[a-z][a-z-]{3,}/g)?.filter((word) => !CONTEXT_STOP_WORDS.has(word)) ?? [],
  )].slice(0, 12);
}

function detectDepartmentFromContext(context?: string): SopDepartment | null {
  const lower = (context ?? "").toLowerCase();
  if (!lower.trim()) return null;

  let best: { dept: SopDepartment; score: number } | null = null;
  for (const dept of SOP_DEPARTMENTS) {
    const score = DEPARTMENT_KEYWORDS[dept].reduce((sum, keyword) => sum + (lower.includes(keyword) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) {
      best = { dept, score };
    }
  }

  return best?.score ? best.dept : null;
}

function deriveContextAnchors(context?: string) {
  const lower = (context ?? "").toLowerCase();
  if (!lower.trim()) return [];

  const anchorPatterns: Array<[RegExp, string]> = [
    [/(parking|permit)\s+(fine|violation)s?/i, "parking or permit fine / violation intake"],
    [/(review).*(accuracy|efficacy)|(accuracy|efficacy).*(review)/i, "review the notice for accuracy / efficacy before action"],
    [/(disput|appeal|contest)/i, "decide whether the notice should be disputed"],
    [/(pay|payment|processing).*(late fee)|(late fee).*(pay|payment|processing)/i, "route valid notices into payment processing fast enough to avoid late fees"],
    [/project manager/i, "project manager owns the first review and decision"],
    [/violation/i, "violation review workflow"],
    [/fine/i, "fine handling workflow"],
  ];

  const anchors = anchorPatterns
    .filter(([pattern]) => pattern.test(lower))
    .map(([, label]) => label as string);

  return [...new Set([...anchors, ...extractSignalWords(context)])].slice(0, 8);
}

function validateBacklogMatchesIntent(
  object: z.infer<typeof ResultSchema>,
  body: Body,
) {
  const combined = [
    object.constraintReframe,
    object.headline,
    object.buildOrderRationale,
    ...object.plays.flatMap((play) => [play.name, play.diagnosis, play.mechanism, play.expectedLift, play.risks]),
    ...object.backlog.flatMap((item) => [item.name, item.purpose, item.trigger, item.owner, item.why, ...(item.dependsOn ?? [])]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const signalWords = extractSignalWords(body.context);
  if (signalWords.length > 0) {
    const matchedSignals = signalWords.filter((word) => combined.includes(word));
    const matchRatio = matchedSignals.length / signalWords.length;
    if (matchedSignals.length === 0 || matchRatio < 0.25) {
      throw new Error("Backlog ignored the user context.");
    }
  }

  const contextLower = (body.context ?? "").toLowerCase();
  if (contextLower.includes("violation") || contextLower.includes("fine")) {
    const requiredConcepts = ["violation", "fine", "disput", "payment", "late fee"];
    const conceptMatches = requiredConcepts.filter((term) => combined.includes(term));
    if (conceptMatches.length < 2) {
      throw new Error("Backlog missed the core violation-handling workflow.");
    }
  }

  const genericBacklogCount = object.backlog.filter((item) =>
    /seat scope|scope & authority|intake gate|work queue review|standard of done|exception escalation|scorecard update/i.test(
      [item.name, item.purpose, item.why].filter(Boolean).join(" "),
    ),
  ).length;

  if ((body.context ?? "").trim() && genericBacklogCount >= 4) {
    throw new Error("Backlog fell back to generic seat boilerplate.");
  }
}

async function generateWithTimeout<T>(task: (signal: AbortSignal) => Promise<T>, ms = 25000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort("SOP backlog generation timed out");
      reject(new Error("SOP backlog generation timed out"));
    }, ms);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fallbackResult(dept: SopDepartment, seatHeadcount: number, context?: string): NormalizedBacklog {
  const isPm = dept === "Project Management";
  const constraint = context?.trim()
    ? `The stated issue is not just workload: ${context.trim()} The operating constraint is that the ${dept} seat owns too wide a lane, so every job forces the same people to context-switch instead of executing a narrow phase standard.`
    : `The ${dept} constraint is a scope-shape problem before it is a hiring problem. The seat is carrying too many phases, exceptions, and judgment calls for ${seatHeadcount} person${seatHeadcount === 1 ? "" : "s"} to run consistently.`;

  if (isPm) {
    return {
      constraintReframe: constraint,
      plays: [
        {
          id: "P1",
          name: "Split PM ownership into phase lanes",
          diagnosis: "One PM owning a job from pre-con through closeout serializes the business. The choke point is broad PM scope, not simply the number of PMs.",
          mechanism: "Create Ground / Rough-In / Finish / Closeout lanes with exact phase-gate hand-offs so each PM executes a narrower window and can carry more jobs without losing control.",
          expectedLift: "More active jobs per PM with fewer dropped hand-offs and less owner escalation.",
          risks: "If phase gates are vague, work will bounce between PMs and create duplicate follow-up.",
        },
        {
          id: "P2",
          name: "Move PM admin into a coordinator queue",
          diagnosis: "PM bandwidth is being spent on updates, document chasing, and status packaging instead of job control.",
          mechanism: "A coordinator owns the recurring admin packet while PMs handle decisions, constraints, subcontractor execution, and client exceptions.",
          expectedLift: "5-8 PM hours/week recovered per seat holder.",
          risks: "The queue fails if the coordinator lacks clear escalation thresholds.",
        },
      ],
      topPlayId: "P1",
      headline: "Project Management needs narrower phase ownership before another hire.",
      buildOrderRationale: "Build the phase lane definitions and hand-off gates first. Every later SOP depends on knowing exactly where one PM lane ends, what proof transfers, and who owns the next decision.",
      topSop: {
        rank: 1,
        playId: "P1",
        name: "PM Phase Lane Definition SOP",
        purpose: "Define the PM lanes, authority, hand-off points, and standards of done so the seat can carry more work without one PM owning every stage.",
        trigger: "Before assigning any new project to a PM or rebalancing active jobs.",
        owner: "Project Management Lead",
        dependsOn: [],
        effort: "M",
        why: "Without phase lanes, every hand-off SOP is built on mud and the owner keeps absorbing unclear accountability.",
      },
      backlog: [
        { rank: 1, playId: "P1", name: "PM Phase Lane Definition SOP", purpose: "Define each PM phase lane, authority, standard of done, and hand-off boundary.", trigger: "Before assigning or rebalancing project work.", owner: "Project Management Lead", dependsOn: [], effort: "M", why: "Narrow lanes reduce switching cost and stop every PM from carrying the whole job in their head." },
        { rank: 2, playId: "P1", name: "Pre-Con to Ground PM Intake SOP", purpose: "Transfer contract, scope, budget, schedule, buyout status, and open risks into the first PM lane.", trigger: "Contract signed or notice-to-proceed issued.", owner: "Ground PM", dependsOn: ["PM Phase Lane Definition SOP"], effort: "M", why: "Bad intake creates the rework that burns PM capacity for the rest of the job." },
        { rank: 3, playId: "P1", name: "Phase-Gate Readiness Checklist SOP", purpose: "Create a pass/fail checklist for whether a job is ready to move to the next PM lane.", trigger: "Seven days before any scheduled phase hand-off.", owner: "Current Phase PM", dependsOn: ["PM Phase Lane Definition SOP"], effort: "S", why: "The next PM should receive a clean job, not a pile of unresolved exceptions." },
        { rank: 4, playId: "P1", name: "Ground-to-Rough-In Hand-off SOP", purpose: "Package site conditions, RFIs, procurement risks, schedule constraints, and subcontractor commitments for the next lane.", trigger: "Ground work reaches the approved rough-in start threshold.", owner: "Ground PM", dependsOn: ["Phase-Gate Readiness Checklist SOP"], effort: "M", why: "This prevents the same field problem from being rediscovered by the next PM at full cost." },
        { rank: 5, playId: "P1", name: "Rough-In-to-Finishes Hand-off SOP", purpose: "Transfer inspection status, MEP constraints, finish lead times, owner decisions, and variance risks.", trigger: "Rough-in sign-off is scheduled or completed.", owner: "Rough-In PM", dependsOn: ["Phase-Gate Readiness Checklist SOP"], effort: "M", why: "Finish-phase delays are expensive because they hit client experience, schedule, and punch at the same time." },
        { rank: 6, playId: "P1", name: "PM Load Board Update SOP", purpose: "Show every active job by phase, PM lane, next gate, blocked item, and escalation owner.", trigger: "Weekly PM meeting and any phase hand-off request.", owner: "PM Coordinator", dependsOn: ["PM Phase Lane Definition SOP"], effort: "S", why: "You cannot optimize PM bandwidth if active work is invisible until someone is drowning." },
        { rank: 7, playId: "P1", name: "RFI / Submittal Escalation Triage SOP", purpose: "Sort RFIs and submittals by dollar risk, schedule risk, and decision owner before they jam the PM lane.", trigger: "Any RFI/submittal aging past the agreed threshold or blocking the next gate.", owner: "Assigned Phase PM", dependsOn: ["PM Load Board Update SOP"], effort: "M", why: "A small unanswered item becomes a schedule claim or margin leak when nobody owns escalation timing." },
        { rank: 8, playId: "P1", name: "Change Order Evidence Packet SOP", purpose: "Capture photos, field notes, scope references, cost backup, and approval status before work proceeds.", trigger: "Any owner/directive/sub/vendor condition outside contracted scope.", owner: "Assigned Phase PM", dependsOn: ["PM Phase Lane Definition SOP"], effort: "M", why: "The company only gets paid for changes it can prove while leverage still exists." },
        { rank: 9, playId: "P1", name: "Closeout PM Acceptance SOP", purpose: "Receive the job from finishes with punch, warranties, O&M, as-builts, client exceptions, and retention risks visible.", trigger: "Substantial completion is projected within 21 days.", owner: "Closeout PM", dependsOn: ["Rough-In-to-Finishes Hand-off SOP"], effort: "M", why: "Closeout drag ties up cash and PM attention long after production value is created." },
        { rank: 10, playId: "P1", name: "PM Phase Postmortem SOP", purpose: "Capture what broke in the phase lane and update the checklist before the next job repeats it.", trigger: "Within five business days after each phase hand-off.", owner: "Project Management Lead", dependsOn: ["Phase-Gate Readiness Checklist SOP"], effort: "S", why: "The PM system compounds only if the misses turn into revised standards." },
      ],
    };
  }

  const object: z.infer<typeof ResultSchema> = {
    constraintReframe: constraint,
    plays: [
      {
        id: "P1",
        name: `Narrow the ${dept} seat into repeatable lanes`,
        diagnosis: `The ${dept} seat is being asked to own too many judgment calls at once, which makes throughput depend on memory and heroic follow-up.`,
        mechanism: "Define the intake, decision gates, hand-offs, and visible work queue so the seat executes the same way every time.",
        expectedLift: "Fewer owner escalations and more work moved through the current seat before hiring.",
        risks: "If the intake gate is loose, the seat will keep accepting incomplete work and rework will hide inside the queue.",
      },
    ],
    topPlayId: "P1",
    headline: `${dept} needs a narrower operating lane before more headcount.`,
    buildOrderRationale: "Build the intake and definition-of-done SOPs first, then layer the recurring execution, exception, and scorecard SOPs on top.",
    backlog: [
      { rank: 1, playId: "P1", name: `${dept} Seat Scope & Authority SOP`, purpose: `Define what the ${dept} seat owns, rejects, escalates, and completes.`, trigger: "Before new work enters the seat.", owner: `${dept} Lead`, dependsOn: [], effort: "M", why: "Clear seat boundaries stop owner dependency and prevent work from landing in the wrong place." },
      { rank: 2, playId: "P1", name: `${dept} Intake Gate SOP`, purpose: "Require the minimum information, file, approval, or decision before work begins.", trigger: "Any new request, job, or internal hand-off entering the seat.", owner: `${dept} Seat`, dependsOn: [`${dept} Seat Scope & Authority SOP`], effort: "M", why: "Bad intake turns into rework, delays, and owner rescue later." },
      { rank: 3, playId: "P1", name: `${dept} Work Queue Review SOP`, purpose: "Review priorities, blockers, aging work, and next decisions on a set cadence.", trigger: "Weekly seat meeting or daily huddle if volume is high.", owner: `${dept} Lead`, dependsOn: [`${dept} Intake Gate SOP`], effort: "S", why: "A visible queue lets the current team absorb more volume without surprises." },
      { rank: 4, playId: "P1", name: `${dept} Standard of Done SOP`, purpose: "Define the exact output that proves the work is complete and transferable.", trigger: "Before marking any item complete or handing it to another seat.", owner: `${dept} Seat`, dependsOn: [`${dept} Seat Scope & Authority SOP`], effort: "S", why: "A clear done standard cuts rework and prevents downstream seats from rebuilding the same work." },
      { rank: 5, playId: "P1", name: `${dept} Exception Escalation SOP`, purpose: "Name the thresholds that require escalation and who gets the decision.", trigger: "Any item blocked by missing info, money risk, schedule risk, or customer/vendor conflict.", owner: `${dept} Lead`, dependsOn: [`${dept} Work Queue Review SOP`], effort: "M", why: "Escalation rules keep decisions from sitting quietly until they become expensive." },
      { rank: 6, playId: "P1", name: `${dept} Scorecard Update SOP`, purpose: "Track the 2-4 numbers that show whether the seat is creating throughput or drag.", trigger: "End of week before leadership review.", owner: `${dept} Lead`, dependsOn: [`${dept} Standard of Done SOP`], effort: "S", why: "The owner can manage the system by numbers instead of anecdotes." },
    ],
  };

  const normalized = normalizeResult(object, dept, seatHeadcount, context);
  return { ...normalized, topSop: normalized.backlog[0] };
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
        const inferredDepartment = detectDepartmentFromContext(body.context);
        const effectiveDept = inferredDepartment ?? dept;
        const contextAnchors = deriveContextAnchors(body.context);

        // Only fall back to the canned deterministic plan when the owner
        // gave us no specific context to reason about. As soon as they
        // describe an actual chokepoint, the AI must handle it so the
        // backlog reflects their words — not a generic seat template.
        const hasContext = (body.context ?? "").trim().length > 0;
        if (!hasContext && effectiveDept === "Project Management") {
          const fallback = fallbackResult(effectiveDept, seatHeadcount, body.context);
          return Response.json({ department: effectiveDept, ...fallback, backlog: fallback.backlog.slice(0, 12) });
        }

        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const gateway = createLovableAiGatewayProvider(key);

        const userPrompt = `${buildSopBacklogUserPrompt({
          selectedDepartment: dept,
          department: effectiveDept,
          stage,
          seatHeadcount,
          context: body.context,
          contextAnchors,
        })}\n\nReturn your answer as a single JSON object matching the schema.`;

        const jsonShape = `Required JSON shape: {"constraintReframe":"string","plays":[{"id":"P1","name":"string","diagnosis":"string","mechanism":"string","expectedLift":"string","risks":"string"}],"topPlayId":"P1","headline":"string","buildOrderRationale":"string","backlog":[{"rank":1,"playId":"P1","name":"string","purpose":"string","trigger":"string","owner":"string","dependsOn":[],"effort":"M","why":"string"}]}`;
        const tryGenerate = async (modelId: string, signal: AbortSignal) => {
          const { text } = await generateText({
            model: gateway(modelId),
            system: `${SOP_BACKLOG_SYSTEM_PROMPT}\n\nReturn only valid JSON. No markdown. No prose outside the JSON object.`,
            prompt: `${userPrompt}\n\n${jsonShape}`,
            abortSignal: signal,
          });
          return ResultSchema.parse(extractJsonObject(text));
        };

        try {
          let object: z.infer<typeof ResultSchema>;
          try {
            object = await generateWithTimeout((signal) => tryGenerate("google/gemini-2.5-pro", signal));
            validateBacklogMatchesIntent(object, body);
          } catch (primaryErr) {
            const msg = primaryErr instanceof Error ? primaryErr.message : "Failed.";
            if (msg.includes("429")) return new Response("Rate limit. Try again in a moment.", { status: 429 });
            if (msg.includes("402")) return new Response("AI credits exhausted. Add credits in Settings → Workspace → Usage.", { status: 402 });
            if ((body.context ?? "").trim()) {
              console.error("[sop-backlog] model failed with context-specific request", primaryErr);
              return new Response("The SOP stack generator returned a generic plan instead of using your context. Please try again.", { status: 502 });
            }
            console.warn("[sop-backlog] model failed, using deterministic SOP stack", primaryErr);
            const fallback = fallbackResult(effectiveDept, seatHeadcount, body.context);
            return Response.json({ department: effectiveDept, ...fallback, backlog: fallback.backlog.slice(0, 12) });
          }

          const normalized = normalizeResult(object, effectiveDept, seatHeadcount, body.context);
          const sorted = normalized.backlog;
          const topSop = sorted[0];
          if (!topSop) return new Response("Empty backlog returned. Try again.", { status: 502 });

          return Response.json({
            department: effectiveDept,
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
