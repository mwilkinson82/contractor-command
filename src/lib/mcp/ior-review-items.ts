import { heldCents, readIorModel, type IorExposure, type IorModel } from "../ior-model";
import type { Sb } from "./guard";

/** Open items made from IOR risk reviews carry check keys that start with this. */
export const IOR_REVIEW_PREFIX = "ior_review:";

/** One open item Athena keeps for a live IOR risk: review it by its next review date. */
export type IorReviewItem = {
  check_key: string;
  action: string;
  needed_by: string;
  accountable: string | null;
  why: string;
  detail: string;
};

const dollars = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "risk";

/**
 * The key ties one item to one risk and one review date, so a new review date makes a new
 * item and a review the member already closed is never opened again.
 */
export const iorReviewKey = (e: Pick<IorExposure, "title">, nextReview: string) =>
  `${IOR_REVIEW_PREFIX}${slug(e.title)}:${nextReview}`;

/** A risk is live while it still holds money and has a review date. */
const isLive = (e: IorExposure) => heldCents(e) > 0 && !!e.next_review;

/** The review items the IOR calls for: one per live risk, due on its next review date. */
export function iorReviewItems(model: IorModel): IorReviewItem[] {
  const seen = new Set<string>();
  const out: IorReviewItem[] = [];
  for (const e of model.exposures) {
    if (!isLive(e)) continue;
    const check_key = iorReviewKey(e, e.next_review!);
    if (seen.has(check_key)) continue;
    seen.add(check_key);
    const held = dollars(heldCents(e));
    out.push({
      check_key,
      action: `Review the IOR risk: ${e.short} (${held} held)`,
      needed_by: e.next_review!,
      accountable: e.owner,
      why: `This risk holds ${held} in the IOR (${e.hold}-hold). Its next review is ${e.next_review}.`,
      detail: [
        e.title,
        `${dollars(Math.round(e.dollar_risk * 100))} at ${e.probability}% · ${e.response}`,
        ...(e.next_move ? [`Next move: ${e.next_move}`] : []),
        "Review it, update the IOR, and set the next review date.",
      ].join("\n"),
    });
  }
  return out;
}

export type IorReviewSync = { opened: number; closed: number };

/**
 * Keeps the job's open items in step with its saved IOR: opens an item for each live risk's
 * next review and closes review items the IOR no longer calls for. Best effort: a failure
 * never blocks the save or read that called it.
 */
export async function syncIorReviewItems(
  sb: Sb,
  jobId: string,
  iorData: unknown,
): Promise<IorReviewSync> {
  const done: IorReviewSync = { opened: 0, closed: 0 };
  try {
    const { model } = readIorModel(iorData);
    if (!model) return done;
    const want = iorReviewItems(model);
    const { data, error } = await sb
      .from("mcp_open_items")
      .select("id, check_key, status")
      .eq("job_id", jobId)
      .like("check_key", `${IOR_REVIEW_PREFIX}%`);
    if (error) return done;
    const rows = (data ?? []) as { id: string; check_key: string; status: string }[];
    const known = new Set(rows.map((r) => r.check_key));
    for (const it of want) {
      if (known.has(it.check_key)) continue;
      const { data: made, error: addError } = await sb.rpc(
        "mcp_add_item" as never,
        {
          _job: jobId,
          _f: {
            check_key: it.check_key,
            action: it.action,
            detail: it.detail,
            why: it.why,
            needed_by: it.needed_by,
            ...(it.accountable ? { accountable: it.accountable } : {}),
            category: "IOR risk review",
            section: "ior",
            severity: "medium",
            internal_only: true,
            source: "ior",
            clause_source: "IOR next review date",
            tool: "ior",
          },
        } as never,
      );
      if (!addError && !(made as { existing?: boolean } | null)?.existing) done.opened++;
    }
    const keep = new Set(want.map((w) => w.check_key));
    for (const r of rows) {
      if (r.status !== "open" || keep.has(r.check_key)) continue;
      const { error: closeError } = await sb.rpc(
        "mcp_resolve_item" as never,
        {
          _item: r.id,
          _kind: "verified",
          _evidence:
            "The saved IOR no longer calls for this review: the risk was closed, removed, or given a new review date.",
          _stated_by: null,
          _stated_on: null,
          _reason: null,
          _approval: null,
          _billing: null,
          _collection: null,
        } as never,
      );
      if (!closeError) done.closed++;
    }
  } catch {
    // Best effort.
  }
  return done;
}
