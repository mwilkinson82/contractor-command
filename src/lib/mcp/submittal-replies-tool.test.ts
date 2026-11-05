import { beforeEach, describe, expect, it, vi } from "vitest";

const JOB = "323a040a-7ed1-4726-8f6a-da13fdb5a0eb";
const REPLY = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => {
  const box = {
    calls: [] as { fn: string; args: Record<string, unknown> }[],
    pending: true,
    sb() {
      return {
        rpc(fn: string, args: Record<string, unknown>) {
          box.calls.push({ fn, args });
          if (fn === "mcp_submittal_reply_confirm") {
            box.pending = false;
            return Promise.resolve({
              data: {
                status: "ok",
                number: "26 51 00-01",
                action_label: "Revise and resubmit",
                review_status: "confirmed",
              },
              error: null,
            });
          }
          if (fn === "mcp_submittal_replies_list")
            return Promise.resolve({
              data: {
                can_confirm: true,
                needs_review: box.pending ? 1 : 0,
                replies: [
                  {
                    id: REPLY,
                    submittal_id: "s",
                    number: "26 51 00-01",
                    revision: 0,
                    title: "Lighting fixtures",
                    submittal_status: box.pending ? "submitted" : "revise_and_resubmit",
                    source: "email",
                    action: box.pending ? null : "revise_and_resubmit",
                    action_label: box.pending ? "Received, needs review" : "Revise and resubmit",
                    review_status: box.pending ? "needs_review" : "confirmed",
                    reviewer_name: "Jordan Lee",
                    reviewer_email: "jordan@arch.example",
                    sender_known: true,
                    subject: "Re: Submittal",
                    comments: "Revise the mounting height.",
                    files: [{ filename: "stamp.pdf" }],
                    received_at: "2026-11-05T15:00:00Z",
                    created_at: "2026-11-05T15:00:01Z",
                    confirmed_at: null,
                    confirmed_by_name: box.pending ? null : "Pat PM",
                  },
                ],
              },
              error: null,
            });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  return box;
});

vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (sb: unknown) => Promise<unknown>) =>
    fn(state.sb()),
  text: (b: string) => ({ content: [{ type: "text", text: b }] }),
  dbError: (e: { message?: string }) => {
    throw new Error(e.message ?? "db");
  },
  isMissingFunction: () => false,
}));
vi.mock("./jobs", () => ({
  FULL_ACCESS_MESSAGE: "This needs full access to the job.",
  audit: async () => {},
  jobTimeZone: async () => "America/New_York",
  prefix: (job: { job_number: string }) => `${job.job_number} – `,
  resolveJob: async (_sb: unknown, jobNumber: string) => ({
    job_id: JOB,
    job_number: jobNumber,
    name: "Willow Creek",
    company_id: "company",
    scope: "full" as const,
  }),
}));
vi.mock("./tools/workflow-tools", () => ({
  namedOrSoleJob: async (_sb: unknown, jobNumber?: string) =>
    jobNumber ? { job_number: jobNumber, company_id: "c" } : null,
  listCompaniesAndJobs: async () => "No job named.",
}));

import { submittalLog, submittalsList } from "./tools/submittal-tools";

type Out = {
  content: { text?: string }[];
  structuredContent: Record<string, unknown> & {
    card: { title: string; kpis?: { label: string; value: string }[] };
  };
};
const handler = (t: unknown) =>
  (t as { handler: (a: Record<string, unknown>, c: unknown) => Promise<Out> }).handler;

beforeEach(() => {
  state.calls = [];
  state.pending = true;
});

describe("returned submittals in chat", () => {
  it("lists returns, with emailed replies that still need a status", async () => {
    const out = await handler(submittalsList)({ job_number: "2810", returned: true }, {});
    expect(state.calls.map((c) => c.fn)).toEqual(["mcp_submittal_replies_list"]);
    expect(out.structuredContent.card.title).toBe("Returned submittals");
    expect(out.structuredContent.card.kpis).toContainEqual({
      label: "Need your review",
      value: "1",
    });
    expect(out.structuredContent.replies).toEqual([
      {
        id: REPLY,
        number: "26 51 00-01",
        source: "email",
        review_status: "needs_review",
        action: null,
      },
    ]);
    expect(out.content[0]!.text).toContain("Received, needs review");
  });

  it("confirms an emailed reply's status only with the reply and the status named", async () => {
    await expect(
      handler(submittalLog)(
        { action: "confirm_reply", job_number: "2810", response_id: REPLY },
        {},
      ),
    ).rejects.toThrow(/Which reply/);
    const out = await handler(submittalLog)(
      {
        action: "confirm_reply",
        job_number: "2810",
        response_id: REPLY,
        reply_action: "revise_and_resubmit",
      },
      {},
    );
    expect(state.calls[0]).toEqual({
      fn: "mcp_submittal_reply_confirm",
      args: { _job: JOB, _response: REPLY, _action: "revise_and_resubmit" },
    });
    expect(out.content[0]!.text).toContain("Revise and resubmit, confirmed by Pat PM");
    expect(out.structuredContent.needs_review).toBe(0);
  });
});
