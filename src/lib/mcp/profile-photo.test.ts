// "Set my photo" in chat: the member's own photo goes to their own folder and onto their profile, or Athena gives the
// account page link when the chat can't pass the file. All names and files are made up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brokenJpeg, testJpeg } from "../photo-fixtures.test-helpers";
import { drawingFileMeta } from "./drawing-file-input";

const ME = "33333333-3333-4333-8333-333333333333";
const state = vi.hoisted(() => ({
  uploads: [] as { path: string; type: string }[],
  removed: [] as string[],
  rpcs: [] as [string, Record<string, unknown>][],
  rpcError: null as { message: string } | null,
  uploadError: null as { message: string } | null,
}));

vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) =>
    fn({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        state.rpcs.push([fn, args]);
        return { data: state.rpcError ? null : { status: "ok" }, error: state.rpcError };
      },
    }),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
}));
// Athena's server stores the photo (service role); the member's own sign-in only saves it on their profile.
vi.mock("../people-photo.server", () => ({
  storePersonPhoto: async (path: string, _b: Uint8Array, type: string) => {
    if (!state.uploadError) state.uploads.push({ path, type });
    return !state.uploadError;
  },
  dropPersonPhoto: async (path: string) => {
    state.removed.push(path);
  },
}));
vi.mock("./visible", async () => {
  const actual = await vi.importActual<typeof import("./visible")>("./visible");
  return { ...actual, guide: (r: unknown) => r };
});

const { profilePhoto } = await import("./tools/profile-photo-tool");
type R = { content: { text: string }[]; structuredContent: Record<string, unknown> };
const handle = (args: Record<string, unknown>, user: string | null = ME) =>
  (
    profilePhoto as unknown as {
      handler: (a: unknown, c: unknown) => Promise<R>;
    }
  ).handler(args, { getUserId: () => user });
const attached = (bytes: Uint8Array<ArrayBuffer>, name = "me.jpg") => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(bytes, { status: 200 }));
  return {
    download_url: "https://files.oaiusercontent.com/synthetic-headshot",
    file_id: `file_${name}`,
    file_name: name,
  };
};

describe("profile_photo", () => {
  beforeEach(() => {
    state.uploads = [];
    state.removed = [];
    state.rpcs = [];
    state.rpcError = null;
    state.uploadError = null;
  });
  afterEach(() => vi.restoreAllMocks());

  it("takes the photo attached in ChatGPT", () => {
    expect(drawingFileMeta("profile_photo")).toEqual({ "openai/fileParams": ["file"] });
  });

  it("saves the member's own photo to their own folder and profile", async () => {
    const r = await handle({ file: attached(testJpeg(800, 800)) });
    expect(r.structuredContent).toMatchObject({ saved: true, width: 800, height: 800 });
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0]!.path).toMatch(new RegExp(`^people/${ME}/photo-[0-9a-f-]{36}\\.jpg$`));
    expect(state.uploads[0]!.type).toBe("image/jpeg");
    expect(state.rpcs).toEqual([["mcp_profile_photo_set", { _path: state.uploads[0]!.path }]]);
    expect(r.content[0]!.text).toContain("Your team");
    expect(r.content[0]!.text).not.toMatch(/oaiusercontent|athena-progress|people\/|33333333/);
  });

  it("gives the account page link when the chat can't pass the photo", async () => {
    const r = await handle({});
    expect(r.structuredContent).toMatchObject({ saved: false, needs_photo: true });
    expect(r.content[0]!.text).toContain("https://app.meetathena.io/account");
    expect(state.uploads).toEqual([]);
    expect(state.rpcs).toEqual([]);
  });

  it("refuses a broken file, a tiny preview, or no sign-in, and saves nothing", async () => {
    await expect(handle({ file: attached(brokenJpeg()) })).rejects.toThrow(/damaged or incomplete/);
    await expect(handle({ file: attached(testJpeg(120, 120)) })).rejects.toThrow(/small preview/);
    await expect(
      handle({
        file: attached(
          new TextEncoder().encode("<html>not a photo</html>") as Uint8Array<ArrayBuffer>,
        ),
      }),
    ).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(
      handle({ file: { download_url: "https://evil.example/me.jpg", file_id: "f" } }),
    ).rejects.toThrow(/Nothing was saved/);
    await expect(handle({ file: { download_url: "x", file_id: "f" } }, null)).rejects.toThrow(
      /Sign in/,
    );
    expect(state.uploads).toEqual([]);
    expect(state.rpcs).toEqual([]);
  });

  it("takes the stored file back off when the profile can't be saved", async () => {
    state.rpcError = { message: "MCP_BAD:No profile for this sign-in." };
    await expect(handle({ file: attached(testJpeg(800, 800)) })).rejects.toThrow(
      /couldn't save your photo/,
    );
    expect(state.removed).toEqual([state.uploads[0]!.path]);
  });

  it("removes the photo", async () => {
    const r = await handle({ remove: true });
    expect(r.structuredContent).toMatchObject({ saved: true, removed: true });
    expect(state.rpcs).toEqual([["mcp_profile_photo_set", { _path: null }]]);
    expect(r.content[0]!.text).toContain("company's logo");
  });
});
