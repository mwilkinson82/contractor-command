import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ read: vi.fn(), apRead: vi.fn(), user: vi.fn() }));
vi.mock("./mcp/supabase", () => ({ supabaseForToken: mock.user }));
vi.mock("./mcp/billing-original.server", () => ({ readVerifiedFinancialOriginal: mock.read }));
vi.mock("./mcp/ap-original.server", () => ({ readApOriginalForToken: mock.apRead }));
import { handleBillingOriginalDownload } from "./billing-original-route.server";
import { FileRejected } from "./mcp/file-share";
const job = "00000000-0000-4000-8000-000000000001";
const doc = "00000000-0000-4000-8000-000000000002";
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

it("keeps supplier-original downloads on the existing AP authorization and exact-version read", async () => {
  const bill = "00000000-0000-4000-8000-000000000003";
  const sb = {};
  mock.user.mockReturnValue(sb);
  mock.apRead.mockResolvedValueOnce({ bytes: new Uint8Array([1, 2]) });
  const request = (suffix: string) =>
    new Request(url + suffix, { headers: { authorization: "Bearer member" } });
  expect(
    (await handleBillingOriginalDownload(request(`&ap_record=${bill}&version=2`))).status,
  ).toBe(200);
  expect(mock.apRead).toHaveBeenCalledWith(sb, "member", job, bill, doc, 2);
  mock.apRead.mockRejectedValueOnce(new Error("role, version or allocated job unavailable"));
  expect(
    (await handleBillingOriginalDownload(request(`&ap_record=${bill}&version=2`))).status,
  ).toBe(404);
  expect((await handleBillingOriginalDownload(request(`&ap_record=${bill}`))).status).toBe(404);
  expect(
    (
      await handleBillingOriginalDownload(
        request(`&ap_record=${bill}&version=2&cost_record=${bill}`),
      )
    ).status,
  ).toBe(404);
  expect(mock.read).not.toHaveBeenCalled();
});
