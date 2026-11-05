import { beforeEach, describe, expect, it, vi } from "vitest";

const JOB = "10000000-0000-4000-8000-000000000001";
const LA = "31be8000-0000-4000-8000-000000000001";
const ITEM = "20000000-0000-4000-8000-000000000001";
const REQ = "30000000-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({
  scope: "full" as "full" | "contract" | "super",
  emailOn: true,
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  sent: [] as { to: string; subject: string; html: string; fromName?: string }[],
  list: null as unknown,
}));

const row = (over: Record<string, unknown> = {}) => ({
  id: REQ,
  lookahead_id: LA,
  item_id: ITEM,
  activity_id: null,
  party_kind: "supplier",
  party_name: "Acme Supply",
  party_email: "orders@acme.example",
  ask_kind: "delivery",
  what: "Switchgear delivery",
  asked_date: "2099-11-12",
  window_end: null,
  expires_at: "2099-11-19T00:00:00Z",
  status: "asked",
  state: "asked",
  response_date: null,
  responder_name: null,
  response_note: null,
  responded_at: null,
  email_status: "sent",
  needs_call: false,
  created_by_name: "Pat Lee",
  ...over,
});

const sb = () => ({
  from(table: string) {
    let rows: Record<string, unknown>[] =
      table === "mcp_open_items"
        ? [{ id: ITEM, job_id: JOB, action: "12 - Switchgear delivery", needed_by: "2099-11-12" }]
        : [];
    const api = {
      select: () => api,
      eq(col: string, val: unknown) {
        rows = rows.filter((r) => r[col] === val);
        return api;
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    };
    return api;
  },
  async rpc(fn: string, args: Record<string, unknown>) {
    state.rpcs.push({ fn, args });
    if (fn === "mcp_lookahead_confirm_create")
      return {
        data: {
          ...row({ email_status: "queued" }),
          job_number: "2701",
          job_name: "Fictional Job",
          company: "Northline Electric",
        },
        error: null,
      };
    if (fn === "mcp_lookahead_confirms_list") return { data: state.list, error: null };
    if (fn === "mcp_lookahead_confirm_cancel")
      return { data: row({ state: "cancelled" }), error: null };
    if (fn === "mcp_lookahead_confirm_email_result" || fn === "mcp_audit")
      return { data: null, error: null };
    throw new Error(`Unexpected RPC ${fn}`);
  },
});

vi.mock("./guard", () => ({
  run: async (_t: string, _c: unknown, _o: unknown, fn: (s: unknown) => unknown) => fn(sb()),
  text: (text: string) => ({ content: [{ type: "text", text }] }),
  dbError: (e: { message: string }) => {
    throw new Error(e.message);
  },
}));
vi.mock("./jobs", async (orig) => ({
  ...(await orig<typeof import("./jobs")>()),
  resolveJob: async () => ({
    job_id: JOB,
    job_number: "2701",
    name: "Fictional Job",
    company_id: "co",
    scope: state.scope,
  }),
  jobTimeZone: async () => "UTC",
  audit: async () => undefined,
}));
vi.mock("./tools/workflow-tools", () => ({
  lookaheadForJob: async () => ({ id: LA, job_id: JOB }),
  lookaheadData: async () => ({
    acts: [{ id: "A1040", name: "Level 2 drywall crew start", start: "2099-11-14" }],
  }),
}));
vi.mock("./document-email-brand", () => ({ companyLogoUrl: async () => null }));
vi.mock("../customer-portal/email", async (orig) => ({
  ...(await orig<typeof import("../customer-portal/email")>()),
  portalEmailEnabled: () => state.emailOn,
  sendPortalEmail: async (m: (typeof state.sent)[number]) => {
    state.sent.push(m);
    return "sent";
  },
}));

import {
  confirmLine,
  linkExpiry,
  lookaheadConfirm,
  type ConfirmRow,
} from "./tools/lookahead-confirm-tools";

type Out = { content: { text: string }[]; structuredContent: Record<string, unknown> };
const call = (args: Record<string, unknown>) =>
  (lookaheadConfirm as unknown as { handler: (a: unknown, c: unknown) => Promise<Out> }).handler(
    { job_number: "2701", ...args },
    {},
  );
const send = {
  action: "send",
  item_id: ITEM,
  party_kind: "supplier",
  party_name: "Acme Supply",
  party_email: "orders@acme.example",
};

beforeEach(() => {
  state.scope = "full";
  state.emailOn = true;
  state.rpcs = [];
  state.sent = [];
});

describe("lookahead_confirm", () => {
  it("asks the member to confirm before emailing anyone outside the team", async () => {
    await expect(call(send)).rejects.toThrow(
      /Athena will email Acme Supply <orders@acme.example>.*confirm delivery Nov 12 for "Switchgear delivery".*confirmed true only after they say yes\. Nothing was sent\./,
    );
    expect(state.rpcs.map((r) => r.fn)).not.toContain("mcp_lookahead_confirm_create");
    expect(state.sent).toEqual([]);
  });

  it("sends on the member's yes with a hashed token, the line and the contractor's brand", async () => {
    const out = await call({ ...send, confirmed: true });
    const create = state.rpcs.find((r) => r.fn === "mcp_lookahead_confirm_create")!.args;
    expect(create).toMatchObject({
      _job: JOB,
      _lookahead: LA,
      _item: ITEM,
      _activity: null,
      _party_kind: "supplier",
      _ask_kind: "delivery",
      _what: "Switchgear delivery",
      _asked_date: "2099-11-12",
    });
    expect(create._token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({
      to: "orders@acme.example",
      fromName: "Northline Electric via Athena",
    });
    expect(state.sent[0]!.html).toContain("Confirm the date");
    expect(state.sent[0]!.html).toContain("https://app.meetathena.io/l/");
    expect(
      state.rpcs.find((r) => r.fn === "mcp_lookahead_confirm_email_result")!.args._status,
    ).toBe("sent");
    expect(out.content[0]!.text).toContain(
      "Emailed Acme Supply <orders@acme.example> to confirm delivery Nov 12",
    );
    expect(out.structuredContent).toMatchObject({ request_id: REQ, email_sent: true });
    expect(out.structuredContent.link).toBeUndefined();
  });

  it("takes a sub's crew start from a schedule activity", async () => {
    await call({
      action: "send",
      activity_id: "A1040",
      party_kind: "sub",
      party_name: "Rivera Drywall",
      party_email: "office@rivera.example",
      confirmed: true,
    });
    expect(state.rpcs.find((r) => r.fn === "mcp_lookahead_confirm_create")!.args).toMatchObject({
      _item: null,
      _activity: "A1040",
      _ask_kind: "start",
      _what: "Level 2 drywall crew start",
      _asked_date: "2099-11-14",
    });
  });

  it("gives the member the link when supplier email is off, and sends nothing", async () => {
    state.emailOn = false;
    const out = await call({ ...send, confirmed: true });
    expect(state.sent).toEqual([]);
    expect(out.content[0]!.text).toContain("email to suppliers and subs is off");
    expect(out.structuredContent.link).toMatch(
      /^https:\/\/app\.meetathena\.io\/l\/[A-Za-z0-9_-]{43}$/,
    );
  });

  it("refuses the wrong date kind, a past date and contract-only members", async () => {
    await expect(call({ ...send, ask_kind: "start", confirmed: true })).rejects.toThrow(
      /supplier confirms a delivery/,
    );
    await expect(call({ ...send, date: "2020-01-01", confirmed: true })).rejects.toThrow(
      /has passed/,
    );
    state.scope = "contract";
    await expect(call({ ...send, confirmed: true })).rejects.toThrow(/Only the job's PM/);
    expect(state.rpcs.map((r) => r.fn)).not.toContain("mcp_lookahead_confirm_create");
  });

  it("lists answers and puts proposed dates first as the team's call", async () => {
    state.scope = "contract";
    state.list = {
      can_send: false,
      counts: { asked: 0, confirmed: 1, needs_call: 1 },
      requests: [
        row({
          state: "confirmed",
          status: "confirmed",
          response_date: "2099-11-12",
          responder_name: "Maria Lopez",
        }),
        row({
          id: "30000000-0000-4000-8000-000000000002",
          party_name: "Rivera Drywall",
          ask_kind: "start",
          state: "proposed_new_date",
          status: "proposed_new_date",
          response_date: "2099-11-14",
          responder_name: "Luis Rivera",
          needs_call: true,
        }),
      ],
    };
    const out = await call({ action: "list" });
    const t = out.content[0]!.text;
    expect(t).toContain("1 confirmed, 0 waiting, 1 need a call.");
    expect(t.indexOf("Rivera Drywall")).toBeLessThan(t.indexOf("Acme Supply"));
    expect(t).toContain(
      "proposed Nov 14 instead of Nov 12 (Luis Rivera). Needs the super's or PM's call",
    );
  });

  it("cancels only on the member's yes", async () => {
    await expect(call({ action: "cancel", request_id: REQ })).rejects.toThrow(
      /confirm taking this request back/,
    );
    const out = await call({ action: "cancel", request_id: REQ, confirmed: true });
    expect(out.content[0]!.text).toContain("Cancelled the request to Acme Supply");
  });
});

describe("helpers", () => {
  it("keeps the link open past the date asked, capped at 30 days", () => {
    const now = new Date("2026-11-05T12:00:00Z");
    expect(linkExpiry(now, "2026-11-07").toISOString()).toBe("2026-11-19T12:00:00.000Z");
    expect(linkExpiry(now, "2026-11-25").toISOString()).toBe("2026-11-26T23:59:59.000Z");
    expect(linkExpiry(now, "2027-03-01").toISOString()).toBe("2026-12-05T12:00:00.000Z");
  });
  it("says when a request's email didn't go out", () => {
    expect(confirmLine(row({ email_status: "off" }) as ConfirmRow)).toContain("email not sent");
  });
});
