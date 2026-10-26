import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  scope: "full",
  rows: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as unknown[][],
  error: null as null | { message: string },
}));
vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) =>
    fn({ from: table }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
vi.mock("./jobs", () => ({
  resolveJob: async (_sb: unknown, job: string, company?: string) => {
    state.calls.push(["resolve", job, company]);
    return { job_id: "job-2710", job_number: job, company_id: "alp", scope: state.scope };
  },
}));
function table(name: string) {
  let rows = state.rows[name] ?? [];
  const q = {
    select(cols: string) {
      state.calls.push(["select", name, cols]);
      return q;
    },
    eq(col: string, value: unknown) {
      state.calls.push(["eq", name, col, value]);
      rows = rows.filter((r) => r[col] === value);
      return q;
    },
    ilike(col: string, value: string) {
      state.calls.push(["ilike", name, col, value]);
      return q;
    },
    order(col: string) {
      state.calls.push(["order", name, col]);
      rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
      return q;
    },
    async range(from: number, to: number) {
      return { data: rows.slice(from, to + 1), error: state.error };
    },
  };
  return q;
}
import { projectDocuments, sourcePages, searchSource } from "./tools/document-read-tools";
const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const call = (input: Record<string, unknown>) =>
  (
    projectDocuments as unknown as {
      handler: (a: Record<string, unknown>, c: unknown) => Promise<{ structuredContent: any }>;
    }
  ).handler(
    {
      job_number: "2710",
      company_id: "alp",
      action: "list",
      offset: 0,
      limit: 10,
      page_count: 1,
      ...input,
    },
    {},
  );
const source = (extra: Record<string, unknown> = {}) => ({
  id,
  job_id: "job-2710",
  name: "Exact source.pdf",
  size_bytes: 2511305,
  file_sha256: "5e".repeat(32),
  updated_at: "2026-10-26",
  body: "[[PDF page 1]]\nOther text\n[[PDF page 2]]\nReview with reasonable promptness.",
  ...extra,
});
beforeEach(() => {
  state.scope = "full";
  state.rows = { mcp_spec_documents: [source()] };
  state.calls = [];
  state.error = null;
});
describe("saved source discovery and reads", () => {
  it("lists stored identity and bytes without retrieving or exposing source body", async () => {
    const r = await call({});
    expect(r.structuredContent.documents).toHaveLength(1);
    expect(r.structuredContent.documents[0]).toMatchObject({
      id,
      name: "Exact source.pdf",
      size_bytes: 2511305,
      kind: "spec",
    });
    expect(r.structuredContent.documents[0].body).toBeUndefined();
    expect(
      state.calls.filter((c) => c[0] === "select").every((c) => !String(c[2]).includes("body")),
    ).toBe(true);
    expect(
      state.calls
        .filter((c) => c[0] === "eq")
        .every((c) => c[2] === "job_id" && c[3] === "job-2710"),
    ).toBe(true);
    expect(state.calls[0]).toEqual(["resolve", "2710", "alp"]);
  });
  it("reads only the chosen source and requested physical pages", async () => {
    const r = await call({ action: "read", document_id: id, page: 2, kind: "spec" });
    expect(r.structuredContent.documents[0]).toMatchObject({
      page_citations_available: true,
      pages: [
        { page: 2, text: "Review with reasonable promptness.", response_text_truncated: false },
      ],
    });
    expect(r.structuredContent.documents[0].pages).toHaveLength(1);
    await expect(
      call({ action: "read", document_id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
    ).rejects.toThrow(/not available on this job/);
    await expect(call({ action: "read" })).rejects.toThrow(/exact document ID/);
  });
  it("uses literal search words in database filtering and result snippets", async () => {
    const r = await call({ action: "search", query: "reasonable promptness" });
    expect(r.structuredContent.documents[0].hits).toEqual([
      { page: 2, quote: "Review with reasonable promptness." },
    ]);
    expect(state.calls).toContainEqual([
      "ilike",
      "mcp_spec_documents",
      "body",
      "%reasonable promptness%",
    ]);
    expect(searchSource(source().body, "insurance", 10)).toEqual([]);
    await call({ action: "search", query: "10%_\\" });
    expect(state.calls).toContainEqual(["ilike", "mcp_spec_documents", "body", "%10\\%\\_\\\\%"]);
    await expect(call({ action: "search" })).rejects.toThrow(/literal words/);
  });
  it("returns every per-kind page without losing records between kinds", async () => {
    state.rows = {
      mcp_contract_documents: [source({ id: "a" }), source({ id: "b" }), source({ id: "c" })],
      mcp_spec_documents: [source({ id: "d" }), source({ id: "e" }), source({ id: "f" })],
    };
    const first = await call({ limit: 2 });
    expect(first.structuredContent.documents.map((d: any) => d.id)).toEqual(["a", "b", "d", "e"]);
    expect(first.structuredContent.next_offset).toBe(2);
    const second = await call({ limit: 2, offset: 2 });
    expect(second.structuredContent.documents.map((d: any) => d.id)).toEqual(["c", "f"]);
    expect(second.structuredContent.next_offset).toBeNull();
  });
  it("preserves missing/legacy mapping and refuses limited job scope", async () => {
    state.rows.mcp_spec_documents = [source({ body: "" })];
    expect(
      (await call({ action: "read", document_id: id })).structuredContent.documents[0],
    ).toMatchObject({ readable: false, page_citations_available: false, pages: [] });
    state.rows.mcp_spec_documents = [source({ body: "Legacy insurance text" })];
    expect(
      (await call({ action: "read", document_id: id })).structuredContent.documents[0],
    ).toMatchObject({
      page_citations_available: false,
      pages: [{ page: null, text: "Legacy insurance text" }],
    });
    state.scope = "super";
    state.calls = [];
    await expect(call({})).rejects.toThrow(/cannot read/);
    expect(state.calls).toHaveLength(1);
    state.scope = "contract";
    await expect(call({})).resolves.toBeDefined();
  });
  it("reports database failures and never exposes storage capabilities", async () => {
    state.error = { message: "unavailable" };
    await expect(call({})).rejects.toThrow("unavailable");
    state.error = null;
    const r = await call({});
    expect(JSON.stringify(r)).not.toMatch(/storage_path|signed_url|upload_url/);
  });
});
describe("physical page provenance", () => {
  it("never invents citations for malformed, nonsequential or embedded page markers", () => {
    for (const body of [
      "legacy",
      "prefix [[PDF page 1]]\ntext",
      "[[PDF page 2]]\ntext",
      "[[PDF page 1]]\ntext\n[[PDF page 1]]\nembedded",
    ])
      expect(sourcePages(body)).toEqual([{ page: null, text: body }]);
    expect(sourcePages("")).toEqual([]);
    expect(searchSource("anything", "", 10)).toEqual([]);
  });
  it("caps page response text explicitly while preserving source identity", async () => {
    state.rows.mcp_spec_documents = [source({ body: "[[PDF page 1]]\n" + "a".repeat(40001) })];
    const doc = (await call({ action: "read", document_id: id })).structuredContent.documents[0];
    expect(doc.pages[0].text).toHaveLength(40000);
    expect(doc.pages[0].response_text_truncated).toBe(true);
  });
});
