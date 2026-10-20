// Lookahead list answers and the job's hidden setup container.

/**
 * A lookahead list answer that says there is nothing to list: "none", "no", "N/A", "nothing", alone or followed by
 * the member's explanation ("None. Underground conduit starts…", "None block work in this window…", "No — all released").
 * Anything else lists items and opens one.
 */
export function isNoneAnswer(detail: string): boolean {
  const t = detail.trim();
  if (/^(?:none|nothing|n\/?a|no)\s*(?:$|[.,;:!—–-])/i.test(t)) return true;
  return /^(?:none|nothing)\s+(?:block|blocks|blocking|needed|required|open|outstanding|pending|due|affect|affects|in|this|for|at)\b/i.test(t);
}

/**
 * Lookaheads a member made. Left out: the setup container (inputs.kind "setup", created by the item store to hold
 * job-setup items) and a lookahead folded into another as a revision (inputs.kind "merged", inputs.merged_into).
 */
export function visibleLookaheads<T extends { inputs?: unknown }>(rows: T[]): T[] {
  return rows.filter((r) => {
    const kind = r.inputs && typeof r.inputs === "object" ? (r.inputs as { kind?: unknown }).kind : undefined;
    return kind !== "setup" && kind !== "merged";
  });
}

/**
 * Step 0 scope facts to save. Fields the member sent are saved; fields not sent are left alone when already saved
 * (a partial update merges) and recorded as unknown (null) only the first time.
 * key_clauses merges per clause, so sending one clause keeps the others.
 */
export function mergeScopeFacts(given: Record<string, unknown>, prior: { key: string; value: unknown; status: string }[]): Record<string, unknown> {
  const had = new Map(prior.map((p) => [p.key, p]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(given)) {
    if (v === undefined) {
      if (!had.has(k)) out[k] = null;
      continue;
    }
    const p = had.get(k);
    if (k === "key_clauses" && v && typeof v === "object" && p?.status === "known" && p.value && typeof p.value === "object") {
      out[k] = { ...(p.value as Record<string, unknown>), ...Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)) };
    } else out[k] = v;
  }
  return out;
}
