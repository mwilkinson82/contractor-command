import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { jsPDF } from "jspdf";
import type { PGlite } from "@electric-sql/pglite";
import { makeDb } from "../../../tests/mcp-roles/db";
import { asUser } from "../../../tests/mcp-roles/fake-supabase";

const state = vi.hoisted(() => ({
  sb: null as unknown,
  job: {
    job_id: "00000000-0000-4000-8000-000000000115",
    company_id: "00000000-0000-4000-8000-000000000114",
    job_number: "SYN-A",
    name: "Synthetic A",
    scope: "full",
  },
}));
vi.mock("./guard", () => ({
  run: async (_n: string, _c: unknown, _o: unknown, f: (sb: unknown) => unknown) => f(state.sb),
  text: (s: string) => ({ content: [{ type: "text", text: s }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
vi.mock("./jobs", () => ({ resolveJob: async () => state.job }));
vi.mock("./billing-original.server", () => ({
  readUploadedFinancialOriginal: async (_sb: unknown, _token: string, job: string, id: string) => {
    const item = (await query("SELECT public.mcp_billing_upload_get($1,$2) AS value", [job, id]))[0]
      .value as { storage_path: string } | null;
    const bytes = item && objects.get(`athena-financial-documents/${item.storage_path}`);
    if (!bytes) throw new Error("The original is unavailable.");
    return bytes;
  },
  readVerifiedFinancialOriginal: async (_sb: unknown, _token: string, job: string, id: string) => {
    const data = (await query("SELECT public.mcp_billing_documents_get($1) AS value", [job]))[0]
      .value as {
      documents: Array<{ id: string; storage_path: string; sha256: string; size_bytes: number }>;
    };
    const document = data.documents.find((d) => d.id === id);
    const bytes = document && objects.get(`athena-financial-documents/${document.storage_path}`);
    if (!document || !bytes) throw new Error("The original is unavailable.");
    if (bytes.length !== document.size_bytes || (await sha256Hex(bytes)) !== document.sha256)
      throw new Error("The original does not match its recorded fingerprint.");
    return { document, bytes };
  },
}));
vi.mock("./billing-document-attestation.server", () => ({
  reserveBillingMemberUpload: async (
    _sb: unknown,
    _ctx: unknown,
    upload: { id: string; storage_path: string },
  ) => {
    await asUser(
      db,
      { sub: owner, email: "synthetic@example.test", role: "service_role" },
      async (tx) =>
        tx.query("SELECT public.mcp_billing_upload_claim($1,$2,$3)", [upload.id, owner, null]),
    );
    return async (bytes: Uint8Array) => {
      const key = `athena-financial-documents/${upload.storage_path}`;
      const previous = objects.get(key);
      if (previous) {
        if (
          previous.length !== bytes.length ||
          (await sha256Hex(previous)) !== (await sha256Hex(bytes))
        )
          throw new Error("The stored original differs from this file.");
      } else {
        objects.set(key, bytes);
        await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)", [
          "athena-financial-documents",
          upload.storage_path,
        ]);
      }
    };
  },
  recordWithVerifiedBillingOriginal: async (
    _sb: unknown,
    _ctx: unknown,
    job: string,
    action: string,
    payload: unknown,
  ) =>
    asUser(
      db,
      { sub: owner, email: "synthetic@example.test", role: "service_role" },
      async (tx) =>
        (
          await tx.query("SELECT public.mcp_billing_record_document($1,$2,$3,$4) AS value", [
            job,
            action,
            JSON.stringify(payload),
            owner,
          ])
        ).rows[0].value,
    ),
  linkVerifiedBillingOriginal: async (
    _sb: unknown,
    _ctx: unknown,
    job: string,
    doc: string,
    invoice: string | null,
    version: number | null,
    receipt: string | null,
  ) =>
    asUser(
      db,
      { sub: owner, email: "synthetic@example.test", role: "service_role" },
      async (tx) =>
        (
          await tx.query("SELECT public.mcp_billing_document_link($1,$2,$3,$4,$5,$6) AS value", [
            job,
            doc,
            invoice,
            version,
            receipt,
            owner,
          ])
        ).rows[0].value,
    ),
  registerVerifiedBillingOriginal: async (
    _sb: unknown,
    _ctx: unknown,
    job: string,
    id: string,
    size: number,
    hash: string,
  ) =>
    asUser(
      db,
      { sub: owner, email: "synthetic@example.test", role: "service_role" },
      async (tx) =>
        (
          await tx.query("SELECT public.mcp_billing_document_register($1,$2,$3,$4,$5) AS value", [
            job,
            id,
            size,
            hash,
            owner,
          ])
        ).rows[0].value,
    ),
}));
import {
  billingDocumentUpload,
  billingDocuments,
  billingDocumentLink,
} from "./tools/billing-document-tools";
import { billingEvidenceRecord, billingEvidenceRead } from "./tools/billing-evidence-tools";
import { handleFileUpload } from "../file-upload-route.server";
import { sha256Hex } from "./file-share";
import { assertUploadBytes, extractUploadDocument } from "./file-upload";

const owner = "00000000-0000-4000-8000-000000000111";
let db: PGlite;
const objects = new Map<string, Uint8Array>();
const query = (sql: string, args: unknown[] = []) =>
  asUser(
    db,
    { sub: owner, email: "synthetic@example.test", role: "authenticated" },
    async (tx) => (await tx.query(sql, args)).rows as Record<string, unknown>[],
  );
type Reply = { content: Array<{ text: string }>; structuredContent: Record<string, unknown> };
const call = (tool: unknown, args: Record<string, unknown>) =>
  (tool as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }).handler(args, {
    getToken: () => "synthetic-token",
  });
const context = { job_number: "SYN-A" };

beforeAll(async () => {
  db = await makeDb();
  await db.exec(
    "CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated,service_role; GRANT SELECT,INSERT ON storage.objects TO authenticated,service_role; CREATE TABLE mcp_submittals(id uuid PRIMARY KEY,job_id uuid,number text,revision integer); CREATE TABLE mcp_change_orders(submittal_id uuid PRIMARY KEY,job_id uuid,details jsonb);",
  );
  await db.exec(
    "INSERT INTO storage.buckets(id,name,public) VALUES ('athena-financial-documents','athena-financial-documents',false)",
  );
  for (const f of [
    "20261020213000_athena_living_reports.sql",
    "20261031120000_athena_file_upload.sql",
    "20261101120001_athena_project_billing_evidence.sql",
    "20261101120002_athena_financial_documents.sql",
  ])
    await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'synthetic@example.test')", [owner]);
  await db.query("INSERT INTO test_active_members VALUES($1)", [owner]);
  await db.query("INSERT INTO mcp_companies(id,name,created_by) VALUES($1,'Synthetic',$2)", [
    state.job.company_id,
    owner,
  ]);
  await db.query(
    "INSERT INTO mcp_company_members(company_id,user_id,role,display_name) VALUES($1,$2,'owner','Synthetic')",
    [state.job.company_id, owner],
  );
  await db.query(
    "INSERT INTO mcp_jobs(id,user_id,company_id,job_number,name) VALUES($1,$2,$3,'SYN-A','Synthetic A')",
    [state.job.job_id, owner, state.job.company_id],
  );
  await db.query(
    "INSERT INTO mcp_living_reports(job_id,report_type,version,data,change_what,updated_by) VALUES($1,'billing_forecast',1,$2::jsonb,'Synthetic forecast',$3)",
    [
      state.job.job_id,
      JSON.stringify({
        billing: {
          earned_from_dailies: 12345,
          months: [{ month: "2026-10", amount: 6789, kind: "forecast" }],
        },
      }),
      owner,
    ],
  );
  state.sb = {
    rpc: async (name: string, values: Record<string, unknown>) => {
      const args = Object.values(values).map((v) =>
        v && typeof v === "object" ? JSON.stringify(v) : v,
      );
      try {
        return {
          data: (
            await query(
              `SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) AS value`,
              args,
            )
          )[0].value,
          error: null,
        };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array) => {
          if (objects.has(`${bucket}/${path}`)) return { error: { message: "already exists" } };
          objects.set(`${bucket}/${path}`, bytes);
          await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES($1,$2)", [
            bucket,
            path,
          ]);
          return { error: null };
        },
        download: async (path: string) => {
          const b = objects.get(`${bucket}/${path}`);
          return b
            ? { data: new Blob([b as BlobPart]), error: null }
            : { data: null, error: { message: "missing" } };
        },
      }),
    },
  };
}, 30000);
afterAll(async () => {
  await db.close();
});

describe("guided billing workflow with a synthetic original", () => {
  it("stores image types only for financial documents without pretending to read them", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    expect(assertUploadBytes(png, "receipt.png", "financial_document").mime).toBe("image/png");
    expect(() => assertUploadBytes(png, "receipt.png", "contract")).toThrow();
    expect((await extractUploadDocument(png, "png")).text).toBe("");
  });
  it("limits financial-document expansion and PDF extraction", async () => {
    const name = Buffer.from("word/document.xml");
    const compressed = deflateRawSync(Buffer.alloc(16 * 1024 * 1024 + 1, 65));
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt16LE(name.length, 26);
    const oversizedExpanded = new Uint8Array(Buffer.concat([header, name, compressed]));
    expect(() =>
      assertUploadBytes(oversizedExpanded, "receipt.docx", "financial_document"),
    ).toThrow();
    const pdf = new jsPDF();
    for (let i = 1; i < 101; i++) pdf.addPage();
    const result = await extractUploadDocument(
      new Uint8Array(pdf.output("arraybuffer")),
      "pdf",
      "financial_document",
    );
    expect(result.text).toBe("");
  });
  it("reuses the same attached-file upload safely and refuses unapproved hosts or changed bytes", async () => {
    const pdf = new jsPDF();
    pdf.text("Synthetic receipt", 10, 20);
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    const started = await call(billingDocumentUpload, {
      ...context,
      action: "begin",
      filename: "receipt.pdf",
    });
    const upload_id = started.structuredContent.upload_id;
    const fetchMock = vi.fn(async () => new Response(bytes as BodyInit));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const file = {
        file_id: "synthetic",
        file_name: "receipt.pdf",
        download_url: "https://files.oaiusercontent.com/synthetic",
      };
      const rejected = await call(billingDocumentUpload, {
        ...context,
        action: "begin",
        filename: "untrusted.pdf",
      });
      await expect(
        call(billingDocumentUpload, {
          ...context,
          action: "attached_file",
          upload_id: rejected.structuredContent.upload_id,
          file: { ...file, download_url: "https://unapproved.example/synthetic" },
        }),
      ).rejects.toThrow(/can't fetch/i);
      expect(fetchMock).not.toHaveBeenCalled();
      const first = await call(billingDocumentUpload, {
        ...context,
        action: "attached_file",
        upload_id,
        file,
      });
      const second = await call(billingDocumentUpload, {
        ...context,
        action: "attached_file",
        upload_id,
        file,
      });
      expect(second.structuredContent.document_id).toBe(first.structuredContent.document_id);
      expect(second.structuredContent.already_stored).toBe(true);
      fetchMock.mockImplementation(
        async () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x20]) as BodyInit),
      );
      await expect(
        call(billingDocumentUpload, { ...context, action: "attached_file", upload_id, file }),
      ).rejects.toThrow(/differs/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("extracts a PDF, reviews and confirms each save, then shows the distinct invoice balance", async () => {
    const pdf = new jsPDF();
    pdf.text("Invoice SYN-1 Gross $1000 Retainage $100 Net due $900", 10, 20);
    const bytes = new Uint8Array(pdf.output("arraybuffer"));
    const started = await call(billingDocumentUpload, {
      ...context,
      action: "begin",
      filename: "invoice.pdf",
    });
    const uploadId = started.structuredContent.upload_id as string;
    const token = (started.structuredContent.upload_url as string).split("/").pop()!;
    const uploaded = await call(
      (await import("./tools/billing-document-tools")).billingDocumentUpload,
      { ...context, action: "finish", upload_id: uploadId },
    ).catch(() => null);
    expect(uploaded).toBeNull();
    const session = (
      await query("SELECT public.mcp_billing_upload_get($1,$2) AS value", [
        state.job.job_id,
        uploadId,
      ])
    )[0].value as Record<string, string>;
    const response = await handleFileUpload(
      new Request("https://app.meetathena.io/r/file-upload/x", {
        method: "PUT",
        body: bytes as BodyInit,
      }),
      token,
      {
        lookup: async () =>
          ({
            ...session,
            purpose: "financial_document",
            bucket: "athena-financial-documents",
          }) as never,
        claimFinancial: async () => {},
        put: async (bucket, path, data) => {
          await (
            state.sb as {
              storage: {
                from: (s: string) => { upload: (p: string, b: Uint8Array) => Promise<unknown> };
              };
            }
          ).storage
            .from(bucket)
            .upload(path, data);
        },
      },
    );
    expect(response.status).toBe(200);
    const finished = await call(billingDocumentUpload, {
      ...context,
      action: "finish",
      upload_id: uploadId,
    });
    expect(finished.structuredContent.sha256).toBe(await sha256Hex(bytes));
    expect(finished.structuredContent.readable_text).toContain("Gross $1000");
    expect(finished.structuredContent.readable_text).toContain("[[PDF page 1]]");
    const invoice = {
      kind: "invoice",
      document_number: "SYN-1",
      status: "submitted",
      invoice_date: "2026-10-01",
      effective_date: "2026-10-01",
      source: "synthetic PDF",
      gross_cents: 100000,
      withheld_cents: 10000,
      released_cents: 0,
      net_due_cents: 90000,
      document_id: uploadId,
    };
    async function confirm(action: string, facts: Record<string, unknown>) {
      const review = await call(billingEvidenceRecord, {
        ...context,
        step: "review",
        action,
        facts,
      });
      expect(review.structuredContent.saved).toBe(false);
      const p = review.structuredContent.facts as Record<string, unknown>;
      const key = review.structuredContent.review_key;
      await expect(
        call(billingEvidenceRecord, {
          ...context,
          step: "save",
          action,
          facts: p,
          review_key: key,
        }),
      ).rejects.toThrow(/confirm/i);
      const saved = await call(billingEvidenceRecord, {
        ...context,
        step: "save",
        action,
        facts: p,
        review_key: key,
        confirmed: true,
      });
      expect(saved.structuredContent.saved).toBe(true);
      return { p, key, saved };
    }
    const inv = await confirm("invoice", invoice);
    expect(inv.p.id).toBeTruthy();
    const retry = await call(billingEvidenceRecord, {
      ...context,
      step: "save",
      action: "invoice",
      facts: inv.p,
      review_key: inv.key,
      confirmed: true,
    });
    expect(retry.structuredContent.result).toMatchObject({ already_applied: true });
    await expect(
      call(billingEvidenceRecord, {
        ...context,
        step: "save",
        action: "invoice",
        facts: { ...inv.p, net_due_cents: 1 },
        review_key: inv.key,
        confirmed: true,
      }),
    ).rejects.toThrow(/review/i);
    const receipt = await confirm("receipt", {
      receipt_date: "2026-10-02",
      source: "synthetic receipt",
      amount_cents: 40000,
    });
    await confirm("allocation", {
      receipt_id: receipt.p.id,
      invoice_id: inv.p.id,
      amount_cents: 40000,
      effective_date: "2026-10-02",
      source: "synthetic allocation",
    });
    await confirm("invoice", {
      kind: "credit",
      document_number: "SYN-C1",
      status: "posted",
      invoice_date: "2026-10-03",
      effective_date: "2026-10-03",
      source: "synthetic credit",
      net_due_cents: 10000,
      credit_for: inv.p.id,
    });
    const read = await call(billingEvidenceRead, context);
    const recordLinks = read.structuredContent.record_links as Array<{
      target: { id: string; kind: string; version?: number };
      url: string;
    }>;
    expect(
      recordLinks.some(
        (l) =>
          l.target.id === inv.p.id &&
          l.target.version === 1 &&
          l.url.includes("record_kind=invoice"),
      ),
    ).toBe(true);
    expect(
      recordLinks.some((l) => l.target.id === receipt.p.id && l.target.kind === "receipt"),
    ).toBe(true);
    expect(recordLinks.some((l) => l.target.kind === "allocation")).toBe(true);
    expect(recordLinks.some((l) => l.target.kind === "credit")).toBe(true);
    expect(read.structuredContent.balances).toMatchObject([
      {
        document_number: "SYN-1",
        cash_cents: 40000,
        credits_cents: 10000,
        remaining_cents: 40000,
        remaining_display: "$400.00",
      },
    ]);
    const beforeForecast = (
      await db.query<{ data: unknown }>(
        "SELECT data FROM mcp_living_reports WHERE job_id=$1 AND report_type='billing_forecast'",
        [state.job.job_id],
      )
    ).rows[0].data;
    expect(beforeForecast).toEqual({
      billing: {
        earned_from_dailies: 12345,
        months: [{ month: "2026-10", amount: 6789, kind: "forecast" }],
      },
    });
    await db.query(
      "UPDATE mcp_living_reports SET data=jsonb_set(data,'{billing,earned_from_dailies}','98765'::jsonb) WHERE job_id=$1 AND report_type='billing_forecast'",
      [state.job.job_id],
    );
    const afterProgress = await call(billingEvidenceRead, context);
    expect(afterProgress.structuredContent.balances).toEqual(read.structuredContent.balances);
    const docs = (
      await query("SELECT public.mcp_billing_documents_get($1) AS value", [state.job.job_id])
    )[0].value as { links: unknown[] };
    expect(docs.links).toHaveLength(1);
    const linkArgs = { ...context, document_id: uploadId, receipt_id: receipt.p.id };
    const linkReview = await call(billingDocumentLink, { ...linkArgs, step: "review" });
    expect(linkReview.structuredContent.linked).toBe(false);
    expect(linkReview.content[0].text).toContain("Nothing has been linked yet");
    const linkKey = linkReview.structuredContent.review_key;
    await expect(
      call(billingDocumentLink, { ...linkArgs, step: "save", review_key: linkKey }),
    ).rejects.toThrow(/confirm/i);
    await expect(
      call(billingDocumentLink, {
        ...linkArgs,
        receipt_id: crypto.randomUUID(),
        step: "save",
        review_key: linkKey,
        confirmed: true,
      }),
    ).rejects.toThrow(/not available/i);
    const linked = await call(billingDocumentLink, {
      ...linkArgs,
      step: "save",
      review_key: linkKey,
      confirmed: true,
    });
    expect(linked.structuredContent).toMatchObject({ linked: true, already_linked: false });
    expect(
      (
        await call(billingDocumentLink, {
          ...linkArgs,
          step: "save",
          review_key: linkKey,
          confirmed: true,
        })
      ).structuredContent.already_linked,
    ).toBe(true);
    expect((await call(billingEvidenceRead, context)).structuredContent.balances).toEqual(
      read.structuredContent.balances,
    );
    const reread = await call(billingDocuments, {
      ...context,
      action: "read",
      document_id: uploadId,
      text_offset: 0,
    });
    expect(reread.structuredContent.readable_text).toContain("Gross $1000");
    expect(reread.structuredContent.sha256).toBe(await sha256Hex(bytes));
    const key = `athena-financial-documents/${session.storage_path}`;
    objects.set(key, new Uint8Array([1, 2, 3]));
    await expect(
      call(billingDocuments, { ...context, action: "read", document_id: uploadId, text_offset: 0 }),
    ).rejects.toThrow(/fingerprint/);
    await expect(call(billingDocumentLink, { ...linkArgs, step: "review" })).rejects.toThrow(
      /fingerprint/,
    );
    await expect(
      call(billingDocumentLink, {
        ...linkArgs,
        step: "save",
        review_key: linkKey,
        confirmed: true,
      }),
    ).rejects.toThrow(/fingerprint/);
    await expect(
      call(billingEvidenceRecord, {
        ...context,
        step: "review",
        action: "invoice",
        facts: { ...invoice, document_number: "SYN-TAMPER" },
      }),
    ).rejects.toThrow(/fingerprint/);
    objects.set(key, bytes);
  }, 30000);
  it("retains and links a synthetic XLSX original without importing formulas or changing the ledger", async () => {
    const bytes = new Uint8Array(readFileSync("tests/fixtures/synthetic-estimate.xlsx"));
    const started = await call(billingDocumentUpload, {
      ...context,
      action: "begin",
      filename: "synthetic-estimate.xlsx",
    });
    const uploadId = started.structuredContent.upload_id as string;
    const session = (
      await query("SELECT public.mcp_billing_upload_get($1,$2) AS value", [
        state.job.job_id,
        uploadId,
      ])
    )[0].value as { storage_path: string };
    await (
      state.sb as {
        storage: {
          from: (bucket: string) => {
            upload: (path: string, bytes: Uint8Array) => Promise<unknown>;
          };
        };
      }
    ).storage
      .from("athena-financial-documents")
      .upload(session.storage_path, bytes);
    const uploaded = await call(billingDocumentUpload, {
      ...context,
      action: "finish",
      upload_id: uploadId,
    });
    expect(uploaded.structuredContent.readable_text).toBeNull();
    expect(uploaded.structuredContent.sha256).toBe(await sha256Hex(bytes));
    expect(uploaded.content[0].text).toContain("not extracted or imported");
    const before = await call(billingEvidenceRead, context);
    const receipts = before.structuredContent.receipts as Array<{ id: string; source: string }>;
    const receipt = receipts.find((r) => r.source === "synthetic receipt");
    expect(receipt).toBeDefined();
    const args = { ...context, document_id: uploadId, receipt_id: receipt!.id };
    const review = await call(billingDocumentLink, { ...args, step: "review" });
    const linked = await call(billingDocumentLink, {
      ...args,
      step: "save",
      confirmed: true,
      review_key: review.structuredContent.review_key,
    });
    expect(linked.structuredContent.linked).toBe(true);
    const verified = await call(billingDocuments, {
      ...context,
      action: "read",
      document_id: uploadId,
    });
    expect(verified.structuredContent.sha256).toBe(await sha256Hex(bytes));
    expect(verified.structuredContent.readable_text).toBeNull();
    const after = await call(billingEvidenceRead, context);
    expect(after.structuredContent.balances).toEqual(before.structuredContent.balances);
    expect(after.structuredContent.receipts).toEqual(before.structuredContent.receipts);
  }, 30000);
});
