import { beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
const mocks = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/resend/capture", () => ({ upsertResendCapture: mocks.capture }));
import { Route } from "@/routes/api/public/resend/capture";
const handler = (
  Route as unknown as {
    server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } };
  }
).server.handlers.POST;
beforeEach(() => {
  mocks.capture
    .mockReset()
    .mockResolvedValue({ ok: true, contactId: "synthetic", segment: "field_notes" });
});
describe("public capture membership protection", () => {
  it("rejects a forged Circle segment before any provider call", async () => {
    const response = await handler({
      request: new Request("https://example.test/api/public/resend/capture", {
        method: "POST",
        body: JSON.stringify({ email: "fake@example.test", segment: "circle", source: "stripe" }),
      }),
    });
    expect(response.status).toBe(400);
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it("keeps the existing Field Notes signup working", async () => {
    const response = await handler({
      request: new Request("https://example.test/api/public/resend/capture", {
        method: "POST",
        body: JSON.stringify({ email: "new@example.test" }),
      }),
    });
    expect(response.status).toBe(200);
    expect(mocks.capture).toHaveBeenCalledOnce();
  });
});
