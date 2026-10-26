import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import type { Sb } from "./guard";
import { prepareReadable, loadReadable, type ReadableSource } from "./document-readable";
import { clauseIndexKey, loadClauseIndex } from "./document-clause-index";
import {
  indexLiteralClauses,
  isSourceClause,
  clauseKinds,
  materializeClauses,
  literalClauseCard,
  type LiteralClause,
} from "./literal-clauses";
import { literalClock } from "./literal-clause-clock";
import { findDelayTerms, termDue } from "./delays";
import * as renderer from "./pdf-renderer";
const objects = new Map<string, Uint8Array>();
let uploads = 0;
const sb = {
  storage: {
    from: () => ({
      download: async (path: string) =>
        objects.has(path)
          ? { data: new Blob([objects.get(path)! as BlobPart]), error: null }
          : { data: null, error: { message: "missing", statusCode: "404" } },
      upload: async (path: string, bytes: Uint8Array, opts: { upsert: boolean }) => {
        expect(opts.upsert).toBe(false);
        if (objects.has(path)) return { error: { message: "duplicate" } };
        uploads++;
        objects.set(path, bytes);
        return { error: null };
      },
    }),
  },
} as unknown as Sb;
const source = (bytes: Uint8Array): ReadableSource => ({
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  company_id: "alp",
  job_id: "2710",
  upload_id: "upload",
  storage_bucket: "athena-documents",
  storage_path: "alp/2710/upload/Original.pdf",
  file_sha256: createHash("sha256").update(bytes).digest("hex"),
  size_bytes: bytes.length,
});
const identity = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "Source.pdf",
  file_sha256: "a".repeat(64),
};
const clause = (text: string, section = "8.4.4"): LiteralClause => ({
  source_id: identity.id,
  filename: identity.name,
  file_sha256: identity.file_sha256,
  section,
  heading: null,
  text,
  parts: [{ page: 107, text }],
});
beforeEach(() => {
  objects.clear();
  uploads = 0;
  vi.restoreAllMocks();
});
it("partitions all source characters, including unnumbered/blank pages, without changing a word", () => {
  const pages = [
    {
      page: 1,
      text: "Project header\n8.4.4 Delay notice\nNotify Owner within five (5) calendar days from the beginning of delay.\n",
    },
    {
      page: 2,
      text: "continued condition unchanged\n14.1.1 Grounds\nThirty (30) consecutive days stopped; seven (7) additional days notice.",
    },
    { page: 3, text: "" },
    { page: 4, text: "14.3.1 Termination\nFifteen (15) calendar days written notice." },
  ];
  const entries = indexLiteralClauses(pages);
  const rebuilt = new Map<number, string>();
  for (const e of entries)
    for (const p of e.parts)
      rebuilt.set(
        p.page,
        (rebuilt.get(p.page) ?? "") + pages[p.page - 1].text.slice(p.start, p.end),
      );
  expect(pages.map((p) => rebuilt.get(p.page))).toEqual(pages.map((p) => p.text));
  expect(entries.some((e) => e.section === "14.1.1")).toBe(true);
  const extracted = materializeClauses(entries, { pages } as never, identity);
  expect(extracted.find((e) => e.section === "8.4.4")!.parts.map((p) => p.page)).toEqual([1, 2]);
  expect(JSON.stringify(literalClauseCard("2710", extracted, extracted.length, []))).not.toMatch(
    /confirm and save|approve|activation/i,
  );
});
it("persists the literal index automatically with extraction and reuses it without a PDF parse or approval", async () => {
  const bytes = new TextEncoder().encode("original fixture");
  const s = source(bytes);
  const texts = [
    "8.4.4 Notice\nNotify Owner within five (5) calendar days from the beginning of delay.",
    "14.2.2 Termination\nSeven (7) days written notice to Contractor and surety.",
  ];
  const prepared = await prepareReadable(sb, s, bytes, texts);
  expect(uploads).toBe(2);
  const index = await loadClauseIndex(sb, s, prepared.document);
  expect(index?.state).toBe("extracted");
  expect(index?.covered_pdf_pages).toBe(2);
  const result = materializeClauses(index!.entries, prepared.document, {
    ...identity,
    file_sha256: s.file_sha256!,
  });
  expect(result[0].parts[0].text).toBe(texts[0]);
  expect((await prepareReadable(sb, s, bytes)).reused).toBe(true);
  expect(uploads).toBe(2);
  expect((await loadReadable(sb, s))?.pages[0].text).toBe(texts[0]);
});
it("rejects wrong source hashes, incomplete index coverage and corrupted offsets", async () => {
  const bytes = new TextEncoder().encode("fixture"),
    s = source(bytes);
  const ready = await prepareReadable(sb, s, bytes, [
    "8.4.4 Notice\nExact text",
    "14.1.1 More\nExact continuation",
  ]);
  const key = clauseIndexKey(s);
  const good = objects.get(key)!.slice();
  const doc = JSON.parse(new TextDecoder().decode(good));
  doc.source_sha256 = "f".repeat(64);
  objects.set(key, new TextEncoder().encode(JSON.stringify(doc)));
  await expect(loadClauseIndex(sb, s, ready.document)).rejects.toThrow(/source version/);
  objects.set(key, good);
  const bad = JSON.parse(new TextDecoder().decode(good));
  bad.entries[0].parts[0].start = 1;
  bad.entries_sha256 = createHash("sha256").update(JSON.stringify(bad.entries)).digest("hex");
  objects.set(key, new TextEncoder().encode(JSON.stringify(bad)));
  await expect(loadClauseIndex(sb, s, ready.document)).rejects.toThrow(/coverage/);
  expect(() => clauseIndexKey({ ...s, job_id: "other-job" })).toThrow(/job-scoped/);
});
it("uses only one explicit clock, retaining compound/nonnumeric/conflicting text without fabricating deadlines", () => {
  const delay = clause(
    "8.4.4 Give notice within five (5) calendar days from the beginning of the delay.",
  );
  expect(literalClock([delay], "delay_notice")).toMatchObject({
    count: 5,
    day_type: "calendar",
    trigger: "delay_start",
  });
  expect(termDue(findDelayTerms([], {}, [], [delay]).notice, "2026-10-26").due).toBe("2026-10-31");
  const claim = clause(
    "Claim notice within seven (7) calendar days after Architect Decision.",
    "4.6.9",
  );
  expect(termDue(findDelayTerms([], {}, [], [claim]).claim, "2026-10-26").due).toBeNull();
  const compound = clause(
    "Claim notice after thirty (30) consecutive days and seven (7) additional calendar days.",
  );
  expect(literalClock([compound], "claim_notice").count).toBeNull();
  expect(compound.text).toContain("thirty (30)");
  const prompt = clause(
    "Review submittals with reasonable promptness; submit submittal schedule within fourteen (14) calendar days.",
    "1.01",
  );
  expect(literalClock([prompt], "submittal_review").count).toBeNull();
  const different = clause(
    "Delay notice within ten (10) calendar days from the beginning of delay.",
  );
  expect(literalClock([delay, different], "delay_notice").count).toBeNull();
});
it.skipIf(!process.env.ATHENA_OFFICE_PDF)(
  "automatically indexes the actual 450-page Office source and preserves late clauses verbatim",
  async () => {
    const bytes = new Uint8Array(readFileSync(process.env.ATHENA_OFFICE_PDF!));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      "c1558b6dd96344f6926d760660dfe8ecaefa9c9e7d7cfc932fade08b16462967",
    );
    const s = source(bytes);
    const parse = vi.spyOn(renderer, "extractPdfiumDocumentText");
    const prepared = await prepareReadable(sb, s, bytes);
    const index = await loadClauseIndex(sb, s, prepared.document);
    expect(index?.covered_pdf_pages).toBe(450);
    const clauses = materializeClauses(index!.entries, prepared.document, {
      ...identity,
      name: "Office Building Alteration-Bid Specifications_2241.pdf",
      file_sha256: s.file_sha256!,
    });
    const supervision = clauses.find((c) => c.section === "3.2.1")!;
    expect(supervision.parts.map((p) => p.page)).toEqual([67]);
    expect(supervision.text).toContain("Contractor shall notify Owner and Architect in writing");
    expect(prepared.document.pages[67].text).toMatch(/^ARTICLE 3: Contractor/);
    const operativeNotices=clauses.filter(c=>clauseKinds(c).includes("notice"));
    expect(operativeNotices.slice(0,8).every(c=>c.parts[0].page>=56)).toBe(true);
    expect(clauses.filter(c=>c.parts.some(p=>p.page===15)).every(c=>c.section===null)).toBe(true);
    const notice = clauses.find((c) => c.section === "8.4.4")!;
    expect(notice.parts.some((p) => p.page === 107)).toBe(true);
    expect(literalClock([notice], "delay_notice").count).toBe(5);
    const late = clauses.find((c) => c.section === "14.2.2")!;
    expect(late.parts.some((p) => p.page === 149)).toBe(true);
    expect(late.text).toContain("seven");
    const convenience = clauses.find((c) => c.section === "14.3.1")!;
    expect(convenience.parts.some((p) => p.page === 150)).toBe(true);
    expect(convenience.text).toContain("fifteen");
    await prepareReadable(sb, s, bytes);
    expect(parse).toHaveBeenCalledTimes(1);
    if (process.env.ATHENA_LITERAL_PROOF)
      writeFileSync(
        process.env.ATHENA_LITERAL_PROOF,
        JSON.stringify(
          {
            source_bytes: bytes.length,
            source_sha256: s.file_sha256,
            indexed_pages: 450,
            clauses: clauses.length,
            source_characters_unchanged: true,
            page107_delay_count: 5,
            page149_section: "14.2.2",
            page150_section: "14.3.1",
            pdf_extractions: parse.mock.calls.length,
            approval_required: false,
            production_facts_written: false,
            index_bytes: objects.get(clauseIndexKey(s))!.length,
          },
          null,
          2,
        ),
      );
  },
  30000,
);

it("keeps contents references and form revision numbers in storage but out of clause cards and clocks", () => {
  const toc = clause(
    "2.2 OWNER'S RIGHT TO CARRY OUT WORK\nTWO (2) BUSINESS DAY NOTICE TO CURE........48",
    "2.2",
  );
  toc.heading = "2.2 OWNER'S RIGHT TO CARRY OUT WORK";
  const revision = clause("3.97 (8.98)\nAgreement form with notice wording", "3.97");
  revision.heading = "3.97 (8.98)";
  const preamble = clause("Notice in document title and contents");
  preamble.section = null;
  for (const c of [toc, revision, preamble]) {
    expect(isSourceClause(c)).toBe(false);
    expect(clauseKinds(c)).toEqual([]);
  }
  const real = clause(
    "8.4.4 Give notice within five (5) calendar days from the beginning of delay.",
  );
  expect(clauseKinds(real)).toContain("notice");
  expect(literalClock([toc, preamble, real], "delay_notice").count).toBe(5);
});

it("resets section attribution at contents references and unrelated document boundaries", () => {
  const pages = [
    { page: 1, text: "TABLE OF CONTENTS\n14.4 REMEDIES OTHER THAN TERMINATION ........134\n" },
    {
      page: 2,
      text: "NOTICE INVITING BIDS\nNOTICE IS HEREBY GIVEN that Owner will receive bids.\n",
    },
    {
      page: 3,
      text: "GENERAL CONDITIONS\n1.1 Actual clause\nThe Contractor shall provide written notice.\n",
    },
    { page: 4, text: "GENERAL CONDITIONS\nThis is the same clause continuation.\n" },
    { page: 5, text: "3.97 (8.98)\nAgreement form revision, not section 3.97.\n" },
  ];
  const entries = indexLiteralClauses(pages);
  const extracted = materializeClauses(entries, { pages } as never, identity);
  expect(extracted.some((c) => c.section === "14.4" || c.section === "3.97")).toBe(false);
  const bid = extracted.find((c) => c.parts.some((p) => p.page === 2))!;
  expect(bid.section).toBeNull();
  expect(clauseKinds(bid)).toEqual([]);
  expect(extracted.find((c) => c.section === "1.1")!.parts.map((p) => p.page)).toEqual([3, 4]);
  const rebuilt = new Map<number, string>();
  for (const e of entries)
    for (const p of e.parts)
      rebuilt.set(
        p.page,
        (rebuilt.get(p.page) ?? "") + pages[p.page - 1].text.slice(p.start, p.end),
      );
  expect(pages.map((p) => rebuilt.get(p.page))).toEqual(pages.map((p) => p.text));
});

it("retains definitions as source text without promoting them to notice actions", () => {
  const definition = clause(
    "1.1.29 Notice of Non-Compliance is a document issued by Inspector.",
    "1.1.29",
  );
  definition.heading = definition.text;
  expect(isSourceClause(definition)).toBe(true);
  expect(clauseKinds(definition)).not.toContain("notice");
  expect(definition.text).toContain("Notice of Non-Compliance");
});

it("omits the exact page68 header-only fragment from clause evidence and cards, retaining source offsets", () => {
  const furniture = "ARTICLE 3: Contractor \r\nPage 53 005961.00001\r\n26500057.1 \r\n";
  const pages = [
    { page: 1, text: "3.2.1 Supervision\nContractor shall notify Owner and Architect in writing.\n" },
    { page: 2, text: furniture + "3.2.2 Staff\nProvide competent staff.\n" },
  ];
  const entries = indexLiteralClauses(pages);
  const raw = entries.find((c) => c.section === "3.2.1")!;
  expect(raw.parts.map((p) => p.page)).toEqual([1, 2]);
  expect(pages[1].text.slice(raw.parts[1].start, raw.parts[1].end)).toBe(furniture);
  const clauses = materializeClauses(entries, { pages } as never, identity);
  const supervision = clauses.find((c) => c.section === "3.2.1")!;
  expect(supervision.parts).toEqual([{ page: 1, text: pages[0].text }]);
  expect(supervision.text).toBe(pages[0].text);
  expect(JSON.stringify(literalClauseCard("2710", [supervision], 1, []))).not.toContain("Page 53");
  expect(pages[1].text).toBe(furniture + "3.2.2 Staff\nProvide competent staff.\n");
});

it("preserves every genuine continuation word, including mixed furniture and text on the same page", () => {
  const furniture = "ARTICLE 3: Contractor \r\nPage 53 005961.00001\r\n26500057.1 \r\n";
  const continuation = furniture + "Notify Owner before proceeding, except in an emergency.\n";
  const pages = [
    { page: 1, text: "3.2.1 Supervision\nContractor shall give notice\n" },
    { page: 2, text: furniture },
    { page: 3, text: continuation + "3.2.2 Staff\nProvide competent staff.\n" },
  ];
  const clauses = materializeClauses(indexLiteralClauses(pages), { pages } as never, identity);
  const supervision = clauses.find((c) => c.section === "3.2.1")!;
  expect(supervision.parts).toEqual([
    { page: 1, text: pages[0].text },
    { page: 3, text: continuation },
  ]);
  expect(supervision.text).toBe(pages[0].text + "\n" + continuation);
  expect(supervision.text).toContain("except in an emergency");
});
