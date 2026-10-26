import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { prepareReadable } from "./document-readable";
import { clauseIndexKey } from "./document-clause-index";
const job = {
  job_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  job_number: "2710",
  name: "TEST",
};
const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  upload = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const state = vi.hoisted(() => ({
  scope: "contract",
  source: {} as Record<string, unknown>,
  objects: new Map<string, Uint8Array>(),
  writes: [] as string[],
}));
const words =
  "8.4.4 Delay Notice\nGive notice to Owner within five (5) calendar days from the beginning of delay.";
function backend() {
  return {
    storage: {
      from: () => ({
        download: async (path: string) =>
          state.objects.has(path)
            ? { data: new Blob([state.objects.get(path)! as BlobPart]), error: null }
            : { data: null, error: { statusCode: "404", message: "missing" } },
        upload: async (path: string, bytes: Uint8Array) => {
          state.writes.push("derived_object");
          state.objects.set(path, bytes);
          return { error: null };
        },
      }),
    },
    from: (table: string) => {
      let rows =
        table === "mcp_contract_documents"
          ? [state.source]
          : table === "mcp_jobs"
            ? [{ id: job.job_id }]
            : [];
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          rows = rows.filter((r) => r[k] === v);
          return q;
        },
        in: () => q,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
      };
      return q;
    },
    rpc: async (fn: string) => {
      if (fn === "mcp_living_report_get") return { data: { found: false }, error: null };
      throw new Error("Unexpected write " + fn);
    },
  };
}
vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => unknown) => fn(backend()),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (e: Error) => {
    throw e;
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  resolveJob: async () => ({ ...job, scope: state.scope }),
  prefix: () => "2710 – ",
  named: () => "2710 – TEST",
  flagWord: (s: string) => s.toUpperCase(),
  audit: async () => {},
  memberCompanies: async () => [{ id: job.company_id, name: "ALP Construction" }],
  FULL_ACCESS_MESSAGE: "Full access required",
  READ_ONLY_MESSAGE: "Read only",
}));
import { contractTerms } from "./tools/workflow-tools";
import { cpmActivities } from "./tools/living-tools";
const call = (tool: unknown, args: Record<string, unknown> = {}) =>
  (tool as { handler: (a: unknown, c: unknown) => Promise<{ structuredContent: any }> }).handler(
    { job_number: "2710", ...args },
    {},
  );
beforeEach(async () => {
  state.scope = "contract";
  state.objects.clear();
  state.writes = [];
  const bytes = new TextEncoder().encode("source original");
  state.source = {
    id,
    name: "Uploaded contract.pdf",
    job_id: job.job_id,
    company_id: job.company_id,
    upload_id: upload,
    storage_bucket: "athena-documents",
    storage_path: `${job.company_id}/${job.job_id}/${upload}/Source.pdf`,
    mime_type: "application/pdf",
    size_bytes: bytes.length,
    file_sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await prepareReadable(backend() as never, state.source as never, bytes, [words]);
  state.writes = [];
});
it("shows automatically extracted source wording in the contract card with no approval, confirmation or writes", async () => {
  const result = (await call(contractTerms)).structuredContent;
  expect(result.notice_requirements.status).toBe("extracted_source_text");
  expect(result.source_clauses[0].text).toBe(words);
  expect(result.source_clauses[0]).toMatchObject({
    source_id: id,
    filename: "Uploaded contract.pdf",
    section: "8.4.4",
  });
  expect(result.card.ask).toBeUndefined();
  expect(JSON.stringify(result.card)).not.toMatch(/approve|confirm and save|activate/i);
  expect(result.card.kpis[0]).toEqual({ label: "Extracted clauses", value: "1" });
  expect(state.writes).toEqual([]);
  state.scope = "full";
  const cpm = (await call(cpmActivities)).structuredContent;
  expect(cpm.source_clauses[0].text).toBe(words);
  expect(state.writes).toEqual([]);
});
it("uses existing saved text if a legacy upload has no separate clause index; no activation step", async () => {
  state.objects.delete(clauseIndexKey(state.source as never));
  const result = (await call(contractTerms)).structuredContent;
  expect(result.source_clauses[0].text).toBe(words);
  expect(state.writes).toEqual([]);
  expect(result.source_issues).toEqual([]);
});
it("never substitutes another job's source and retains unreadable evidence explicitly", async () => {
  state.source.job_id = "another-job";
  expect((await call(contractTerms)).structuredContent.source_clauses).toBeUndefined();
  expect(state.writes).toEqual([]);
});

it("rejects a wrongly named company rather than falling back to a unique job", async () => {
  await expect(call(contractTerms, { company_id: "wrong-company" })).rejects.toThrow(
    /not in the company/,
  );
  expect(state.writes).toEqual([]);
});

it("preserves the legacy response when an older source uses a different storage reference", async () => {
  state.source.storage_bucket = "legacy-private-bucket";
  const result = (await call(contractTerms)).structuredContent;
  expect(result.source_clauses).toBeUndefined();
  expect(result.source_issues[0]).toContain("original and existing records are unchanged");
  expect(state.writes).toEqual([]);
});
