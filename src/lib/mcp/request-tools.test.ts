import { beforeEach, describe, expect, it, vi } from "vitest";
const job = "00000000-0000-4000-8000-000000000094";
const state = vi.hoisted(() => ({ reloadFails: false, writes: 0, calls: [] as string[] }));
vi.mock("./guard", () => ({
  run: async (_name: string, _ctx: unknown, _options: unknown, fn: (sb: unknown) => unknown) =>
    fn({
      rpc(name: string) {
        state.calls.push(name);
        if (name === "mcp_request_record") {
          state.writes++;
          return Promise.resolve({
            data: {
              saved_id: "00000000-0000-4000-8000-000000000099",
              number: "RFI-001",
              already_applied: false,
            },
            error: null,
          });
        }
        return Promise.resolve(
          state.reloadFails
            ? { data: null, error: { message: "load failed" } }
            : {
                data: {
                  job_id: "00000000-0000-4000-8000-000000000094",
                  job_number: "2701",
                  job_name: "Fictional Job",
                  today: "2026-10-25",
                  read_only: false,
                  records: [],
                },
                error: null,
              },
        );
      },
    }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
vi.mock("./tools/submittal-tools", () => ({
  boardFor: async () =>
    `https://app.meetathena.io/r/job/00000000-0000-4000-8000-000000000094/submittals?t=${"x".repeat(43)}`,
  resolveSubmittalJob: async () => ({
    job_id: "00000000-0000-4000-8000-000000000094",
    job_number: "2701",
    company_id: "00000000-0000-4000-8000-000000000093",
    scope: "full",
  }),
}));
import { rfiLog, rfiRecord } from "./tools/request-tools";
type Reply = {
  content: { text: string }[];
  structuredContent: {
    saved_id?: string;
    refresh_needed?: boolean;
    card: { title: string };
    log_url?: string;
  };
};
const invoke = (tool: unknown, args: Record<string, unknown>) =>
  (tool as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Reply> }).handler(
    args,
    {},
  );
beforeEach(() => {
  state.reloadFails = false;
  state.writes = 0;
  state.calls = [];
});
describe("real request tool handler replies", () => {
  it("lists the actual RFI log without a build, write or lookahead substitution", async () => {
    const reply = await invoke(rfiLog, { job_number: "2701" });
    expect(reply.structuredContent.card.title).toBe("RFI log");
    expect(reply.structuredContent.log_url).toContain(`/r/job/${job}/rfis?t=`);
    expect(state.calls).toEqual(["mcp_request_rows"]);
    expect(state.writes).toBe(0);
  });
  it("asks for missing content before allocating a request or transmittal", async () => {
    const reply = await invoke(rfiRecord, {
      job_number: "2701",
      action: "create",
      request_id: crypto.randomUUID(),
      title: "Question",
    });
    expect(reply.content[0].text).toContain("The exact question");
    expect(reply.content[0].text).toContain("No request or transmittal was created");
    expect(state.writes).toBe(0);
  });
  it("acknowledges a successful save even if its follow-up log read fails", async () => {
    state.reloadFails = true;
    const reply = await invoke(rfiRecord, {
      job_number: "2701",
      action: "create",
      request_id: crypto.randomUUID(),
      title: "Question",
      condition: "A101 detail 4",
      question: "Which detail applies?",
      references: [{ kind: "drawing", citation: "A101 detail 4" }],
    });
    expect(reply.structuredContent.saved_id).toBe("00000000-0000-4000-8000-000000000099");
    expect(reply.structuredContent.refresh_needed).toBe(true);
    expect(reply.content[0].text).toContain("Your request was saved");
    expect(reply.content[0].text).not.toContain("Nothing was saved");
    expect(state.writes).toBe(1);
  });
});
