import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ read: vi.fn(), readCost: vi.fn(), user: vi.fn() }));
vi.mock("./mcp/supabase", () => ({ supabaseForToken: mock.user }));
vi.mock("./mcp/billing-original.server", () => ({
  readVerifiedFinancialOriginal: mock.read,
  readVerifiedCostReceipt: mock.readCost,
}));
import { handleBillingOriginalDownload } from "./billing-original-route.server";
import { FileRejected } from "./mcp/file-share";
const job = "00000000-0000-4000-8000-000000000001";
const doc = "00000000-0000-4000-8000-000000000002";
const cost = "00000000-0000-4000-8000-000000000003";
const url = `https://app.meetathena.io/api/billing-original?job=${job}&document=${doc}`;
afterEach(() => vi.resetAllMocks());
it("requires a member token and valid project and document IDs", async () => {
  expect((await handleBillingOriginalDownload(new Request(url))).status).toBe(401);
  expect(
    (
      await handleBillingOriginalDownload(
        new Request("https://app.meetathena.io/api/billing-original?job=bad", {
          headers: { authorization: "Bearer fake" },
        }),
      )
    ).status,
  ).toBe(404);
  expect(mock.read).not.toHaveBeenCalled();
});
it("routes an exact cost receipt through its scoped check and never falls back to billing access", async () => {
  const sb = {};
  mock.user.mockReturnValue(sb);
  mock.readCost.mockResolvedValueOnce({ bytes: new Uint8Array([1, 2, 3]) });
  const headers = { authorization: "Bearer fake" };
  expect(
    (await handleBillingOriginalDownload(new Request(`${url}&cost_record=${cost}`, { headers })))
      .status,
  ).toBe(200);
  expect(mock.readCost).toHaveBeenCalledWith(sb, "fake", job, cost, doc);
  expect(mock.read).not.toHaveBeenCalled();
  expect(
    (await handleBillingOriginalDownload(new Request(`${url}&cost_record=invalid`, { headers })))
      .status,
  ).toBe(404);
  mock.readCost.mockRejectedValueOnce(new Error("not own record"));
  expect(
    (await handleBillingOriginalDownload(new Request(`${url}&cost_record=${cost}`, { headers })))
      .status,
  ).toBe(404);
  expect(mock.read).not.toHaveBeenCalled();
});
it("returns only verified bytes as a private attachment and fails closed", async () => {
  const sb = {};
  mock.user.mockReturnValue(sb);
  mock.read.mockResolvedValueOnce({ bytes: new Uint8Array([1, 2, 3]) });
  const req = () => new Request(url, { headers: { authorization: "Bearer fake" } });
  const result = await handleBillingOriginalDownload(req());
  expect(result.status).toBe(200);
  expect(result.headers.get("content-type")).toBe("application/octet-stream");
  expect(result.headers.get("content-disposition")).toBe("attachment");
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(mock.read).toHaveBeenCalledWith(sb, "fake", job, doc);
  mock.read.mockRejectedValueOnce(new Error("wrong job"));
  expect((await handleBillingOriginalDownload(req())).status).toBe(404);
  mock.read.mockRejectedValueOnce(new FileRejected("That file is over 10 MB. Nothing was stored."));
  const tooLarge = await handleBillingOriginalDownload(req());
  expect(tooLarge.status).toBe(413);
  expect(await tooLarge.text()).toContain("10 MiB");
});
