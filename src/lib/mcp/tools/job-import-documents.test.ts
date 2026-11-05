import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { zip } from "../../../../tests/support/zip";

const COMPANY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BATCH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const job = { job_id: JOB, job_number: "9001", name: "Fictional Clinic", company_id: COMPANY };

const state = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  docs: [] as { table: string; row: Record<string, unknown> }[],
  rpcs: [] as [string, Record<string, unknown>][],
  failUpload: false,
  applied: false,
  bundle: new Uint8Array() as Uint8Array,
}));

vi.mock("../guard", async (orig) => ({
  ...(await orig<typeof import("../guard")>()),
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) =>
    fn(fakeSb()),
}));
vi.mock("../jobs", async (orig) => ({
  ...(await orig<typeof import("../jobs")>()),
  audit: async () => {},
  memberCompanies: async () => [{ id: COMPANY, name: "ALP Construction" }],
  currentCompany: async () => COMPANY,
  rememberCompany: async () => {},
  resolveJob: async () => ({ ...job, scope: "full" }),
}));

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function fakeSb() {
  return {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array) => {
          if (state.failUpload) return { error: { message: "storage is down" } };
          state.objects.set(`${bucket}/${path}`, bytes);
          return { error: null };
        },
        download: async (path: string) => {
          const data = state.objects.get(`${bucket}/${path}`);
          return data
            ? { data: new Blob([data as BlobPart]), error: null }
            : { data: null, error: { message: "not found" } };
        },
      }),
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const rows = () =>
        state.docs
          .filter((d) => d.table === table)
          .map((d) => d.row)
          .filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return q;
        },
        limit: async () => ({ data: rows(), error: null }),
        maybeSingle: async () =>
          table === "mcp_jobs"
            ? { data: { company_id: COMPANY, pm_user_id: "pm", pm_email: null }, error: null }
            : { data: rows()[0] ?? null, error: null },
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcs.push([fn, args]);
      if (fn === "mcp_job_import_apply") {
        const already = state.applied;
        state.applied = true;
        return {
          data: {
            job_id: JOB,
            job_number: "9001",
            job_created: !already,
            already_applied: already,
          },
          error: null,
        };
      }
      if (fn === "mcp_job_import_completion") return { data: null, error: null };
      if (fn === "mcp_job_import_context")
        return { data: { job_exists: false, scope: null }, error: null };
      if (fn === "mcp_job_import_stage")
        return {
          data: { batch_id: BATCH, package_hash: "f".repeat(32), expires_at: "2026-11-05T13:15Z" },
          error: null,
        };
      if (fn === "mcp_contract_document_save") {
        const p = args._p as Record<string, unknown>;
        const table = p.kind === "spec" ? "mcp_spec_documents" : "mcp_contract_documents";
        const id = crypto.randomUUID();
        state.docs.push({
          table,
          row: {
            id,
            company_id: COMPANY,
            job_id: args._job,
            upload_id: p.upload_id,
            storage_bucket: p.bucket,
            storage_path: p.path,
            file_sha256: p.file_sha256,
            name: p.name,
          },
        });
        return {
          data: { id, body_chars: String(p.body).length, truncated: false, name: p.name },
          error: null,
        };
      }
      return { data: null, error: { message: "unexpected " + fn } };
    },
  };
}

import { jobImport } from "./job-import-tools";

type Reply = { content: { text: string }[]; structuredContent: Record<string, unknown> };
const call = (args: Record<string, unknown>) =>
  (
    jobImport as unknown as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }
  ).handler(args, {});
const shown = (r: Reply) => r.content.map((c) => c.text).join("\n");

const CONTRACT = new TextEncoder().encode("%PDF-1.7 fictional prime contract");
const SPEC = zip({ "word/document.xml": "<w:document><w:t>Section 26 05 19</w:t></w:document>" });
const file = {
  download_url: "https://files.oaiusercontent.com/fictional-export.zip",
  file_id: "fictional-file",
  file_name: "Fictional Clinic.zip",
};
const BUDGET = `Cost Code,Description,Original Budget Amount,Revised Budget\n26-100,Electrical Rough,"$240,000.00","$248,000.00"`;

async function review() {
  const r = await call({
    step: "review",
    source: "procore",
    job_number: "9001",
    job_name: "Fictional Clinic",
    file,
  });
  return r;
}
const save = (extra: Record<string, unknown>) =>
  call({
    step: "save",
    source: "procore",
    batch_id: BATCH,
    import_key: "f".repeat(32),
    confirmed: true,
    ...extra,
  });
const saves = () => state.rpcs.filter(([fn]) => fn === "mcp_contract_document_save");

beforeEach(() => {
  state.objects.clear();
  state.docs = [];
  state.rpcs = [];
  state.failUpload = false;
  state.applied = false;
  state.bundle = zip({
    "Fictional Clinic/Budget.csv": BUDGET,
    "Fictional Clinic/Prime Contracts/Prime Contract.pdf": CONTRACT,
    "Fictional Clinic/Specifications/26 05 19 Wire.docx": SPEC,
    "Fictional Clinic/Commitments/ABC Electric Subcontract.pdf": CONTRACT,
    "Fictional Clinic/Drawings/E-101.pdf": new TextEncoder().encode("%PDF-1.7 sheet"),
    "Fictional Clinic/Photos/site.jpg": new Uint8Array([0xff, 0xd8, 0xff]),
  });
  vi.unstubAllGlobals();
  vi.stubGlobal("fetch", async () => new Response(state.bundle as BodyInit));
});

describe("job import: the export's contract and spec files", () => {
  it("lists them on the review card and stores nothing at review", async () => {
    const r = await review();
    const card = r.structuredContent.card as {
      sections: { heading: string; rows: { cells: string[] }[] }[];
    };
    const section = card.sections.find((s) => s.heading === "Files in the export")!;
    expect(section.rows.map((row) => row.cells[0])).toEqual([
      "Saved as the job's contract: Prime Contract.pdf",
      "Saved as specs (1): 26 05 19 Wire.docx",
      "Drawings (1 file) come in separately: attach the drawing PDF here and ask Athena to import the drawings.",
      "Listed only, not saved (2 files): ABC Electric Subcontract.pdf, site.jpg",
    ]);
    expect(card.sections[0].heading).toBe("Will be saved");
    expect(card.sections[1]).toBe(section);
    expect(r.structuredContent.documents_key).toMatch(/^[0-9a-f]{64}$/);
    expect(String(r.structuredContent.assistant_guidance)).toContain(
      "documents_key with the same file again as file",
    );
    expect(state.objects.size).toBe(0);
    expect(saves()).toHaveLength(0);
  });

  it("stores the contract and spec on the saved job, then adds nothing twice", async () => {
    const key = (await review()).structuredContent.documents_key;
    const r = await save({ file, documents_key: key });
    expect(r.structuredContent.documents).toEqual({
      stored: [
        { name: "Prime Contract.pdf", kind: "contract" },
        { name: "26 05 19 Wire.docx", kind: "spec" },
      ],
      skipped: [],
      failed: [],
      note: null,
    });
    const [contract, spec] = saves().map(
      ([, a]) => a as { _job: string; _p: Record<string, unknown> },
    );
    expect(contract._job).toBe(JOB);
    expect(contract._p).toMatchObject({
      kind: "contract",
      name: "Prime Contract.pdf",
      bucket: "athena-documents",
      file_sha256: sha(CONTRACT),
      size_bytes: CONTRACT.length,
    });
    expect(String(contract._p.path)).toBe(
      `${COMPANY}/${JOB}/${contract._p.upload_id}/Prime Contract.pdf`,
    );
    expect(state.objects.get(`athena-documents/${contract._p.path}`)).toEqual(CONTRACT);
    expect(spec._p).toMatchObject({ kind: "spec", file_sha256: sha(SPEC) });
    expect(String(spec._p.body)).toContain("Section 26 05 19");
    const card = r.structuredContent.card as {
      sections: { heading: string; rows: { cells: string[] }[] }[];
    };
    expect(
      card.sections.find((s) => s.heading === "Documents")!.rows.map((x) => x.cells[0]),
    ).toEqual(["Contract saved: Prime Contract.pdf", "Spec saved: 26 05 19 Wire.docx"]);
    expect(shown(r)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);

    // The same save again: the import was already applied and both files are on the job.
    const again = await save({ file, documents_key: key });
    expect(saves()).toHaveLength(2);
    expect(again.structuredContent.documents).toMatchObject({
      stored: [],
      skipped: [
        {
          name: "Prime Contract.pdf",
          kind: "contract",
          reason: "already on the job, not saved again",
        },
        { name: "26 05 19 Wire.docx", kind: "spec", reason: "already on the job, not saved again" },
      ],
    });
  });

  it("adds the documents on a repeat save when the first save had no file", async () => {
    const key = (await review()).structuredContent.documents_key;
    const first = await save({ documents_key: key });
    expect(first.structuredContent.written).toBe(true);
    expect((first.structuredContent.documents as { note: string }).note).toMatch(
      /weren't saved because the export wasn't attached again/,
    );
    expect(saves()).toHaveLength(0);
    const second = await save({ file, documents_key: key });
    expect(second.structuredContent.written).toBe(false);
    expect((second.structuredContent.documents as { stored: unknown[] }).stored).toHaveLength(2);
  });

  it("says no documents were attached when save has no file", async () => {
    const r = await save({});
    expect(r.structuredContent.documents).toMatchObject({ stored: [], note: null });
    expect(String((r.structuredContent.documents as { retry: string }).retry)).toMatch(
      /No file came with this save/,
    );
  });

  it("stores nothing from a file that isn't the one reviewed", async () => {
    const key = (await review()).structuredContent.documents_key;
    state.bundle = zip({ "Prime Contracts/Other Agreement.pdf": CONTRACT });
    const r = await save({ file, documents_key: key });
    expect((r.structuredContent.documents as { note: string }).note).toMatch(/isn't the export/);
    expect(saves()).toHaveLength(0);
  });

  it("keeps the import saved when storage fails, and says what wasn't stored", async () => {
    const key = (await review()).structuredContent.documents_key;
    state.failUpload = true;
    const r = await save({ file, documents_key: key });
    expect(r.structuredContent.written).toBe(true);
    expect(state.rpcs.some(([fn]) => fn === "mcp_job_import_apply")).toBe(true);
    expect(r.structuredContent.documents).toMatchObject({
      stored: [],
      failed: [
        {
          name: "Prime Contract.pdf",
          kind: "contract",
          reason: "The file could not be stored. Try again.",
        },
        { name: "26 05 19 Wire.docx", kind: "spec" },
      ],
    });
    const card = r.structuredContent.card as {
      sections: { heading: string; rows: { cells: string[] }[] }[];
    };
    expect(card.sections.find((s) => s.heading === "Documents")!.rows[0].cells[0]).toBe(
      "Contract not saved: Prime Contract.pdf. The file could not be stored. Try again. The import is saved.",
    );
  });

  it("never replaces a contract the job already has", async () => {
    const key = (await review()).structuredContent.documents_key;
    state.docs.push({
      table: "mcp_contract_documents",
      row: {
        company_id: COMPANY,
        job_id: JOB,
        name: "Signed Contract.pdf",
        file_sha256: "0".repeat(64),
      },
    });
    const r = await save({ file, documents_key: key });
    expect(r.structuredContent.documents).toMatchObject({
      stored: [{ name: "26 05 19 Wire.docx", kind: "spec" }],
      skipped: [
        {
          name: "Prime Contract.pdf",
          reason:
            "not saved, the job already has a contract (Signed Contract.pdf) and Athena kept it",
        },
      ],
    });
  });
});

describe("review card section without a save step", () => {
  it("says the files aren't saved by this review and skips one already on the job", async () => {
    const { documentsSection } = await import("../job-import-documents");
    const section = await documentsSection(
      {
        documents: [
          { name: "Prime Contracts/Prime Contract.pdf", kind: "contract", bytes: CONTRACT },
          { name: "Specifications/Wire.docx", kind: "spec", bytes: SPEC },
        ],
        drawings: [],
        other: [
          {
            name: "Prime Contracts/Exhibit.pdf",
            bytes: 9,
            note: "Athena keeps one contract per job",
          },
        ],
      },
      false,
      [{ name: "Wire.docx", file_sha256: sha(SPEC), kind: "spec" }],
    );
    expect(section!.rows.map((r) => r.cells[0])).toEqual([
      "Not saved by this review: Prime Contract.pdf. Attach each one on its own and ask Athena to save it to the job's contract or specs.",
      "Already on the job, not saved again: Wire.docx",
      "Listed only, Exhibit.pdf: Athena keeps one contract per job",
    ]);
  });
});
