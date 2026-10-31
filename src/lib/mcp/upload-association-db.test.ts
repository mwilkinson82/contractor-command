/* eslint-disable @typescript-eslint/no-explicit-any -- actual scoped PostgreSQL tool fixtures */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ToolError } from "@lovable.dev/mcp-js";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser, fakeClient } from "../../../tests/mcp-roles/fake-supabase";
import { uploadCard } from "../../../tests/support/file-upload-card";

const owner = "00000000-0000-4000-8000-000000000721";
const outsider = "00000000-0000-4000-8000-000000000722";
const peer = "00000000-0000-4000-8000-000000000723";
const companies = [731, 732, 733].map(
  (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
);
const jobs = [741, 742, 743].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const objects = new Map<string, Uint8Array>();
let db: PGlite;
let clients = 0;
const rpcCalls: string[] = [];
const claims = { sub: owner, email: "fictional-owner@example.com", role: "authenticated" as const };

// Each tool gets a fresh client. Actual migrated RLS and RPCs decide row/job access.
function client() {
  clients++;
  const scoped = fakeClient(db, claims);
  return {
    ...scoped,
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push(name);
      return scoped.rpc(name, args);
    },
    from(table: string) {
      const query = scoped.from(table);
      return Object.assign(query, {
        range: (from: number, to: number) => {
          if (from !== 0) throw new Error("Fixture expects the first page");
          return query.limit(to + 1);
        },
      });
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => ({
          data: objects.has(`${bucket}/${path}`)
            ? new Blob([objects.get(`${bucket}/${path}`)! as BlobPart])
            : null,
          error: null,
        }),
      }),
    },
  };
}
vi.mock("./guard", () => ({
  run: async (_tool: string, _ctx: unknown, _opts: unknown, fn: (sb: unknown) => unknown) =>
    fn(client()),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (error: { message: string }) => {
    throw new ToolError(error.message);
  },
}));
import { fileUpload } from "./tools/file-upload-tool";
import { projectDocuments } from "./tools/document-read-tools";
import { jobsList } from "./tools/discovery-tools";
import { setCurrentCompany } from "./tools/team-tools";
import { handleFileUpload } from "../file-upload-route.server";

const call = (tool: unknown, args: Record<string, unknown>) =>
  (tool as { handler: (args: unknown, ctx: unknown) => Promise<any> }).handler(args, {});
const list = (company = companies[0]) =>
  call(projectDocuments, {
    job_number: "SYN-1",
    company_id: company,
    action: "list",
    offset: 0,
    limit: 10,
  });

beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE FUNCTION public.get_user_tier(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'circle'::text $$;",
  );
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;",
  );
  for (const filename of [
    "20261021190000_athena_team_invites.sql",
    "20261022120000_athena_account_team_privacy_terms.sql",
    "20261031120000_athena_file_upload.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${filename}`, "utf8"));
  await db.exec(readFileSync("release-proposals/file-upload-recovery.sql", "utf8"));
  for (const user of [owner, outsider, peer]) {
    await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.com')", [user]);
    await db.query("INSERT INTO test_active_members VALUES($1)", [user]);
  }
  for (let index = 0; index < companies.length; index++) {
    const user = index === 2 ? outsider : owner;
    await db.query(
      "INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Fictional Builder',$2)",
      [companies[index], user],
    );
    await db.query(
      "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Fixture owner')",
      [companies[index], user],
    );
    await db.query(
      "INSERT INTO mcp_jobs(id,company_id,job_number,name,user_id) VALUES($1,$2,'SYN-1','Fictional Bid',$3)",
      [jobs[index], companies[index], user],
    );
  }
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'contracts','Fixture peer')",
    [companies[0], peer],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,company_id,job_number,name,user_id) VALUES('00000000-0000-4000-8000-000000000744',$1,'ONLY-A','Fictional isolated job',$2)",
    [companies[0], owner],
  );
}, 30000);
afterAll(() => db.close());

async function upload(purpose = "contract") {
  const begun = await call(fileUpload, {
    action: "begin",
    job_number: "SYN-1",
    company_id: companies[0],
    purpose,
    filename: "Fictional.txt",
  });
  const token = new URL(begun.structuredContent.upload_url).pathname.split("/").pop()!;
  const response = await handleFileUpload(
    new Request("https://example.test/upload", { method: "PUT", body: "Fictional source text" }),
    token,
    {
      lookup: async (hash) =>
        (await db.query<any>("SELECT * FROM mcp_file_uploads WHERE token_hash=$1", [hash]))
          .rows[0] ?? null,
      put: async (bucket, path, bytes) => {
        await asUser(db, claims, (tx) =>
          tx.query("INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)", [bucket, path]),
        );
        objects.set(`${bucket}/${path}`, bytes);
      },
    },
  );
  return { begun: begun.structuredContent, response };
}

describe("upload and company choices across fresh scoped tool calls", () => {
  it("lists the saved file on the exact job after verified finish, but not after bytes alone", async () => {
    const { begun, response } = await upload();
    expect(await response.json()).toMatchObject({
      stored: true,
      upload_complete: false,
      finish_required: true,
    });
    expect((await list()).structuredContent.documents).toEqual([]);
    const before = clients;
    const finished = await call(fileUpload, {
      action: "finish",
      job_number: "SYN-1",
      company_id: companies[0],
      upload_id: begun.upload_id,
    });
    expect(finished.structuredContent).toMatchObject({
      job_association: "verified",
      upload_complete: true,
    });
    const fresh = await list();
    expect(clients).toBe(before + 2);
    expect(fresh.structuredContent.documents).toEqual([
      expect.objectContaining({
        id: finished.structuredContent.document_id,
        name: "Fictional.txt",
        kind: "contract",
      }),
    ]);
  });

  it("keeps inaccessible companies/jobs hidden after selecting a returned company ID", async () => {
    const portfolio = await call(jobsList, {});
    for (const id of companies.slice(0, 2)) expect(portfolio.content[0].text).toContain(id);
    expect(JSON.stringify(portfolio)).not.toContain(companies[2]);
    await expect(call(setCurrentCompany, { company_id: "Fictional Builder" })).rejects.toThrow(
      "More than one of your companies",
    );
    await call(setCurrentCompany, { company_id: companies[1] });
    expect(
      (
        await db.query<any>("SELECT current_company FROM mcp_user_settings WHERE user_id=$1", [
          owner,
        ])
      ).rows[0].current_company,
    ).toBe(companies[1]);
    expect((await list(companies[1])).structuredContent.documents).toEqual([]);
    await expect(list(companies[2])).rejects.toThrow("Which company?");
    expect(await client().from("mcp_jobs").select("id").eq("id", jobs[2])).toMatchObject({
      data: [],
    });
    await expect(call(setCurrentCompany, { company_id: companies[2] })).rejects.toThrow(
      /aren't a member/,
    );
  });

  it("does not finalize an expired upload even when its bytes exist", async () => {
    const { begun } = await upload("spec");
    await db.query("UPDATE mcp_file_uploads SET expires_at=now()-interval '1 minute' WHERE id=$1", [
      begun.upload_id,
    ]);
    await expect(
      call(fileUpload, {
        action: "finish",
        job_number: "SYN-1",
        company_id: companies[0],
        upload_id: begun.upload_id,
      }),
    ).rejects.toThrow(/expired/);
    expect(
      (await list()).structuredContent.documents.filter((doc: any) => doc.kind === "spec"),
    ).toEqual([]);
  });
});

describe("actual authenticated upload card completion and recovery", () => {
  const views: ReturnType<typeof uploadCard>[] = [];
  let counter = 0;
  async function begin(purpose = "spec") {
    const filename = `Fictional-flow-${++counter}.txt`;
    return {
      filename,
      result: await call(fileUpload, {
        action: "begin",
        job_number: "SYN-1",
        company_id: companies[0],
        purpose,
        filename,
      }),
    };
  }
  const dispatch = (name: string, args: Record<string, unknown>) =>
    call(name === "file_upload" ? fileUpload : projectDocuments, args);
  const put: typeof fetch = async (input, init) => {
    const request = new Request(String(input), init);
    const token = new URL(request.url).pathname.split("/").pop()!;
    return handleFileUpload(request, token, {
      lookup: async (hash) =>
        (await db.query<any>("SELECT * FROM mcp_file_uploads WHERE token_hash=$1", [hash]))
          .rows[0] ?? null,
      put: async (bucket, path, bytes) => {
        await asUser(db, claims, (tx) =>
          tx.query("INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)", [bucket, path]),
        );
        objects.set(`${bucket}/${path}`, bytes);
      },
    });
  };
  function view(options: { dispatch?: typeof dispatch; fetch?: typeof fetch } = {}) {
    const v = uploadCard({ dispatch: options.dispatch ?? dispatch, fetch: options.fetch ?? put });
    views.push(v);
    return v;
  }
  async function ready(v: ReturnType<typeof uploadCard>, result: unknown) {
    v.result(result);
    await vi.waitFor(() =>
      expect(v.all().some((el) => el.tagName === "INPUT" && !el.disabled)).toBe(true),
    );
  }
  function choose(v: ReturnType<typeof uploadCard>, filename: string) {
    v.choose(new File(["Fictional upload source"], filename, { type: "text/plain" }));
    v.click("Add file to job");
  }
  afterAll(() => {
    views.forEach((v) => v.close());
  });

  it.each(["contract", "spec"])(
    "uploads a %s and attaches in one card action, then appears in a fresh job-file call",
    async (purpose) => {
      const started = await begin(purpose),
        v = view();
      await ready(v, started.result);
      choose(v, started.filename);
      await vi.waitFor(() => expect(v.status.textContent).toBe("File added to job."));
      expect(v.calls.filter((c) => c.arguments.action === "finish")).toHaveLength(1);
      expect(v.calls.find((c) => c.arguments.action === "finish")!.arguments).toMatchObject({
        company_id: companies[0],
        job_number: "SYN-1",
        upload_id: started.result.structuredContent.upload_id,
      });
      const fresh = await list();
      expect(fresh.structuredContent.documents.some((d: any) => d.name === started.filename)).toBe(
        true,
      );
      expect(
        fresh.structuredContent.pending_uploads.some(
          (u: any) => u.upload_id === started.result.structuredContent.upload_id,
        ),
      ).toBe(false);
      const saves = rpcCalls.filter((name) => name === "mcp_contract_document_save").length;
      const reopened = view();
      reopened.result(started.result);
      await vi.waitFor(() => expect(reopened.status.textContent).toBe("File added to job."));
      expect(rpcCalls.filter((name) => name === "mcp_contract_document_save")).toHaveLength(saves);
      v.close();
      reopened.close();
    },
  );

  it("retries completion with the same ID after a recoverable host failure", async () => {
    const started = await begin();
    let fail = true;
    const v = view({
      dispatch: async (name, args) => {
        if (args.action === "finish" && fail) {
          fail = false;
          throw new Error("Temporary host failure");
        }
        return dispatch(name, args);
      },
    });
    await ready(v, started.result);
    choose(v, started.filename);
    await vi.waitFor(() => expect(v.status.textContent).toContain("Temporary host failure"));
    expect(v.app.textContent).not.toContain("File added to job");
    v.click("Retry completion");
    await vi.waitFor(() => expect(v.status.textContent).toBe("File added to job."));
    expect(
      v.calls.filter((c) => c.arguments.action === "finish").map((c) => c.arguments.upload_id),
    ).toEqual([
      started.result.structuredContent.upload_id,
      started.result.structuredContent.upload_id,
    ]);
    expect(v.calls.filter((c) => c.arguments.action === "begin")).toEqual([]);
    v.close();
  });

  it("recovers received bytes after the card closes, through fresh-chat job files", async () => {
    const started = await begin();
    const v = view({
      fetch: async (input, init) => {
        await put(input, init);
        throw new Error("Upload reply dropped");
      },
    });
    await ready(v, started.result);
    choose(v, started.filename);
    await vi.waitFor(() => expect(v.status.textContent).toContain("Upload reply dropped"));
    v.close();
    const freshResult = await list();
    expect(
      freshResult.structuredContent.documents.some((d: any) => d.name === started.filename),
    ).toBe(false);
    expect(freshResult.structuredContent.pending_uploads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          upload_id: started.result.structuredContent.upload_id,
          bytes_received: true,
        }),
      ]),
    );
    const recovered = view();
    recovered.result(freshResult);
    recovered.click("Resume upload", started.filename);
    await vi.waitFor(() => expect(recovered.status.textContent).toBe("File added to job."));
    expect(recovered.calls.some((c) => c.arguments.action === "begin")).toBe(false);
    expect(
      (await list()).structuredContent.documents.some((d: any) => d.name === started.filename),
    ).toBe(true);
    recovered.close();
  });

  it("reconciles a lost completion response without another save", async () => {
    const started = await begin();
    let drop = true;
    const v = view({
      dispatch: async (name, args) => {
        const result = await dispatch(name, args);
        if (args.action === "finish" && drop) {
          drop = false;
          throw new Error("Completion reply dropped");
        }
        return result;
      },
    });
    await ready(v, started.result);
    choose(v, started.filename);
    await vi.waitFor(() => expect(v.status.textContent).toContain("Completion reply dropped"));
    const saves = rpcCalls.filter((name) => name === "mcp_contract_document_save").length;
    v.click("Retry completion");
    await vi.waitFor(() => expect(v.status.textContent).toBe("File added to job."));
    expect(rpcCalls.filter((name) => name === "mcp_contract_document_save")).toHaveLength(saves);
    v.close();
  });

  it("denies another member's pending upload even with the known ID", async () => {
    const started = await begin();
    claims.sub = peer;
    try {
      const ownFiles = await list();
      expect(ownFiles.structuredContent.pending_uploads).toEqual([]);
      await expect(
        call(fileUpload, {
          action: "finish",
          company_id: companies[0],
          job_number: "SYN-1",
          upload_id: started.result.structuredContent.upload_id,
        }),
      ).rejects.toThrow("not available to you");
      const v = view();
      v.result(started.result);
      await vi.waitFor(() => expect(v.status.textContent).toContain("not available to you"));
      expect(v.app.textContent).not.toContain("File added to job");
      expect(v.all().some((el) => el.tagName === "INPUT")).toBe(false);
      v.close();
    } finally {
      claims.sub = owner;
    }
  });

  it("keeps the explicit selected company and job boundary before creating or resuming", async () => {
    const count = (await db.query<any>("SELECT count(*)::int AS n FROM mcp_file_uploads")).rows[0]
      .n;
    await expect(
      call(fileUpload, {
        action: "begin",
        company_id: companies[1],
        job_number: "ONLY-A",
        purpose: "spec",
        filename: "Wrong-company.txt",
      }),
    ).rejects.toThrow("not in the company you named");
    expect((await db.query<any>("SELECT count(*)::int AS n FROM mcp_file_uploads")).rows[0].n).toBe(
      count,
    );
    const started = await begin();
    await expect(
      call(fileUpload, {
        action: "resume",
        company_id: companies[1],
        job_number: "SYN-1",
        upload_id: started.result.structuredContent.upload_id,
      }),
    ).rejects.toThrow("not available to you");
  });

  it("shows expired recovery without attaching or silently starting a replacement", async () => {
    const started = await begin();
    await db.query("UPDATE mcp_file_uploads SET expires_at=now()-interval '1 minute' WHERE id=$1", [
      started.result.structuredContent.upload_id,
    ]);
    const v = view();
    v.result(await list());
    v.click("Review expired upload", started.filename);
    await vi.waitFor(() => expect(v.app.textContent).toContain("This upload expired"));
    expect(
      v.calls.some((c) => c.arguments.action === "finish" || c.arguments.action === "begin"),
    ).toBe(false);
    v.close();
  });

  it("does not display success for a completion response on another company or job", async () => {
    const started = await begin();
    const v = view({
      dispatch: async (name, args) =>
        args.action === "finish"
          ? {
              structuredContent: {
                company_id: companies[1],
                job_number: "SYN-1",
                upload_id: started.result.structuredContent.upload_id,
                document_id: "00000000-0000-4000-8000-000000000799",
                job_association: "verified",
              },
            }
          : dispatch(name, args),
    });
    await ready(v, started.result);
    choose(v, started.filename);
    await vi.waitFor(() =>
      expect(v.status.textContent).toContain("exact job attachment was not confirmed"),
    );
    expect(v.app.textContent).not.toContain("File added to job");
    v.close();
  });

  it("fails closed when current membership becomes inactive", async () => {
    const started = await begin();
    await db.query("DELETE FROM test_active_members WHERE user_id=$1", [owner]);
    await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
    try {
      await expect(
        call(fileUpload, {
          action: "resume",
          company_id: companies[0],
          job_number: "SYN-1",
          upload_id: started.result.structuredContent.upload_id,
        }),
      ).rejects.toThrow();
    } finally {
      await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
      await db.query("DELETE FROM mcp_gate_cache WHERE user_id=$1", [owner]);
    }
  });

  it("bounds pending recovery with a caller-owned cursor", async () => {
    for (let index = 0; index < 27; index++) await begin();
    const first = await call(fileUpload, {
      action: "pending",
      company_id: companies[0],
      job_number: "SYN-1",
    });
    expect(first.structuredContent.pending_uploads).toHaveLength(25);
    expect(first.structuredContent.pending_next_before).toBeTruthy();
    const next = await call(fileUpload, {
      action: "pending",
      company_id: companies[0],
      job_number: "SYN-1",
      before_upload: first.structuredContent.pending_next_before,
    });
    const firstIds = first.structuredContent.pending_uploads.map((u: any) => u.upload_id);
    expect(next.structuredContent.pending_uploads.length).toBeGreaterThan(0);
    expect(
      next.structuredContent.pending_uploads.every((u: any) => !firstIds.includes(u.upload_id)),
    ).toBe(true);
  });

  it("disables card mutations if the host has not granted server tools", async () => {
    const started = await begin();
    const v = uploadCard({ dispatch, fetch: put, serverTools: false });
    views.push(v);
    v.result(started.result);
    expect(v.calls).toEqual([]);
    expect(() => v.click("Add file to job")).toThrow("Button unavailable");
    expect(v.app.textContent).toContain("cannot run upload controls");
    v.close();
  });

  it("exposes no token, path, other-member rows, or direct table grants in recovery", async () => {
    const result = await call(fileUpload, {
      action: "pending",
      job_number: "SYN-1",
      company_id: companies[0],
    });
    expect(JSON.stringify(result.structuredContent.pending_uploads)).not.toMatch(
      /token_hash|storage_path|created_by/,
    );
    expect(
      (
        await db.query<any>(
          "SELECT has_table_privilege('authenticated','public.mcp_file_uploads','SELECT') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
    expect(
      (
        await db.query<any>(
          "SELECT has_function_privilege('anon','public.mcp_file_upload_recovery(uuid,uuid,uuid,integer)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
    await expect(
      asUser(db, { ...claims, sub: outsider }, (tx) =>
        tx.query("SELECT mcp_file_upload_recovery($1)", [jobs[0]]),
      ),
    ).rejects.toThrow(/cannot recover/);
  });
});
