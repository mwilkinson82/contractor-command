/**
 * Schedule Intelligence — Build Mode AI-4 server function.
 *
 * Turns a user-pasted activity list into a non-committable DraftSchedule
 * artifact. This is the first real AI-assisted scheduling workflow in
 * Build Mode, but every guardrail from docs/schedule-intelligence-ai-spec.md
 * still holds:
 *
 *   - Draft-only. No mutations to the live `Schedule`.
 *   - No commit path. `Add to Schedule` stays disabled in the UI.
 *   - No engine2 wiring. Production still calls legacy `calculateSchedule`.
 *   - No persistence: drafts are returned to the browser and held in
 *     component state only.
 *   - Structured output: the AI must return JSON matching
 *     `AiDraftPayloadSchema`. Invalid responses produce a typed error
 *     payload, not a half-rendered draft.
 *
 * Auth: required via `requireSupabaseAuth` — same boundary as every
 * other scheduler server function.
 */

import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";

import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

import type { DraftSchedule } from "./intel-build";
import {
  AiDraftPayloadSchema,
  assembleDraftFromActivityList,
} from "./intel-build-validate";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const InputSchema = z.object({
  inputText: z.string().min(3).max(8000),
});

// ---------------------------------------------------------------------------
// Output: a discriminated union so the UI can render either the draft
// or a precise error without guessing at strings.
// ---------------------------------------------------------------------------

export type GenerateDraftResult =
  | { ok: true; draft: DraftSchedule; modelId: string }
  | { ok: false; error: string; code: "rate_limited" | "no_credits" | "ai_unavailable" | "invalid_output" | "empty_input" };

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior construction scheduler helping a contractor turn a raw activity list into a draft CPM schedule.

Rules:
- Treat the user's text as a list of activities. Lines, commas, or semicolons all count as separators.
- Preserve the user's wording for activity names. Do not rename activities the user already named.
- Propose a small WBS (3–6 sections) that groups the activities logically.
- Estimate durations in working days. Mark every duration as assumed.
- Propose Finish-to-Start logic by listing predecessor activity NAMES (not ids) under "dependsOn". Only list predecessors that appear in the activity list.
- Add 1–3 plain-English assumptions and 1–3 open questions a scheduler would ask the contractor (procurement, inspections, owner-furnished items, calendar).
- If a milestone is implied (e.g. "inspection", "closeout"), set isMilestone:true and duration 0.
- Do NOT invent activities not implied by the user's text.
- Do NOT pretend durations are facts. Every duration is a planning assumption.
- Return ONLY valid JSON matching the schema below. No prose, no markdown fences.`;

const JSON_SHAPE_HINT = `Required JSON shape:
{
  "name": "string (short title)",
  "wbsSections": [{"code":"1","name":"string"}],
  "activities": [
    {
      "name": "string",
      "durationDays": 5,
      "wbsName": "string (must match wbsSections.name)",
      "isMilestone": false,
      "assumed": true,
      "dependsOn": ["activity name(s) earlier in the list"]
    }
  ],
  "milestones": [{"name":"string","activityName":"string"}],
  "assumptions": ["string"],
  "questions": ["string"],
  "warnings": ["string (optional)"]
}`;

function buildUserPrompt(inputText: string): string {
  return `Activity list (user paste):
"""
${inputText.trim()}
"""

Convert this into a draft CPM schedule artifact. Return JSON only.

${JSON_SHAPE_HINT}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractJsonObject(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("Model did not return a JSON object.");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function generateWithTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort("draft generation timed out");
      reject(new Error("Draft generation timed out"));
    }, ms);
  });
  try {
    return await Promise.race([task(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Server function
// ---------------------------------------------------------------------------

export const generateDraftFromActivityList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data }): Promise<GenerateDraftResult> => {
    const inputText = data.inputText.trim();
    if (inputText.length < 3) {
      return { ok: false, error: "Paste an activity list first.", code: "empty_input" };
    }

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        ok: false,
        error: "AI gateway is not configured. Add LOVABLE_API_KEY in Lovable Cloud.",
        code: "ai_unavailable",
      };
    }

    const gateway = createLovableAiGatewayProvider(apiKey);
    const userPrompt = buildUserPrompt(inputText);

    const tryGenerate = async (modelId: string, signal: AbortSignal) => {
      const { text } = await generateText({
        model: gateway(modelId),
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        abortSignal: signal,
      });
      return AiDraftPayloadSchema.parse(extractJsonObject(text));
    };

    const modelChain: ReadonlyArray<{ id: string; timeoutMs: number }> = [
      { id: "google/gemini-3-flash-preview", timeoutMs: 18000 },
      { id: "google/gemini-2.5-flash", timeoutMs: 18000 },
      { id: "google/gemini-2.5-pro", timeoutMs: 28000 },
    ];

    let lastErr: unknown = null;
    for (const m of modelChain) {
      try {
        const payload = await generateWithTimeout(
          (signal) => tryGenerate(m.id, signal),
          m.timeoutMs,
        );
        const draft = assembleDraftFromActivityList({
          payload,
          inputText,
        });
        return { ok: true, draft, modelId: m.id };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("429")) {
          return {
            ok: false,
            error: "AI rate limit hit. Try again in a moment.",
            code: "rate_limited",
          };
        }
        if (msg.includes("402")) {
          return {
            ok: false,
            error:
              "AI credits exhausted. Add credits in Settings → Workspace → Usage.",
            code: "no_credits",
          };
        }
        console.warn(`[intel-build-draft] ${m.id} failed`, msg);
        lastErr = err;
      }
    }

    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    if (msg.toLowerCase().includes("json") || msg.toLowerCase().includes("zoderror")) {
      return {
        ok: false,
        error:
          "The model returned an unreadable response. Keep your input and try again.",
        code: "invalid_output",
      };
    }
    return {
      ok: false,
      error: "AI is unavailable right now. Keep your input and try again.",
      code: "ai_unavailable",
    };
  });
