import { beforeEach, afterEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: state.rpc }) }));
import { fileResolver, openShare } from "./file-share-route.server";
import { newToken } from "./mcp/file-share";
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://storage.example.com");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "fictional-public-key");
  state.rpc.mockImplementation(async () => ({ data: state.row, error: null }));
  state.row = {
    filename: "submittal.pdf",
    mime_type: "application/pdf",
    size_bytes: 9,
    package_path: "company/job/packages/id/submittal.pdf",
    signed_url:
      "https://storage.example.com/storage/v1/object/sign/athena-submittals/company/job/packages/id/submittal.pdf?token=fixture",
  };
});
afterEach(() => vi.unstubAllEnvs());
it("streams only the exact package storage object without exposing its signed URL", async () => {
  const fetcher = vi.fn(async () => new Response("%PDF-1.7"));
  const response = await openShare(
    newToken(),
    "GET",
    fileResolver("mcp_submittal_preview_open"),
    fetcher as unknown as typeof fetch,
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("%PDF-1.7");
  expect(JSON.stringify([...response.headers])).not.toContain("token=fixture");
  expect(state.rpc).toHaveBeenCalledWith(
    "mcp_submittal_preview_open",
    expect.objectContaining({ _count: true }),
  );
});
it.each([
  "https://evil.example.com/storage/v1/object/sign/athena-submittals/company/job/packages/id/submittal.pdf?token=fixture",
  "http://169.254.169.254/latest/meta-data",
  "https://storage.example.com/storage/v1/object/sign/athena-submittals/company/other/packages/id/secret.pdf?token=fixture",
])("refuses a forged package origin or path: %s", async (signed_url) => {
  state.row!.signed_url = signed_url;
  const fetcher = vi.fn();
  const response = await openShare(
    newToken(),
    "GET",
    fileResolver("mcp_submittal_preview_open"),
    fetcher,
  );
  expect(response.status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled();
});
it("expired private preview returns gone and never fetches", async () => {
  state.row = null;
  const fetcher = vi.fn();
  expect(
    (await openShare(newToken(), "GET", fileResolver("mcp_submittal_preview_open"), fetcher))
      .status,
  ).toBe(410);
  expect(fetcher).not.toHaveBeenCalled();
});
