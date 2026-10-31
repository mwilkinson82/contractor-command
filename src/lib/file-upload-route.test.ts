import { describe, expect, it } from "vitest";
import { newToken } from "./mcp/file-share";
import { handleFileUpload, type UploadDeps } from "./file-upload-route.server";

const token = newToken();
const session = {
  id: "11111111-1111-4111-8111-111111111111",
  purpose: "contract" as const,
  filename: "Agreement.pdf",
  mime_type: "application/pdf",
  bucket: "athena-documents",
  storage_path: "c/j/id/Agreement.pdf",
  status: "open" as const,
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
};

function deps(over: Partial<UploadDeps> = {}): UploadDeps & { putCalls: Uint8Array[] } {
  const putCalls: Uint8Array[] = [];
  return {
    putCalls,
    lookup: async () => session,
    put: async (_b, _p, bytes) => {
      putCalls.push(bytes);
    },
    ...over,
  };
}

describe("upload link", () => {
  it("rejects new bytes on an expired token and rechecks expiry after reading a slow body", async () => {
    const expired = { ...session, expires_at: "2000-01-01T00:00:00Z" };
    const denied = deps({ lookup: async () => expired });
    const response = await handleFileUpload(
      new Request("https://example.test/upload", { method: "PUT", body: "%PDF-1.7 test" }),
      token,
      denied,
    );
    expect(response.status).toBe(410);
    expect(denied.putCalls).toHaveLength(0);
    const pending = { ...session };
    const d = deps({ lookup: async () => pending });
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new TextEncoder().encode("%PDF-1.7 test"));
          pending.expires_at = "2000-01-01T00:00:00Z";
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const slow = await handleFileUpload(
      new Request("https://example.test/upload", {
        method: "PUT",
        body: stream,
        duplex: "half",
      } as RequestInit),
      token,
      d,
    );
    expect(slow.status).toBe(410);
    expect(await slow.json()).toMatchObject({ stored: false });
    expect(d.putCalls).toHaveLength(0);
  });

  it("shows a form and stores a PUT of the matching file", async () => {
    const d = deps();
    const form = await handleFileUpload(
      new Request("https://app.meetathena.io/r/file-upload/" + token),
      token,
      d,
    );
    expect(await form.text()).toContain("Upload file");
    expect(form.headers.get("referrer-policy")).toBe("no-referrer");
    const pdf = new TextEncoder().encode("%PDF-1.7\ncontract text");
    const put = await handleFileUpload(
      new Request("https://app.meetathena.io/r/file-upload/" + token, { method: "PUT", body: pdf }),
      token,
      d,
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({
      stored: true,
      uploaded: true,
      upload_complete: false,
      finish_required: true,
    });
    expect(d.putCalls[0]?.[0]).toBe(0x25);
  });

  it("keeps browser upload receipt separate from Athena's completed processing", async () => {
    const pending = { ...session };
    const d = deps({ lookup: async () => pending });
    const form = new FormData();
    form.set(
      "file",
      new File(["%PDF-1.7 synthetic"], "Agreement.pdf", { type: "application/pdf" }),
    );
    const result = await handleFileUpload(
      new Request("https://example.test/upload", { method: "POST", body: form }),
      token,
      d,
    );
    const html = await result.text();
    expect(result.status).toBe(200);
    expect(html).toContain("Upload received");
    expect(html).toContain("job attachment is not confirmed yet");
    expect(html).not.toContain("File stored");
    expect(pending.status).toBe("open");
    const completed = await handleFileUpload(
      new Request("https://example.test/upload"),
      token,
      deps({ lookup: async () => ({ ...session, status: "finished" }) }),
    );
    expect(await completed.text()).toContain("Upload processed");
  });

  it("rejects an unknown link, a text file on a pdf slot, and an oversized body", async () => {
    const missing = await handleFileUpload(
      new Request("https://app.meetathena.io/x"),
      token,
      deps({ lookup: async () => null }),
    );
    expect(missing.status).toBe(404);
    const wrong = await handleFileUpload(
      new Request("https://app.meetathena.io/x", {
        method: "PUT",
        body: new TextEncoder().encode("plain text only"),
      }),
      token,
      deps(),
    );
    expect(wrong.status).toBe(400);
    const huge = await handleFileUpload(
      new Request("https://app.meetathena.io/x", {
        method: "PUT",
        headers: { "content-length": String(101 * 1024 * 1024) },
        body: new Uint8Array(8),
      }),
      token,
      deps(),
    );
    expect(huge.status).toBe(400);
    expect(await huge.json()).toMatchObject({ stored: false });
  });
  it("bounds financial multipart before parsing and requires a server claim", async () => {
    const financial = {
      ...session,
      purpose: "financial_document" as const,
      bucket: "athena-financial-documents",
    };
    const d = deps({ lookup: async () => financial, claimFinancial: async () => {} });
    const form = new FormData();
    form.set(
      "file",
      new File([new TextEncoder().encode("%PDF-1.7 synthetic")], "Agreement.pdf", {
        type: "application/pdf",
      }),
    );
    expect(
      (
        await handleFileUpload(
          new Request("https://app.meetathena.io/x", { method: "POST", body: form }),
          token,
          d,
        )
      ).status,
    ).toBe(200);
    expect(d.putCalls).toHaveLength(1);
    const boundary = new Uint8Array(10 * 1024 * 1024);
    boundary.set(new TextEncoder().encode("%PDF-1.7"));
    expect(
      (
        await handleFileUpload(
          new Request("https://app.meetathena.io/x", { method: "PUT", body: boundary }),
          token,
          d,
        )
      ).status,
    ).toBe(200);
    const tooLarge = new Uint8Array(boundary.length + 1);
    tooLarge.set(boundary.subarray(0, 8));
    expect(
      (
        await handleFileUpload(
          new Request("https://app.meetathena.io/x", { method: "PUT", body: tooLarge }),
          token,
          d,
        )
      ).status,
    ).toBe(400);
    expect(d.putCalls).toHaveLength(2);
    const denied = deps({ lookup: async () => financial });
    expect(
      (
        await handleFileUpload(
          new Request("https://app.meetathena.io/x", {
            method: "PUT",
            body: new TextEncoder().encode("%PDF-1.7 x"),
          }),
          token,
          denied,
        )
      ).status,
    ).toBe(400);
    expect(denied.putCalls).toHaveLength(0);
    const oversized = new FormData();
    oversized.set(
      "file",
      new File([new Uint8Array(10 * 1024 * 1024 + 65537)], "Agreement.pdf", {
        type: "application/pdf",
      }),
    );
    const response = await handleFileUpload(
      new Request("https://app.meetathena.io/x", { method: "POST", body: oversized }),
      token,
      d,
    );
    expect(response.status).toBe(400);
    expect(d.putCalls).toHaveLength(2);
  });
});
