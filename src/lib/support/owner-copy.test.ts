import { describe, expect, it } from "vitest";
import { ownerCopy } from "./owner-copy.ts";
import { routeSupport } from "./conversation.ts";
import { isSupportAutoreplyLive, SUPPORT_INBOXES } from "./ticket.ts";
describe("owner evidence", () => {
  it("preserves full text and inert HTML, excludes arbitrary headers and keeps attachment bytes", async () => {
    const text = "Customer text\n".repeat(1000);
    const requests: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      requests.push(String(url));
      if (String(url).startsWith("https://api.resend.com"))
        return Response.json({
          data: [
            {
              id: "a",
              download_url: "https://inbound-cdn.resend.com/em/attachments/a?signature=private",
            },
          ],
          has_more: false,
        });
      expect(init?.headers).toBeUndefined();
      expect(init?.redirect).toBe("error");
      return new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;
    const result = await ownerCopy(
      "em",
      {
        from: "pat@example.com",
        text,
        html: "<script>alert(1)</script>",
        headers: { Authorization: "secret-value" },
        attachments: [{ id: "a", filename: "evil.html", size: 3 }],
      },
      "re_not_real",
      fetchImpl,
    );
    expect(result.text).toContain(text);
    expect(result.html).not.toContain("<script>");
    const original = Buffer.from(result.attachments[0].content, "base64").toString();
    expect(original).toContain("<script>alert(1)</script>");
    expect(original).not.toContain("secret-value");
    expect(result.attachments[1]).toMatchObject({
      filename: "customer-attachment-1.untrusted.bin",
      content: "AQID",
      content_type: "application/octet-stream",
    });
    expect(JSON.stringify(result)).not.toContain("signature=private");
    expect(result.limitations).toEqual([]);
    expect(requests).toHaveLength(2);
  });
  it("flags missing, oversized and unsafe attachments without fetching untrusted URLs", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return Response.json({
        data: [
          { id: "a", download_url: "http://127.0.0.1/secret" },
          { id: "b", download_url: "https://inbound-cdn.resend.com/em/attachments/b" },
        ],
        has_more: true,
      });
    }) as typeof fetch;
    const result = await ownerCopy(
      "em",
      {
        from: "pat@example.com",
        attachments: [
          { id: "a", size: 3 },
          { id: "b", size: 20 * 1024 * 1024 },
          { id: "missing", size: 1 },
        ],
      },
      "re_test",
      fetchImpl,
    );
    expect(calls).toBe(1);
    expect(result.limitations).toHaveLength(4);
    expect(result.attachments).toHaveLength(1);
    expect(result.text).toContain("Original retained in Resend Receiving");
  });
  it("retries unavailable attachment metadata", async () => {
    await expect(
      ownerCopy(
        "em",
        { from: "pat@example.com", attachments: [{ id: "a", size: 1 }] },
        "re_test",
        (async () => new Response(null, { status: 503 })) as typeof fetch,
      ),
    ).rejects.toThrow(/metadata unavailable/);
  });
});
describe("routing and live gates", () => {
  it("ignores the legacy global flag and scopes each new flag", () => {
    expect(isSupportAutoreplyLive({ SUPPORT_AUTOREPLY_LIVE: "true" }, "athena")).toBe(false);
    expect(isSupportAutoreplyLive({ ATHENA_SUPPORT_ACK_LIVE: "true" }, "athena")).toBe(true);
    expect(isSupportAutoreplyLive({ ATHENA_SUPPORT_ACK_LIVE: "true" }, "circle")).toBe(false);
    expect(isSupportAutoreplyLive({ CIRCLE_SUPPORT_ACK_LIVE: "1" }, "circle")).toBe(true);
  });
  it("flags mixed or inconsistent recipients, leaves unknown non-support routing intact", () => {
    expect(
      routeSupport({
        from: "pat@example.com",
        to: ["support@meetathena.io", "support@alpcontractorcircle.com"],
      }).review,
    ).toBe("mixed_brand");
    expect(
      routeSupport(
        { from: "pat@example.com", to: ["support@meetathena.io"] },
        SUPPORT_INBOXES.circle,
      ).review,
    ).toBe("recipient_mismatch");
    expect(routeSupport({ from: "pat@example.com", to: ["unknown@example.com"] }).inbox).toBeNull();
    expect(routeSupport({ from: "pat@example.com" }, SUPPORT_INBOXES.athena).review).toBe(
      "recipient_unconfirmed",
    );
  });
});
