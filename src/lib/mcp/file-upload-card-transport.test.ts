import { describe, expect, it } from "vitest";
import { defineMcp, defineTool } from "@lovable.dev/mcp-js";
import { createTanStackMcpHandler } from "@lovable.dev/mcp-js/stacks/tanstack";
import { z } from "zod";
import "./widget-bridge";
import { FILE_UPLOAD_CARD_URI, fileUploadResourceMeta } from "./cards/file-upload-card";
import { isFileUploadPut } from "./file-upload-origin";
import { handleFileUpload } from "../file-upload-route.server";
import { nativeCardResponse, nativeCardVisit } from "./native-card-transport";

describe("authenticated file-upload card discovery and capability route", () => {
  it.each(["ChatGPT", "Claude"])(
    "publishes the card through the real SDK on %s without changing document reads",
    async (host) => {
      const tools = ["file_upload", "project_documents"].map((name) =>
        defineTool({
          name,
          title: "Fictional upload",
          description: "Fictional fixture.",
          inputSchema: { action: z.enum(["list", "read"]) },
          handler: async ({ action }) => ({
            content: [
              {
                type: "text" as const,
                text: action === "read" ? "Exact source text" : "Pending uploads",
              },
            ],
            structuredContent: {
              action,
              ...(action === "list" ? { upload_recovery_view: true, pending_uploads: [] } : {}),
            },
          }),
        }),
      );
      const handler = createTanStackMcpHandler(
        defineMcp({
          name: "athena",
          title: "Athena",
          version: "test",
          instructions: "Fixture",
          tools,
          metrics: false,
        }),
        { resourcePath: "/mcp" },
      );
      let id = 0;
      async function send(method: string, params: Record<string, unknown>) {
        const request = new Request("https://example.test/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        });
        const visit = await nativeCardVisit(request);
        const raw = await (await nativeCardResponse(await handler({ request }), visit)).text();
        return JSON.parse(
          raw.trimStart().startsWith("{")
            ? raw
            : raw
                .split("\n")
                .find((line) => line.startsWith("data:"))!
                .slice(5),
        );
      }
      await send("initialize", {
        protocolVersion: "2025-06-18",
        clientInfo: { name: host, version: "test" },
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
          },
        },
      });
      const listed = await send("tools/list", {});
      expect(
        listed.result.tools.find((t: { name: string }) => t.name === "file_upload")._meta.ui
          .resourceUri,
      ).toBe(FILE_UPLOAD_CARD_URI);
      const resource = await send("resources/read", { uri: FILE_UPLOAD_CARD_URI });
      expect(resource.result.contents[0]).toMatchObject({
        mimeType: "text/html;profile=mcp-app",
        _meta: fileUploadResourceMeta,
      });
      expect(resource.result.contents[0].text).toContain("Retry completion");
      const pending = await send("tools/call", {
        name: "project_documents",
        arguments: { action: "list" },
      });
      expect(pending.result._meta.ui.resourceUri).toBe(FILE_UPLOAD_CARD_URI);
      const source = await send("tools/call", {
        name: "project_documents",
        arguments: { action: "read" },
      });
      expect(source.result.content[0].text).toBe("Exact source text");
      expect(source.result._meta?.ui?.resourceUri).toBeUndefined();
    },
  );

  it("allows only cookie-free token PUTs through the cross-origin guard", async () => {
    const { csrfOriginGuard } = await import("../../start");
    const guard = (
      csrfOriginGuard as unknown as { options: { server: (args: unknown) => Promise<unknown> } }
    ).options.server;
    const token = "a".repeat(43),
      path = `/r/file-upload/${token}`;
    expect(isFileUploadPut("PUT", path)).toBe(true);
    expect(isFileUploadPut("PUT", path + "/extra")).toBe(false);
    expect(isFileUploadPut("POST", path)).toBe(false);
    for (const method of ["PUT", "POST"]) {
      const result = await guard({
        request: new Request("https://app.meetathena.io" + path, {
          method,
          headers: { origin: "https://host.example.test" },
        }),
        next: async () => "passed",
      });
      if (method === "PUT") expect(result).toBe("passed");
      else expect((result as Response).status).toBe(403);
    }
    const preflight = await handleFileUpload(
      new Request("https://app.meetathena.io" + path, { method: "OPTIONS" }),
      token,
      { lookup: async () => null, put: async () => {} },
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("PUT, OPTIONS");
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
