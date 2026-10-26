import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsPDF } from "jspdf";
import { createHash } from "node:crypto";
import { visibleProblems } from "./visible";

const state = vi.hoisted(() => ({
  job: {
    job_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    job_number: "2701",
    name: "Harbor",
    company_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    scope: "full" as "full" | "contract" | "super",
  },
  objects: new Map<string, Uint8Array>(),
  session: null as Record<string, unknown> | null,
  attached: "" as string,
  rpcs: [] as [string, Record<string, unknown>][],
  fetches: 0,
  recoveredDoc: null as {
    id: string;
    body: string;
    storage_path: string;
    file_sha256: string;
    [key: string]: unknown;
  } | null,
}));

vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) =>
    fn(fakeSb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
vi.mock("./jobs", () => ({
  FULL_ACCESS_MESSAGE: "This needs full access to the job. Your role can't do it.",
  READ_ONLY_MESSAGE:
    "Your role has a limited, read-only view of this job (no financials). Ask your owner or PM to make changes.",
  audit: async () => {},
  memberCompanies: async () => [{ id: state.job.company_id, name: "ALP Construction" }],
  prefix: (job: { job_number: string }) => `${job.job_number} – `,
  resolveJob: async () => state.job,
}));

function fakeSb() {
  return {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array) => {
          state.objects.set(`${bucket}/${path}`, bytes);
          return { error: null };
        },
        download: async (path: string) => {
          const data = state.objects.get(`${bucket}/${path}`);
          return data
            ? { data: new Blob([data as BlobPart]), error: null }
            : { data: null, error: { message: "missing" } };
        },
      }),
    },
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        maybeSingle: async () => ({
          data: table === "mcp_spec_documents" ? state.recoveredDoc : null,
          error: null,
        }),
        limit: async () => ({
          data: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
          error: null,
        }),
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcs.push([fn, args]);
      if (fn === "mcp_file_upload_begin") {
        const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        state.session = {
          id,
          bucket: args._purpose === "submittal_piece" ? "athena-submittals" : "athena-documents",
          storage_path:
            args._purpose === "submittal_piece"
              ? `${state.job.company_id}/${state.job.job_id}/pieces/${id}/${args._filename}`
              : `${state.job.company_id}/${state.job.job_id}/${id}/${args._filename}`,
          expires_at: new Date(Date.now() + 7200_000).toISOString(),
          purpose: args._purpose,
          filename: args._filename,
          mime_type: args._mime,
          status: "open",
          chunks: [],
          submittal_id: args._submittal,
          piece_id: args._piece,
          new_piece: args._new_piece,
          result: null,
        };
        return { data: state.session, error: null };
      }
      if (fn === "mcp_file_upload_get") return { data: state.session, error: null };
      if (fn === "mcp_file_upload_chunk") {
        const chunks = ((state.session?.chunks as number[]) ?? []).concat(args._index as number);
        state.session = { ...state.session, chunks };
        return { data: { id: args._id }, error: null };
      }
      if (fn === "mcp_file_upload_complete") {
        state.session = { ...state.session, status: "finished", result: args._result };
        return { data: args._result, error: null };
      }
      if (fn === "mcp_contract_document_save") {
        const body = String((args._p as { body: string }).body);
        if (state.recoveredDoc) state.recoveredDoc.body = body;
        return {
          data: {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            body_chars: body.length,
            truncated: false,
            name: (args._p as { name: string }).name,
          },
          error: null,
        };
      }
      if (fn === "mcp_submittal_package_context") {
        const path = state.attached;
        return {
          data: {
            is_current: true,
            items: [
              {
                id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                kind: "product_cut",
                source_party: "Fictional Manufacturer",
                status: path ? "received" : "needed",
                file_ref: path ? `athena-submittals/${path}` : null,
                required: true,
              },
            ],
          },
          error: null,
        };
      }
      if (fn === "mcp_submittal_package_write") {
        state.attached = String((args._p as { path?: string }).path ?? "");
        return { data: { ok: true }, error: null };
      }
      return { data: null, error: { message: "unexpected " + fn } };
    },
  };
}

import { fileUpload } from "./tools/file-upload-tool";

type Reply = { content: { text: string }[]; structuredContent: Record<string, unknown> };
const call = (args: Record<string, unknown>) =>
  (
    fileUpload as unknown as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }
  ).handler(args, {});
const visible = (r: Reply) => r.content.map((c) => c.text).join("\n");

beforeEach(() => {
  state.job.scope = "full";
  state.objects.clear();
  state.session = null;
  state.attached = "";
  state.rpcs = [];
  state.fetches = 0;
  state.recoveredDoc = null;
  vi.unstubAllGlobals();
});

describe("file_upload tool", () => {
  it("returns an upload link and does not store the raw token", async () => {
    const r = await call({
      action: "begin",
      job_number: "2701",
      purpose: "contract",
      filename: "Agreement.pdf",
    });
    const link = r.structuredContent.upload_url as string;
    expect(link).toMatch(/^https:\/\/app\.meetathena\.io\/r\/file-upload\/[A-Za-z0-9_-]{43}$/);
    expect(visible(r)).toContain(link);
    expect(visibleProblems(visible(r))).toEqual([]);
    const begin = state.rpcs.find(([fn]) => fn === "mcp_file_upload_begin")!;
    expect(JSON.stringify(begin[1])).not.toContain(link.split("/").pop());
    expect(begin[1]._token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(visible(r).toLowerCase()).not.toMatch(/\b(lovable|supabase)\b/);
  });

  it("assembles chunks under the call cap and stores the contract text", async () => {
    await call({
      action: "begin",
      job_number: "2701",
      purpose: "contract",
      filename: "Agreement.txt",
    });
    const chunk = Buffer.from("notice within 7 calendar days").toString("base64");
    await call({
      action: "chunk",
      job_number: "2701",
      upload_id: state.session!.id,
      chunk_index: 0,
      content_base64: chunk,
    });
    const r = await call({ action: "finish", job_number: "2701", upload_id: state.session!.id });
    expect(visible(r)).toMatch(/Contract stored: Agreement.txt/);
    expect(visible(r)).toMatch(/Text read from the file: \d+ characters/);
    expect(visibleProblems(visible(r))).toEqual([]);
    const save = state.rpcs.find(([fn]) => fn === "mcp_contract_document_save")!;
    expect((save[1]._p as { body: string }).body).toContain("notice within 7 calendar days");
    await expect(
      call({
        action: "chunk",
        job_number: "2701",
        upload_id: state.session!.id,
        chunk_index: 1,
        content_base64: "A".repeat(12000),
        source_url: "https://files.oaiusercontent.com/" + "x".repeat(10000),
      }),
    ).rejects.toThrow(/20,000/);
  });

  it("fetches an allowed link and attaches a submittal piece", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7\nBT (product cut) Tj ET");
    vi.stubGlobal("fetch", async () => {
      state.fetches += 1;
      return new Response(pdf);
    });
    const r = await call({
      action: "from_url",
      job_number: "2701",
      purpose: "submittal_piece",
      filename: "cut.pdf",
      submittal_number: "05 12 00-001",
      package_item: "P1",
      source_url: "https://files.oaiusercontent.com/file-abc?sig=1",
    });
    expect(state.fetches).toBe(1);
    expect(visible(r)).toMatch(/P1 product cut from Fictional Manufacturer is stored/);
    expect(state.rpcs.some(([fn]) => fn === "mcp_submittal_package_write")).toBe(true);
    state.fetches = 0;
    await expect(
      call({
        action: "from_url",
        job_number: "2701",
        purpose: "contract",
        filename: "a.pdf",
        source_url: "https://evil.example/a.pdf",
      }),
    ).rejects.toThrow(/can't fetch that link/);
    expect(state.fetches).toBe(0);
    state.job.scope = "contract";
    await expect(
      call({
        action: "from_url",
        job_number: "2701",
        purpose: "submittal_piece",
        filename: "cut.pdf",
        submittal_number: "05 12 00-001",
        package_item: "P1",
        source_url: "https://files.oaiusercontent.com/file-abc?sig=1",
      }),
    ).rejects.toThrow(/full access/);
  });
  it("recovers an unreadable finished spec once, retaining source and document identities", async () => {
    await call({ action: "begin", job_number: "2701", purpose: "spec", filename: "Spec.pdf" });
    const session = state.session!;
    const pdf = new jsPDF({ compress: true });
    pdf.text("Submittals reviewed with reasonable promptness.", 10, 20);
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    state.objects.set(`athena-documents/${session.storage_path}`, bytes);
    session.status = "finished";
    session.expires_at = "2000-01-01T00:00:00Z";
    session.result = {
      visible: "File stored, no readable text.",
      structured: {
        stored: true,
        body_chars: 0,
        document_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        upload_id: session.id,
        purpose: "spec",
      },
    };
    state.recoveredDoc = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      body: "",
      storage_path: String(session.storage_path),
      file_sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const result = await call({ action: "finish", job_number: "2701", upload_id: session.id });
    expect(result.structuredContent.body_chars).toBeGreaterThan(0);
    expect(result.structuredContent.document_id).toBe(state.recoveredDoc.id);
    const saves = () => state.rpcs.filter(([fn]) => fn === "mcp_contract_document_save");
    expect(saves()).toHaveLength(1);
    const replay = await call({ action: "finish", job_number: "2701", upload_id: session.id });
    expect(replay.structuredContent.body_chars).toBeGreaterThan(0);
    expect(saves()).toHaveLength(1);
    expect(state.rpcs.filter(([fn]) => fn === "mcp_file_upload_begin")).toHaveLength(1);
    expect(
      [...state.objects.keys()].filter((key) => !key.includes(".athena-")),
    ).toHaveLength(1);
    expect(
      [...state.objects.keys()].filter((key) => key.includes(".athena-readable-")),
    ).toHaveLength(1);
  });

  it("refuses failed-spec recovery when original bytes differ", async () => {
    await call({ action: "begin", job_number: "2701", purpose: "spec", filename: "Spec.txt" });
    const session = state.session!;
    session.status = "finished";
    session.result = {
      visible: "stored",
      structured: { body_chars: 0, document_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
    };
    state.recoveredDoc = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      body: "",
      storage_path: String(session.storage_path),
      file_sha256: "ab".repeat(32),
    };
    state.objects.set(
      `athena-documents/${session.storage_path}`,
      new TextEncoder().encode("changed bytes"),
    );
    await expect(
      call({ action: "finish", job_number: "2701", upload_id: session.id }),
    ).rejects.toThrow(/original bytes/);
    expect(state.rpcs.some(([fn]) => fn === "mcp_contract_document_save")).toBe(false);
  });

  it("never retries completed official contracts or already readable uploads", async () => {
    for (const purpose of ["contract", "spec"]) {
      await call({ action: "begin", job_number: "2701", purpose, filename: "source.txt" });
      const session = state.session!;
      session.status = "finished";
      session.result = {
        visible: "original receipt",
        structured: { body_chars: purpose === "contract" ? 0 : 20, stored: true },
      };
      const result = await call({ action: "finish", job_number: "2701", upload_id: session.id });
      expect(visible(result)).toContain("original receipt");
    }
    expect(state.rpcs.some(([fn]) => fn === "mcp_contract_document_save")).toBe(false);
  });
});

it("explicit preparation reuses the exact existing PDF without starting an upload or saving contract facts", async () => {
  const pdf = new jsPDF();
  pdf.text("Existing saved document", 10, 20);
  const bytes = new Uint8Array(pdf.output("arraybuffer"));
  const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    upload = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const path = `${state.job.company_id}/${state.job.job_id}/${upload}/Existing.pdf`;
  state.objects.set(`athena-documents/${path}`, bytes);
  state.recoveredDoc = {
    id,
    body: "cached",
    storage_path: path,
    file_sha256: createHash("sha256").update(bytes).digest("hex"),
    company_id: state.job.company_id,
    job_id: state.job.job_id,
    upload_id: upload,
    storage_bucket: "athena-documents",
    size_bytes: bytes.length,
    mime_type: "application/pdf",
  };
  const result = await call({
    action: "prepare_readable",
    job_number: "2701",
    document_id: id,
    company_id: state.job.company_id,
  });
  expect(result.structuredContent).toMatchObject({
    readable_state: "ready",
    total_pdf_pages: 1,
    original_changed: false,
    reused_extraction: false,
  });
  const replay = await call({ action: "prepare_readable", job_number: "2701", document_id: id });
  expect(replay.structuredContent.reused_extraction).toBe(true);
  expect(state.rpcs).toEqual([]);
  expect(state.objects.get(`athena-documents/${path}`)).toEqual(bytes);
  await expect(
    call({
      action: "prepare_readable",
      job_number: "2701",
      document_id: id,
      company_id: "another-company",
    }),
  ).rejects.toThrow(/not in the company/);
  state.job.scope = "super";
  await expect(
    call({ action: "prepare_readable", job_number: "2701", document_id: id }),
  ).rejects.toThrow(/read-only/);
});
