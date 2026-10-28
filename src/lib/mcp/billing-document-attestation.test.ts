import { afterEach, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mock.createClient }));
import {
  registerVerifiedBillingOriginal,
  linkVerifiedBillingOriginal,
  recordWithVerifiedBillingOriginal,
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
