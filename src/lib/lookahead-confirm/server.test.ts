import { describe, expect, it } from "vitest";
import { tokenHash } from "../mcp/file-share";
import type { PortalEmail } from "../customer-portal/email";
import { CSRF_COOKIE, confirmCsrf, handleConfirmPage, type ConfirmDeps } from "./server";
import { answerNotice, type PublicView } from "./model";

const TOKEN = "T".repeat(43);
const COOKIE = "K".repeat(43);
const ORIGIN = "https://app.meetathena.io";
const ID = "00000000-0000-4000-8000-0000000000f1";
const JOB = "00000000-0000-4000-8000-0000000000f2";
const LOGO = "https://backend.example/storage/v1/object/public/company-logos/n.png";

const view = (over: Partial<PublicView> = {}): PublicView => ({
  id: ID,
  company: "Northline Electric",
  logo_url: LOGO,
  job_number: "2810",
  job_name: "Willow Creek",
  pm_name: "Pat Lee",
  party_kind: "supplier",
  party_name: "Acme Supply",
  ask_kind: "delivery",
  what: "Delivery of switchgear",
  asked_date: "2026-11-12",
  window_end: null,
  expires_at: "2026-11-19T00:00:00Z",
  answer: "asked",
  response_date: null,
  responder_name: null,
  response_note: null,
  responded_at: null,
  ...over,
});

type Call = { fn: string; args: Record<string, unknown> };
function deps(
  opts: { open?: unknown; respond?: unknown; logoOk?: boolean } = {},
): ConfirmDeps & { calls: Call[]; sent: PortalEmail[] } {
  const calls: Call[] = [];
  const sent: PortalEmail[] = [];
  return {
    calls,
    sent,
    today: () => "2026-11-05",
    logoOk: () => opts.logoOk ?? true,
    send: async (m) => {
      sent.push(m);
      return "sent";
    },
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "mcp_lookahead_confirm_open") return opts.open ?? { status: "ok", ...view() };
      if (fn === "mcp_lookahead_confirm_respond") return opts.respond;
      if (fn === "mcp_job_notice_record")
        return {
          notice_id: "00000000-0000-4000-8000-0000000000f9",
          created: true,
          topic: "field_confirm",
          title: args._title,
          detail: args._detail,
          actor: args._actor,
          job_number: "2810",
          job_name: "Willow Creek",
          company: "Northline Electric",
          recipients: [
            { email: "pat@example.com", role: "job_pm" },
            { email: "rico@example.com", role: "super" },
          ],
        };
      return null;
    },
  };
}

const get = (q = "", cookie?: string) =>
  new Request(`${ORIGIN}/l/${TOKEN}${q}`, { headers: cookie ? { cookie } : {} });
async function post(fields: Record<string, string>, h: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/l/${TOKEN}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${CSRF_COOKIE}=${COOKIE}`,
      ...h,
    },
    body: new URLSearchParams({ csrf: await confirmCsrf(COOKIE, TOKEN), ...fields }).toString(),
  });
}

describe("look-ahead confirmation page", () => {
  it("shows the contractor, the job, what and the date, with three choices and no cost", async () => {
    const d = deps();
    const res = await handleConfirmPage(get(), TOKEN, d);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(d.calls[0]).toEqual({
      fn: "mcp_lookahead_confirm_open",
      args: { _token_hash: await tokenHash(TOKEN) },
    });
    expect(body).toContain(`src="${LOGO}"`);
    expect(body).toContain("Job 2810 · Willow Creek");
    expect(body).toContain("Delivery of switchgear");
    expect(body).toContain("Thursday, Nov 12, 2026");
    expect(body).toContain("Confirm your delivery date");
    expect(body).toContain("Pat Lee at Northline Electric");
    expect(body).toContain("Confirm this date");
    expect(body).toContain("Propose another date");
    expect(body).toContain("Can't make it");
    expect(body).toContain("Powered by Athena");
    expect(body).toContain('name="name"');
    expect(body).not.toMatch(/\$|cost|markup|<script/i);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("set-cookie")).toMatch(
      new RegExp(`^${CSRF_COOKIE}=[A-Za-z0-9_-]{43}; Path=/l/${TOKEN}; HttpOnly; Secure; SameSite=Lax`),
    );
    // Phone, tablet and desktop layouts.
    expect(body).toContain('name="viewport"');
    expect(body).toMatch(/@media \(min-width:480px\)/);
    expect(body).toMatch(/@media \(min-width:640px\)/);
    expect(body).toMatch(/@media \(min-width:1024px\)/);
  });

  it("falls back to the contractor's name when the logo isn't theirs", async () => {
    const body = await (await handleConfirmPage(get(), TOKEN, deps({ logoOk: false }))).text();
    expect(body).not.toContain(LOGO);
    expect(body).toContain('<span class="lc-co">Northline Electric</span>');
  });

  it("puts the CSRF value from its cookie in every form", async () => {
    const body = await (
      await handleConfirmPage(get("?step=propose", `${CSRF_COOKIE}=${COOKIE}`), TOKEN, deps())
    ).text();
    expect(body).toContain(`value="${await confirmCsrf(COOKIE, TOKEN)}"`);
    expect(body).toContain('type="date"');
    expect(body).toContain('min="2026-11-05"');
    expect(body).toContain('value="proposed_new_date"');
    const decline = await (
      await handleConfirmPage(get("?step=decline", `${CSRF_COOKIE}=${COOKIE}`), TOKEN, deps())
    ).text();
    expect(decline).toContain('value="declined"');
    expect(decline).toContain("What's the problem?");
  });

  it("confirms the date, records a field notice for the team and shows thanks", async () => {
    const done = view({ answer: "confirmed", response_date: "2026-11-12", responder_name: "Maria Lopez" });
    const d = deps({ respond: { status: "ok", job_id: JOB, ...done } });
    const res = await handleConfirmPage(
      await post({ answer: "confirmed", name: "  Maria   Lopez " }),
      TOKEN,
      d,
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/l/${TOKEN}`);
    const respond = d.calls.find((c) => c.fn === "mcp_lookahead_confirm_respond")!;
    expect(respond.args).toMatchObject({
      _token_hash: await tokenHash(TOKEN),
      _answer: "confirmed",
      _date: null,
      _name: "Maria Lopez",
      _note: null,
    });
    const notice = d.calls.find((c) => c.fn === "mcp_job_notice_record")!;
    expect(notice.args).toMatchObject({
      _job: JOB,
      _topic: "field_confirm",
      _kind: "lookahead_confirmed",
      _title: "Acme Supply confirmed delivery Nov 12",
      _board_page: "lookahead",
      _dedupe_key: `lookahead_confirm:${ID}`,
      _ref_table: "mcp_lookahead_confirms",
      _ref_id: ID,
    });
    expect(d.sent.map((m) => m.to)).toEqual(["pat@example.com", "rico@example.com"]);

    const thanks = await (
      await handleConfirmPage(get(), TOKEN, deps({ open: { status: "ok", ...done } }))
    ).text();
    expect(thanks).toContain("Thanks, Maria");
    expect(thanks).toContain("You confirmed delivery on Thursday, Nov 12, 2026.");
    expect(thanks).not.toContain("<form");
  });

  it("records a proposed date as needing the team's call, without moving the date", async () => {
    const done = view({
      party_kind: "sub",
      party_name: "Rivera Drywall",
      ask_kind: "start",
      what: "Crew start, level 2 drywall",
      answer: "proposed_new_date",
      response_date: "2026-11-14",
      responder_name: "Luis Rivera",
      response_note: "Crew is on another job",
    });
    const d = deps({ respond: { status: "ok", job_id: JOB, ...done } });
    await handleConfirmPage(
      await post({ answer: "proposed_new_date", name: "Luis Rivera", date: "2026-11-14", note: "Crew is on another job" }),
      TOKEN,
      d,
    );
    const notice = d.calls.find((c) => c.fn === "mcp_job_notice_record")!.args;
    expect(notice._title).toBe("Rivera Drywall proposed Nov 14 instead of Nov 12");
    expect(notice._kind).toBe("lookahead_new_date");
    expect(notice._detail).toContain("needs the super's or PM's call");
    expect(notice._facts).toMatchObject({ asked_date: "2026-11-12", response_date: "2026-11-14", needs_call: true });
    const page = await (
      await handleConfirmPage(get(), TOKEN, deps({ open: { status: "ok", ...done } }))
    ).text();
    expect(page).toContain("You proposed Saturday, Nov 14, 2026 instead of Nov 12.");
    expect(page).toContain("the schedule still shows Nov 12");
  });

  it("shows the form again with what they typed when something is missing", async () => {
    const d = deps();
    const res = await handleConfirmPage(
      await post({ answer: "declined", name: "Kim Bolt", note: "" }),
      TOKEN,
      d,
    );
    expect(res.status).toBe(422);
    const body = await res.text();
    expect(body).toContain("Add a short note");
    expect(body).toContain('value="Kim Bolt"');
    expect(d.calls.some((c) => c.fn === "mcp_lookahead_confirm_respond")).toBe(false);

    const same = deps({ respond: { status: "invalid", reason: "same_date" } });
    const r2 = await handleConfirmPage(
      await post({ answer: "proposed_new_date", name: "Luis Rivera", date: "2026-11-12" }),
      TOKEN,
      same,
    );
    expect(r2.status).toBe(422);
    expect(await r2.text()).toContain("That&#39;s the date they asked for");
    const short = await handleConfirmPage(await post({ answer: "confirmed", name: "x" }), TOKEN, deps());
    expect(await short.text()).toContain("Type your name");
  });

  it("refuses a cross-site post, a wrong CSRF value and a post with no cookie", async () => {
    const d = deps({ respond: { status: "ok", job_id: JOB, ...view({ answer: "confirmed" }) } });
    const cross = await handleConfirmPage(
      await post({ answer: "confirmed", name: "Maria Lopez" }, { origin: "https://evil.example" }),
      TOKEN,
      d,
    );
    expect(cross.status).toBe(403);
    const bad = new Request(`${ORIGIN}/l/${TOKEN}`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
        cookie: `${CSRF_COOKIE}=${COOKIE}`,
      },
      body: "csrf=wrong&answer=confirmed&name=Maria+Lopez",
    });
    expect((await handleConfirmPage(bad, TOKEN, d)).status).toBe(403);
    const noCookie = await handleConfirmPage(
      await post({ answer: "confirmed", name: "Maria Lopez" }, { cookie: "" }),
      TOKEN,
      d,
    );
    expect(noCookie.status).toBe(303);
    expect(noCookie.headers.get("location")).toBe(`/l/${TOKEN}?e=session`);
    expect(d.calls.some((c) => c.fn === "mcp_lookahead_confirm_respond")).toBe(false);
  });

  it("turns away a wrong, expired or cancelled link", async () => {
    const bad = await handleConfirmPage(get(), "not-a-token", deps());
    expect(bad.status).toBe(404);
    const unknown = await handleConfirmPage(get(), TOKEN, deps({ open: { status: "unknown" } }));
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("This link isn&#39;t valid");
    const expired = await handleConfirmPage(
      get(),
      TOKEN,
      deps({ open: { status: "expired", company: "Northline Electric", logo_url: null } }),
    );
    expect(expired.status).toBe(410);
    expect(await expired.text()).toContain("Contact Northline Electric to confirm the date.");
    const cancelled = await handleConfirmPage(
      get(),
      TOKEN,
      deps({ open: { status: "cancelled", company: "Northline Electric" } }),
    );
    expect(await cancelled.text()).toContain("This request was taken back");
    const slow = await handleConfirmPage(
      await post({ answer: "confirmed", name: "Maria Lopez" }),
      TOKEN,
      deps({ respond: { status: "slow_down" } }),
    );
    expect(slow.status).toBe(429);
    const down = await handleConfirmPage(get(), TOKEN, { ...deps(), rpc: async () => { throw new Error("x"); } });
    expect(down.status).toBe(503);
  });

  it("re-records the notice once when an answer is already on file", async () => {
    const done = view({ answer: "confirmed", response_date: "2026-11-12", responder_name: "Maria Lopez" });
    const d = deps({ respond: { status: "answered", job_id: JOB, ...done } });
    const res = await handleConfirmPage(await post({ answer: "declined", name: "Maria Lopez", note: "No" }), TOKEN, d);
    expect(res.status).toBe(303);
    expect(d.calls.find((c) => c.fn === "mcp_job_notice_record")!.args._dedupe_key).toBe(
      `lookahead_confirm:${ID}`,
    );
  });
});

describe("answer notices", () => {
  it("names the party, the answer and the date in the title", () => {
    expect(answerNotice({ ...view({ answer: "confirmed", window_end: "2026-11-14" }), job_id: JOB }).title).toBe(
      "Acme Supply confirmed delivery Nov 12 to Nov 14",
    );
    const no = answerNotice({
      ...view({ answer: "declined", response_note: "Back ordered", responder_name: "Kim" }),
      job_id: JOB,
    });
    expect(no).toMatchObject({
      title: "Acme Supply can't make delivery Nov 12",
      kind: "lookahead_declined",
      actor: "Kim, Acme Supply",
      topic: "field_confirm",
    });
    expect(no.detail).toContain("Their note: Back ordered");
    expect(JSON.stringify(no)).not.toMatch(/cost|price|amount/i);
  });
});
