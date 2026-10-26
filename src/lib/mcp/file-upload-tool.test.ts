import { beforeEach, describe, expect, it, vi } from "vitest";
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
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: async () => ({
                data: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
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
});
