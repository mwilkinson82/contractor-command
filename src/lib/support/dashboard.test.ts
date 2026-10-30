import { describe, it, expect, vi } from "vitest";
import {
  supportDashboard,
  supportAttachment,
  supportAttachmentList,
  safeAttachment,
} from "./dashboard.server";
function client(results: any[]) {
  const calls: any[] = [];
  return {
    calls,
    from: vi.fn((table: string) => {
      const result = results.shift();
      const call: any = { table, ops: [] };
      calls.push(call);
      const chain: any = {
        then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
      };
      for (const op of ["select", "eq", "order", "range", "limit", "maybeSingle"])
        chain[op] = (...args: any[]) => {
          call.ops.push([op, ...args]);
          return chain;
        };
      return chain;
    }),
  };
}
const admin = { data: [{ role: "admin" }], error: null };
describe("private support dashboard", () => {
  it.each([undefined, [], [{ role: "member" }]])(
    "denies non-admin access before any ticket read",
    async (roles) => {
      for (const action of [
        (c: any) => supportDashboard(c, "u", undefined, 0),
        (c: any) => supportDashboard(c, "u", "ticket", 0),
        (c: any) => supportAttachment(c, "u", "message", 0),
        (c: any) => supportAttachmentList(c, "u", "message"),
      ]) {
        const c = client([{ data: roles, error: null }]);
        await expect(action(c)).rejects.toThrow("Forbidden");
        expect(c.calls.map((x) => x.table)).toEqual(["user_roles"]);
      }
    },
  );
  it("fails closed on role lookup errors even if an admin row is returned", async () => {
    const c = client([{ data: [{ role: "admin" }], error: { message: "offline" } }]);
    await expect(supportDashboard(c, "u", undefined, 0)).rejects.toThrow("Forbidden");
    expect(c.calls).toHaveLength(1);
  });
  it("paginates tickets and calculates latest received message without returning bodies", async () => {
    const c = client([
      admin,
      { data: [{ id: "t", received_at: "old" }] },
      { data: [{ received_at: "latest" }] },
    ]);
    expect(await supportDashboard(c, "u", undefined, 2)).toEqual({
      tickets: [{ id: "t", received_at: "old", last_update: "latest" }],
    });
    expect(c.calls[1].ops).toContainEqual(["range", 100, 149]);
    expect(c.calls[2].ops).toContainEqual(["eq", "ticket_id", "t"]);
  });
  it("scopes conversation and delivery reads and omits frozen attachment bytes from conversation response", async () => {
    const c = client([
      admin,
      { data: { id: "t" } },
      { data: [{ id: "m", evidence: { text: "<script>untrusted</script>" } }] },
      {
        data: [
          {
            kind: "owner",
            state: "sent",
            payload: {
              text: "note",
              attachments: [{ content: "c2VjcmV0" }],
              headers: { secret: "never expose" },
            },
          },
        ],
      },
    ]);
    const r = await supportDashboard(c, "u", "t", 1);
    expect(c.calls[2].ops).toContainEqual(["eq", "ticket_id", "t"]);
    expect(c.calls[2].ops).toContainEqual(["range", 50, 99]);
    expect(c.calls[3].ops).toContainEqual(["eq", "message_id", "m"]);
    expect(JSON.stringify(r)).not.toContain("c2VjcmV0");
    expect(JSON.stringify(r)).not.toContain("never expose");
    expect(r.messages?.[0].evidence.text).toContain("<script>");
  });
  it("reads downloads only from admin-authorized owner delivery and forces inert filename", async () => {
    const c = client([
      admin,
      {
        data: {
          payload: {
            attachments: [
              { filename: "../../evil.html", content_type: "text/html", content: "aGk=" },
            ],
          },
        },
      },
    ]);
    expect(await supportAttachment(c, "u", "m", 0)).toEqual({
      filename: "support-attachment-1.untrusted.bin",
      content: "aGk=",
    });
    expect(c.calls[1].ops).toContainEqual(["eq", "kind", "owner"]);
    expect(c.calls[1].ops).toContainEqual(["eq", "message_id", "m"]);
  });
  it("rejects missing, invalid and oversized attachment content", () => {
    for (const payload of [
      {},
      { attachments: [{ content: "https://evil.example" }] },
      { attachments: [{ content: "a".repeat(12 * 1024 * 1024 + 1) }] },
    ])
      expect(() => safeAttachment(payload, 0)).toThrow("Attachment unavailable");
  });
});
