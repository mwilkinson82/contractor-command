import { describe, expect, it } from "vitest";
import { drawingFile, drawingFileMeta, drawingWithFile } from "./drawing-file-input";
import { nativeCardPayload, nativeCardVisit } from "./native-card-transport";

const file = {
  download_url: "https://files.oaiusercontent.com/permit.pdf",
  file_id: "fictional-file",
};

describe("drawing attachment handoff", () => {
  it("accepts optional host names and retains the exact file reference and sheet order", () => {
    expect(drawingFile.parse(file)).toEqual(file);
    expect(drawingWithFile(undefined, file, ["S-001", "S-100"])).toEqual({
      file,
      filename: "drawing-set.pdf",
      sheets: ["S-001", "S-100"],
    });
    expect(
      drawingWithFile({ filename: "permit.pdf", sheets: ["S-100"] }, file, ["S-001"]),
    ).toMatchObject({ filename: "permit.pdf", sheets: ["S-100"] });
  });

  it.each([
    { file },
    { source_url: "https://drive.google.com/file/d/example/view" },
    { content_base64: "PDF" },
  ])("rejects ambiguous sources before storage: %j", (drawing) => {
    expect(() => drawingWithFile(drawing, file)).toThrow(/one drawing source/);
  });

  it("preserves the legacy drawing payload when no host file is supplied", () => {
    const drawing = { filename: "permit.pdf", content_base64: "legacy" };
    expect(drawingWithFile(drawing, undefined)).toBe(drawing);
    expect(drawingFileMeta("drawing_markup")).toEqual({});
  });

  it("repairs file metadata stripped by the SDK without changing templates or another tool", async () => {
    const visit = await nativeCardVisit(
      new Request("https://app.meetathena.io/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer fictional-token" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    const tools = [
      "drawing_set_import",
      "estimate_intake",
      "estimate_takeoff_save",
      "email_draft",
      "cpm_activities",
    ].map((name) => ({
      name,
      inputSchema: { type: "object" },
      _meta: { marker: "kept", "openai/outputTemplate": "ui://existing.html" },
    }));
    const result = nativeCardPayload({ jsonrpc: "2.0", id: 1, result: { tools } }, visit);
    const returned = (result.value as { result: { tools: typeof tools } }).result.tools;
    for (let i = 0; i < 3; i++)
      expect(returned[i]._meta).toMatchObject({ ...tools[i]._meta, "openai/fileParams": ["file"] });
    expect(returned[3]._meta).toMatchObject(tools[3]._meta);
    expect(returned[4]).toBe(tools[4]);
    expect(nativeCardPayload(result.value, visit).changed).toBe(false);
  });
});
