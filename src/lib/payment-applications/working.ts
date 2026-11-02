import { z } from "zod";
import { applicationSchema, workingApplicationInputSchema, type Application } from "./model";
import {
  carryCertificate,
  emptyApplication,
  type ApplicationContext,
  type SavedApplication,
} from "./workflow";
export const intentSchema = z.record(
  z.string().min(1).max(40),
  z
    .object({
      basis: z.enum(["this_period", "cumulative"]),
      amount_cents: z.number().int().min(-9_000_000_000_000).max(9_000_000_000_000).nullable(),
    })
    .strict(),
);
export type WorkingIntent = z.infer<typeof intentSchema>;
export const workingApplicationSchema = workingApplicationInputSchema;
export function deriveIntent(a: Application, intent: WorkingIntent): Application {
  return {
    ...a,
    lines: a.lines.map((l) => {
      const request = intent[l.item];
      return !request
        ? l
        : {
            ...l,
            work_cents:
              request.amount_cents === null
                ? null
                : request.basis === "cumulative"
                  ? request.amount_cents
                  : l.prior_work_cents === null
                    ? null
                    : l.prior_work_cents + request.amount_cents,
          };
    }),
  };
}
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function resolveDraftLine(a: Application, query: string) {
  const name = normalize(query);
  const exact = a.snapshot.lines.filter(
    (l) => normalize(l.item) === name || normalize(l.description) === name,
  );
  const choices = exact.length
    ? exact
    : a.snapshot.lines.filter((l) => name && ` ${normalize(l.description)} `.includes(` ${name} `));
  return choices.length === 1
    ? { line: choices[0], choices: [] }
    : { line: null, choices: choices.length ? choices : a.snapshot.lines };
}
export const draftChangeSchema = z
  .object({
    line: z.string().trim().min(1).max(500),
    basis: z
      .enum(["this_period", "cumulative"])
      .optional()
      .describe(
        "This-period increment or total installed to date. Ask when the member's intent is ambiguous.",
      ),
    amount_cents: z.number().int().min(-9_000_000_000_000).max(9_000_000_000_000).nullable(),
    prior_work_cents: z
      .number()
      .int()
      .min(-9_000_000_000_000)
      .max(9_000_000_000_000)
      .nullable()
      .optional(),
    prior_stored_cents: z.number().int().min(0).nullable().optional(),
    prior_retained_cents: z
      .number()
      .int()
      .min(-9_000_000_000_000)
      .max(9_000_000_000_000)
      .nullable()
      .optional(),
    stored_cents: z.number().int().min(0).nullable().optional(),
    stored_to_work_cents: z.number().int().min(0).nullable().optional(),
    release_cents: z.number().int().min(0).nullable().optional(),
    release_basis: z.string().max(2000).optional(),
    stored_basis: z.string().max(2000).optional(),
  })
  .strict();
export const draftPatchSchema = workingApplicationSchema
  .omit({ snapshot: true, lines: true, state: true, certification: true })
  .partial();
export function draftProposal(
  ctx: ApplicationContext,
  input: {
    patch?: z.infer<typeof draftPatchSchema>;
    changes: z.infer<typeof draftChangeSchema>[];
    request_text: string;
    no_stored_materials?: boolean;
    retainage_bps?: number;
    first_application?: boolean;
  },
  predecessor?: SavedApplication,
) {
  if (!ctx.snapshot)
    throw Error(ctx.snapshot_issue ?? "The approved contract and saved SOV are needed.");
  if (ctx.selected && ["submitted", "certified"].includes(ctx.selected.body.state))
    throw Error("This application is already issued. Use its reviewed revision workflow.");
  if (ctx.selected?.working_state === "cancelled")
    throw Error("This working draft was cancelled. Resume it explicitly before editing.");
  if (ctx.selected && ctx.selected.body.snapshot.fingerprint !== ctx.snapshot.fingerprint)
    throw Error("The SOV changed. Reconcile its sources before revising the draft.");
  let a: Application = {
    ...(ctx.selected?.body ?? emptyApplication(ctx.snapshot)),
    ...input.patch,
    snapshot: ctx.snapshot,
    state: "draft",
    certification: null,
  };
  // A request to bill is not evidence of installed work or an approved source.
  if (predecessor) a = carryCertificate(a, predecessor);
  let intent: WorkingIntent = { ...(ctx.selected?.working_intent ?? {}) };
  const questions: string[] = [];
  if (input.first_application) {
    if (
      ctx.evidence.length ||
      ctx.applications.some((x) => ["submitted", "certified"].includes(x.state)) ||
      (a.prior_certified_net_cents !== null && a.prior_certified_net_cents !== 0) ||
      a.lines.some((l) =>
        [l.prior_work_cents, l.prior_stored_cents, l.prior_retained_cents].some(
          (value) => value !== null && value !== 0,
        ),
      )
    )
      questions.push("Existing billing needs reconciliation before declaring a first application.");
    else
      a = {
        ...a,
        prior_mode: "first",
        prior_application: null,
        prior_certified_net_cents: 0,
        prior_basis: input.request_text,
        lines: a.lines.map((l) => ({
          ...l,
          prior_work_cents: 0,
          prior_stored_cents: 0,
          prior_retained_cents: 0,
        })),
      };
  }
  if (
    input.no_stored_materials &&
    a.lines.some(
      (l) =>
        (l.prior_stored_cents ?? 0) > 0 ||
        (l.stored_cents ?? 0) > 0 ||
        (l.stored_to_work_cents ?? 0) > 0,
    )
  )
    questions.push(
      "Existing stored material values conflict with a no-storage declaration. Reconcile them first.",
    );
  else if (input.no_stored_materials)
    a = {
      ...a,
      lines: a.lines.map((l) => ({
        ...l,
        prior_stored_cents: 0,
        stored_cents: 0,
        stored_to_work_cents: 0,
      })),
    };
  if (input.retainage_bps !== undefined)
    a = {
      ...a,
      retainage_basis: input.patch?.retainage_basis ?? input.request_text,
      lines: a.lines.map((l) => ({
        ...l,
        work_retainage_bps: input.retainage_bps!,
        stored_retainage_bps: input.retainage_bps!,
      })),
    };
  const seen = new Set<string>();
  for (const change of input.changes) {
    const match = resolveDraftLine(a, change.line);
    if (!match.line) {
      questions.push(
        `Choose the SOV line for “${change.line}”: ${match.choices.map((l) => l.item + " · " + l.description).join("; ")}.`,
      );
      continue;
    }
    const id = match.line.item;
    if (seen.has(id)) {
      questions.push(
        `More than one change targets ${match.line.description}; clarify the intended amount.`,
      );
      continue;
    }
    seen.add(id);
    if (!change.basis) {
      questions.push(`Does ${change.line} mean this period or the cumulative total?`);
      continue;
    }
    const { line, basis, amount_cents, ...fields } = change;
    intent[id] = { basis, amount_cents };
    a = { ...a, lines: a.lines.map((l) => (l.item === id ? { ...l, ...fields } : l)) };
  }
  a = deriveIntent(a, intent);
  for (const l of a.lines) {
    const scheduled = a.snapshot.lines.find((s) => s.item === l.item)!;
    const requested = intent[l.item];
    if (requested?.basis === "this_period" && l.prior_work_cents === null)
      questions.push(
        `${scheduled.description}: prior installed work is needed to turn the requested ${requested.amount_cents === null ? "Needed" : (requested.amount_cents / 100).toFixed(2)} this period into a cumulative amount; it was not assumed zero.`,
      );
    if (
      requested?.amount_cents !== null &&
      requested?.amount_cents !== undefined &&
      (requested.amount_cents > Math.max(0, scheduled.scheduled_cents) ||
        requested.amount_cents < Math.min(0, scheduled.scheduled_cents))
    )
      questions.push(
        `${scheduled.description}: requested amount exceeds the full scheduled line capacity.`,
      );
    if (
      l.work_cents !== null &&
      (l.work_cents > Math.max(0, scheduled.scheduled_cents) ||
        l.work_cents < Math.min(0, scheduled.scheduled_cents) ||
        (l.stored_cents !== null &&
          (l.work_cents + l.stored_cents > Math.max(0, scheduled.scheduled_cents) ||
            l.work_cents + l.stored_cents < Math.min(0, scheduled.scheduled_cents))) ||
        (l.prior_work_cents !== null &&
          (scheduled.scheduled_cents >= 0
            ? l.work_cents < l.prior_work_cents
            : l.work_cents > l.prior_work_cents)))
    )
      questions.push(
        `${scheduled.description}: requested work exceeds the saved line capacity. Scheduled ${(scheduled.scheduled_cents / 100).toFixed(2)}; prior installed ${l.prior_work_cents === null ? "Needed" : (l.prior_work_cents / 100).toFixed(2)}; current stored ${l.stored_cents === null ? "Needed" : (l.stored_cents / 100).toFixed(2)}.`,
      );
  }
  const blocking = questions.filter((q) => !q.includes("prior installed work is needed"));
  return { application: workingApplicationSchema.parse(a), intent, questions, blocking };
}

// JSONB may return object properties in a different order; arrays and values remain exact.
export function sameWorkingValue(a: unknown, b: unknown): boolean {
  const canonical = (v: any): any =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export async function workingRequestHash(value: unknown): Promise<string> {
  const stable = (v: any): any =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .filter((k) => v[k] !== undefined)
              .map((k) => [k, stable(v[k])]),
          )
        : v;
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(stable(value))),
  );
  return Array.from(new Uint8Array(bytes), (x) => x.toString(16).padStart(2, "0")).join("");
}
