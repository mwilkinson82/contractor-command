// Literal section/page boundaries only. No approval state or inferred contract facts.
import type { ReadableDocument } from "./document-readable";
import type { CardModel } from "./cards/model";
export type ClauseSpan = { page: number; start: number; end: number };
export type ClauseEntry = { section: string | null; heading: string | null; parts: ClauseSpan[] };
export type LiteralClause = {
  source_id: string;
  filename: string;
  file_sha256: string;
  section: string | null;
  heading: string | null;
  parts: { page: number; text: string }[];
  text: string;
};
export function indexLiteralClauses(pages: ReadableDocument["pages"]): ClauseEntry[] {
  const entries: ClauseEntry[] = [];
  let current: ClauseEntry | undefined;
  const append = (page: number, start: number, end: number) => {
    if (!current) {
      current = { section: null, heading: null, parts: [] };
      entries.push(current);
    }
    if (end > start || (start === 0 && end === 0)) current.parts.push({ page, start, end });
  };
  for (const page of pages) {
    const marks = Array.from(
      page.text.matchAll(/(?:^|\n)[ \t]*(\d{1,2}(?:\.\d{1,3}){1,5})(?=[ \t]|\r?$)[^\r\n]*/gm),
    );
    let at = 0;
    for (const mark of marks) {
      const start = mark.index! + (mark[0].startsWith("\n") ? 1 : 0);
      if (start > at) append(page.page, at, start);
      current = { section: mark[1], heading: mark[0].trim(), parts: [] };
      entries.push(current);
      at = start;
    }
    append(page.page, at, page.text.length);
  }
  return entries.filter((c) => c.parts.length);
}
export function materializeClauses(
  entries: ClauseEntry[],
  readable: ReadableDocument,
  identity: { id: string; name: string; file_sha256: string },
): LiteralClause[] {
  return entries.map((c) => {
    const parts = c.parts.map((p) => ({
      page: p.page,
      text: readable.pages[p.page - 1].text.slice(p.start, p.end),
    }));
    return {
      source_id: identity.id,
      filename: identity.name,
      file_sha256: identity.file_sha256,
      section: c.section,
      heading: c.heading,
      parts,
      text: parts.map((p) => p.text).join("\n"),
    };
  });
}
export function clauseKinds(c: LiteralClause): string[] {
  const t = c.text;
  const kinds: string[] = [];
  const notice = /\b(notice|notices|notify|notification)\b/i.test(t);
  if (notice) kinds.push("notice");
  if (notice && /\bdelay(s|ed)?\b/i.test(t)) kinds.push("delay_notice");
  if (notice && /\bclaims?\b/i.test(t)) kinds.push("claim_notice");
  if (/\bsubmittals?\b/i.test(t) && /\b(review|return|turnaround)\b/i.test(t))
    kinds.push("submittal_review");
  if (/\b(schedule|submittal|notice|time extension)\b/i.test(t)) kinds.push("schedule_context");
  return kinds;
}
export function literalClauseCard(
  job: string,
  clauses: LiteralClause[],
  total: number,
  problems: string[],
): CardModel {
  return {
    state: "result",
    title: "Contract terms",
    show_state: false,
    job,
    kpis: [
      { label: "Extracted clauses", value: String(total) },
      { label: "Shown", value: String(clauses.length) },
      { label: "Source issues", value: String(problems.length) },
    ],
    sections: [
      ...clauses.map((c) => ({
        heading: c.heading ?? "Unnumbered source text",
        kind: "list" as const,
        rows: c.parts
          .slice(0, 3)
          .flatMap((p) => [
            {
              cells: [
                `${c.filename} · source ${c.source_id} · PDF p.${p.page}${c.section ? ` · §${c.section}` : ""}`,
              ],
            },
            { cells: [p.text.slice(0, 3000)], tone: "quote" as const },
            ...(p.text.length > 3000
              ? [
                  {
                    cells: [
                      "Excerpt continues on this physical PDF page; use project_documents read for the complete wording.",
                    ],
                    tone: "unknown" as const,
                  },
                ]
              : []),
          ])
          .concat(
            c.parts.length > 3
              ? [
                  {
                    cells: [
                      `Continues through PDF p.${c.parts.at(-1)!.page}; retrieve remaining physical pages.`,
                    ],
                  },
                ]
              : [],
          ),
      })),
      ...(problems.length
        ? [
            {
              heading: "Missing or unreadable source evidence",
              kind: "list" as const,
              rows: problems.map((p) => ({ cells: [p], tone: "unknown" as const })),
            },
          ]
        : []),
    ],
    next_move:
      "Exact source wording governs; compound clocks and unquantified timing remain as written. No notice is sent.",
  };
}
