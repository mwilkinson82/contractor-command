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
  let documentHeading: string | undefined;
  const append = (page: number, start: number, end: number) => {
    if (!current) {
      current = { section: null, heading: null, parts: [] };
      entries.push(current);
    }
    if (end > start || (start === 0 && end === 0)) current.parts.push({ page, start, end });
  };
  for (const page of pages) {
    const boundary = page.text
      .slice(0, 400)
      .match(
        /^(?:NOTICE INVITING BIDS|INSTRUCTIONS TO BIDDERS|BID FORM|AGREEMENT FORM|GENERAL CONDITIONS|SPECIAL CONDITIONS|TABLE OF CONTENTS|SECTION\s+\d{2}(?:[- ]\d{2,3})+)\s*$/im,
      )?.[0]
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
    if (boundary && boundary !== documentHeading) {
      current = undefined;
      documentHeading = boundary;
    }
    const marks = Array.from(
      page.text.matchAll(/(?:^|\n)[ \t]*(\d{1,2}(?:\.\d{1,3}){1,5})(?=[ \t]|\r?$)[^\r\n]*/gm),
    );
    let at = 0;
    for (const mark of marks) {
      const start = mark.index! + (mark[0].startsWith("\n") ? 1 : 0);
      if (start > at) append(page.page, at, start);
      const heading = mark[0].trim();
      const reference =
        /\.{3,}/.test(page.text.slice(start, start + 500)) ||
        /^\d+(?:\.\d+)+\s*\(\d+(?:\.\d+)*\)\s*$/.test(heading);
      current = {
        section: reference ? null : mark[1],
        heading: reference ? null : heading,
        parts: [],
      };
      entries.push(current);
      at = start;
    }
    append(page.page, at, page.text.length);
  }
  return entries.filter((c) => c.parts.length);
}
/** Recognize complete layout/title blocks, never individual body lines. A fragment
 * with any unmatched continuation stays verbatim, even when it starts with a header. */
function isPageFurnitureFragment(text: string): boolean {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return true;
  const title = (value: string) => value.toUpperCase().replace(/^THE\s+/, "").replace(/[^A-Z0-9]/g, "");
  const pageLine = /^Page(?:\s+\d+)?(?:\s+\d{5,}\.\d+)?$/i;
  const documentLine = /^\d{5,}\.\d+(?:\s+Page\s+\d+|\s+©.*)?$/i;
  const article = lines.map((line) => line.match(/^ARTICLE\s+(\d+)\s*:\s*(\S.*)$/i)).find(Boolean);
  if (article && lines.some((line) => pageLine.test(line) || /\bPage\s+\d+$/i.test(line)) && lines.some((line) => documentLine.test(line))) {
    return lines.every((line) =>
      pageLine.test(line) || documentLine.test(line) || /^GENERAL CONDITIONS$/i.test(line) ||
      line.match(/^ARTICLE\s+(\d+)\s*:\s*(\S.*)$/i)?.[0] === article[0] ||
      line.match(/^ARTICLE\s+(\d+)$/i)?.[1] === article[1] ||
      title(line) === title(article[2]),
    );
  }
  // A specification's title is learned from its own section/page/project header.
  // Only that same title and an optional PART heading may follow the metadata.
  const pageAt = lines.findIndex((line) => /^PAGE\s+\d+$/i.test(line));
  if (!/^\d{2}(?:[- ]\d{2,3}){1,2}$/.test(lines[0]) || pageAt < 2 || !/^G\.A\.\s*\d+[A-Z]?$/i.test(lines[pageAt + 1] ?? ""))
    return false;
  const headerTitle = title(lines.slice(1, pageAt).join(" "));
  const rest = lines.slice(pageAt + 2);
  if (/^PART\s+\d+\s*[-–]\s*(GENERAL|PRODUCTS|EXECUTION)$/i.test(rest.at(-1) ?? "")) rest.pop();
  return rest.length === 0 || title(rest.join(" ")) === headerTitle;
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
    })).filter((p) => !isPageFurnitureFragment(p.text));
    return {
      source_id: identity.id,
      filename: identity.name,
      file_sha256: identity.file_sha256,
      section: c.section,
      heading: c.heading,
      parts,
      text: parts.map((p) => p.text).join("\n"),
    };
  }).filter((c) => c.parts.length > 0);
}
/** A numbered contents reference or a form revision is still stored source text,
 * but is not an operative clause for the notice card or deadline consumers. */
export function isSourceClause(c: LiteralClause): boolean {
  if (!c.section) return false;
  const first = c.parts[0]?.text ?? c.text;
  if (/\.{3,}/.test(first.slice(0, 500))) return false;
  const heading = c.heading ?? first.split(/\r?\n/)[0];
  if (/^\d+(?:\.\d+)+\s*\(\d+(?:\.\d+)*\)\s*$/.test(heading)) return false;
  return true;
}
export function clauseKinds(c: LiteralClause): string[] {
  if (!isSourceClause(c)) return [];
  const t = c.text;
  const kinds: string[] = [];
  const definition = /\b(means|is a|consists? of|refers to)\b/i.test(c.heading ?? "");
  const notice = !definition && /\b(notice|notices|notify|notification)\b/i.test(t);
  if (notice) kinds.push("notice");
  if (notice && /\bdelay(s|ed)?\b/i.test(t)) kinds.push("delay_notice");
  if (notice && /\bclaims?\b/i.test(t)) kinds.push("claim_notice");
  if (!definition && /\bsubmittals?\b/i.test(t) && /\b(review|return|turnaround)\b/i.test(t))
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
