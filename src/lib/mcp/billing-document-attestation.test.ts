import { afterEach, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mock.createClient }));
const readMock = vi.hoisted(() => vi.fn());
vi.mock("./billing-original.server", () => ({ readBoundedFinancialStoragePath: readMock }));
import {
  registerVerifiedBillingOriginal,
  linkVerifiedBillingOriginal,
  recordWithVerifiedBillingOriginal,
  reserveBillingMemberUpload,
} from "./billing-document-attestation.server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("attests only after resolving the member from the supplied verified token", async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "actor" } }, error: null });
  mock.createClient.mockReturnValue({ rpc: mock.rpc });
  mock.rpc.mockResolvedValue({ data: { id: "upload", already_stored: false }, error: null });
  await registerVerifiedBillingOriginal(
    { auth: { getUser } } as unknown as Sb,
    { getToken: () => "member-token" } as ToolContext,
    "job",
    "upload",
    4,
    "a".repeat(64),
  );
  expect(getUser).toHaveBeenCalledWith("member-token");
  expect(mock.rpc).toHaveBeenCalledWith(
    "mcp_billing_document_register",
    expect.objectContaining({
      _job: "job",
      _id: "upload",
      _actor: "actor",
      _size: 4,
      _sha256: "a".repeat(64),
    }),
  );
});

it("fails closed on invalid identity or unavailable server credentials", async () => {
  const ctx = { getToken: () => "member-token" } as ToolContext;
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
  const sb = { auth: { getUser } } as unknown as Sb;
  await expect(
    registerVerifiedBillingOriginal(sb, ctx, "job", "upload", 4, "a".repeat(64)),
  ).rejects.toThrow(/Verified member/);
  expect(mock.createClient).not.toHaveBeenCalled();
  getUser.mockResolvedValue({ data: { user: { id: "actor" } }, error: null });
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  await expect(
    registerVerifiedBillingOriginal(sb, ctx, "job", "upload", 4, "a".repeat(64)),
  ).rejects.toThrow(/temporarily unavailable/);
  expect(mock.createClient).not.toHaveBeenCalled();
});

it("links only for the actor resolved from the verified member token", async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "actor" } }, error: null });
  mock.createClient.mockReturnValue({ rpc: mock.rpc });
  mock.rpc.mockResolvedValue({ data: { already_linked: false }, error: null });
  await linkVerifiedBillingOriginal(
    { auth: { getUser } } as unknown as Sb,
    { getToken: () => "member-token" } as ToolContext,
    "job",
    "doc",
    "invoice",
    1,
    null,
  );
  expect(getUser).toHaveBeenCalledWith("member-token");
  expect(mock.rpc).toHaveBeenCalledWith(
    "mcp_billing_document_link",
    expect.objectContaining({
      _job: "job",
      _document: "doc",
      _invoice: "invoice",
      _version: 1,
      _receipt: null,
      _actor: "actor",
    }),
  );
});

it("records with a document only for the verified token actor", async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "actor" } }, error: null });
  mock.createClient.mockReturnValue({ rpc: mock.rpc });
  mock.rpc.mockResolvedValue({ data: { id: "invoice" }, error: null });
  await recordWithVerifiedBillingOriginal(
    { auth: { getUser } } as unknown as Sb,
    { getToken: () => "member-token" } as ToolContext,
    "job",
    "invoice",
    { document_id: "doc" },
  );
  expect(mock.rpc).toHaveBeenCalledWith(
    "mcp_billing_record_document",
    expect.objectContaining({
      _job: "job",
      _action: "invoice",
      _p: { document_id: "doc" },
      _actor: "actor",
    }),
  );
});

it("reserves the verified member's upload path and validates bytes before server-only storage", async () => {
  vi.stubEnv("SUPABASE_URL", "https://example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "actor" } }, error: null });
  const upload = {
    id: "document",
    job_id: "job",
    company_id: "company",
    filename: "file.pdf",
    mime_type: "application/pdf",
    storage_path: "company/job/document/file.pdf",
  };
  const put = vi.fn().mockResolvedValue({ error: null });
  mock.createClient.mockReturnValue({ rpc: mock.rpc, storage: { from: () => ({ upload: put }) } });
  mock.rpc.mockResolvedValue({ data: { ...upload, status: "open" }, error: null });
  const write = await reserveBillingMemberUpload(
    { auth: { getUser } } as unknown as Sb,
    { getToken: () => "member-token" } as ToolContext,
    upload,
  );
  expect(mock.rpc).toHaveBeenCalledWith("mcp_billing_upload_claim", {
    _id: "document",
    _actor: "actor",
    _token_hash: null,
  });
  await expect(write(new TextEncoder().encode("not a PDF"))).rejects.toThrow(/real/);
  expect(put).not.toHaveBeenCalled();
  await write(new TextEncoder().encode("%PDF-1.7 synthetic"));
  expect(put).toHaveBeenCalledWith(upload.storage_path, expect.any(Uint8Array), {
    contentType: "application/pdf",
    upsert: false,
  });
  put.mockClear();
  const bytes = new TextEncoder().encode("%PDF-1.7 synthetic");
  readMock.mockResolvedValue(bytes);
  mock.createClient.mockReturnValue({ rpc: mock.rpc, storage: { from: () => ({ upload: put }) } });
  mock.rpc.mockResolvedValue({ data: { ...upload, status: "finished" }, error: null });
  const completed = await reserveBillingMemberUpload(
    { auth: { getUser } } as unknown as Sb,
    { getToken: () => "member-token" } as ToolContext,
    upload,
  );
  await completed(bytes);
  expect(put).not.toHaveBeenCalled();
  readMock.mockRejectedValue(new Error("original unavailable"));
  await expect(completed(bytes)).rejects.toThrow(/original unavailable/);
  expect(put).not.toHaveBeenCalled();
  mock.rpc.mockResolvedValue({ data: { ...upload, job_id: "other" }, error: null });
  await expect(
    reserveBillingMemberUpload(
      { auth: { getUser } } as unknown as Sb,
      { getToken: () => "member-token" } as ToolContext,
      upload,
    ),
  ).rejects.toThrow(/not available/);
});
