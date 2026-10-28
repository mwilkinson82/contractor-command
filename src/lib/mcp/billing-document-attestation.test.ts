import { afterEach, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";
import type { Sb } from "./guard";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mock.createClient }));
import { registerVerifiedBillingOriginal } from "./billing-document-attestation.server";

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
