import { describe, expect, it } from "vitest";
import { tokenHash } from "../mcp/file-share";
import { willowCreekTypeE } from "../selections/__fixtures__/willow-creek-type-e";
import { customerProposal } from "../selections/proposal";
import { COMPARE_CSS } from "../selections/compare-page";
import {
  ATHENA_BLUE,
  ATHENA_EMAIL_LOGO_URL,
  ATHENA_NAVY,
} from "../email-templates/athena-auth-email";
import { codeEmail, inviteEmail, noticeEmail, type PortalEmail } from "./email";
import {
  codeHash,
  csrfFor,
  handleInvite,
  handlePortal,
  sameOrigin,
  sixDigits,
  type PortalDeps,
} from "./server";
import { customerCaption, PORTAL_SECTIONS, renderGone } from "./render";
import { replyEmail, replyToClient } from "./messages";

const ACCESS = "00000000-0000-4000-8000-0000000000aa";
const CO = "00000000-0000-4000-8000-0000000000c1";
const SEL = "00000000-0000-4000-8000-0000000000c2";
const PHOTO = "00000000-0000-4000-8000-0000000000p1".replace("p", "d");
const TOKEN = "A".repeat(43);
const SESSION = "S".repeat(43);
const FP = "f".repeat(64);
const ORIGIN = "https://app.meetathena.io";

const view = () => ({
  status: "ok",
  customer: { name: "Rosa Delgado", email: "rosa@example.com" },
  contractor: {
    name: "Northline Builders",
    pm_name: "Pat Lee",
    pm_title: "Project manager",
    pm_email: "pat@example.com",
  },
  job: {
    number: "2715",
    name: "Harbor Point Dental",
    completion_date: "2026-12-18",
    today: "2026-11-04",
  },
  updates: [
    {
      week_of: "2026-11-02",
      title: "Drywall is going up",
      body: "Exam rooms 1 to 4 are hung.\n\nInspection next week.",
    },
  ],
  dailies: [{ date: "2026-11-03", weather: "Clear", manpower: "8", work: ["Hung drywall"] }],
  photos: [
    {
      id: PHOTO,
      taken_on: "2026-11-03",
      area: "Exam room 2",
      work: "Drywall hung",
      storage_path: "jobs/secret-path.jpg",
    },
  ],
  milestones: [
    { name: "Rough-in inspection", date: "2026-11-10", done: false },
    { name: "Ready to move in", date: "2026-12-18", done: false },
  ],
  items: [
    {
      id: CO,
      kind: "change_order",
      shared_on: "2026-11-04",
      due_on: "2026-11-08",
      fingerprint: FP,
      view: {
        number: "PCO-004",
        title: "Exam room lights",
        why: "Brighter lights.",
        scope: "Swap 12 fixtures.",
        price_cents: 486000,
        schedule_days: 2,
        due_on: "2026-11-08",
      },
      decision: null,
    },
    {
      id: SEL,
      kind: "selection",
      shared_on: "2026-11-04",
      due_on: null,
      fingerprint: FP,
      view: { proposal: customerProposal(willowCreekTypeE(true), 3) },
      decision: null,
    },
  ],
});

function deps(
  over: Partial<{
    view: unknown;
    decide: unknown;
    issue: unknown;
    rpcs: Record<string, unknown>;
  }> = {},
) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const mail: PortalEmail[] = [];
  let n = 0;
  const d: PortalDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "mcp_portal_invite_open")
        return args._invite_hash === (await tokenHash(TOKEN))
          ? {
              status: "ok",
              access_id: ACCESS,
              email: "rosa@example.com",
              name: "Rosa Delgado",
              company: "Northline Builders",
              job_name: "Harbor Point Dental",
              job_number: "2715",
            }
          : { status: "unknown" };
      if (fn === "mcp_portal_code_issue") return over.issue ?? { status: "ok" };
      if (fn === "mcp_portal_sign_in") return { status: "ok", access_id: ACCESS };
      if (fn === "mcp_portal_view")
        return args._session_hash === (await tokenHash(SESSION))
          ? (over.view ?? view())
          : { status: "signed_out" };
      if (fn === "mcp_portal_decide")
        return over.decide ?? { status: "ok", decision_id: "d1", pm_email: "pat@example.com" };
      if (over.rpcs && fn in over.rpcs) return over.rpcs[fn];
      return { status: "ok" };
    },
    signPhotos: async (paths) =>
      new Map(paths.map((p) => [p, `https://storage.example.com/signed/${n++}`])),
    send: async (m) => {
      mail.push(m);
      return "sent";
    },
    emailOn: () => true,
    randomInt: () => 123456,
  };
  return { d, calls, mail };
}

const req = (
  path: string,
  init: RequestInit & { cookie?: boolean; origin?: string | null } = {},
) => {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", `other=1; athena_portal=${SESSION}`);
  if (init.method === "POST") {
    headers.set("content-type", "application/x-www-form-urlencoded");
    if (init.origin !== null) headers.set("origin", init.origin ?? ORIGIN);
  }
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
};
const post = async (
  path: string,
  body: Record<string, string>,
  opts: { cookie?: boolean; origin?: string | null } = {},
) => req(path, { method: "POST", body: new URLSearchParams(body).toString(), ...opts });

describe("same-origin posts", () => {
  const at = (h: Record<string, string>) =>
    new Request(`${ORIGIN}/c/i/${TOKEN}`, { method: "POST", headers: h });
  it("takes a null origin only when the browser says the post came from the same site", () => {
    // Chrome sends `Origin: null` on a same-origin form post under a no-referrer policy.
    expect(sameOrigin(at({ origin: "null", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(sameOrigin(at({ origin: "null" }))).toBe(false);
    expect(sameOrigin(at({ origin: "null", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameOrigin(at({ origin: "null", "sec-fetch-site": "none" }))).toBe(false);
    expect(sameOrigin(at({ origin: ORIGIN }))).toBe(true);
    expect(
      sameOrigin(at({ origin: "https://evil.example", "sec-fetch-site": "same-origin" })),
    ).toBe(false);
  });

  it("sends a same-origin referrer policy so the browser keeps the real origin on its own forms", async () => {
    const { d } = deps();
    const r = await handleInvite(req(`/c/i/${TOKEN}`), TOKEN, d);
    expect(r.headers.get("referrer-policy")).toBe("same-origin");
    expect(await r.text()).toContain('<meta name="referrer" content="same-origin">');
  });
});

describe("invite link", () => {
  it("refuses bad tokens and shows a sign-in start without the full address", async () => {
    const { d } = deps();
    expect((await handleInvite(req("/c/i/short"), "short", d)).status).toBe(404);
    expect((await handleInvite(req(`/c/i/${"B".repeat(43)}`), "B".repeat(43), d)).status).toBe(404);
    const r = await handleInvite(req(`/c/i/${TOKEN}`), TOKEN, d);
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("form-action 'self'");
    expect(html).toContain("r***@example.com");
    expect(html).not.toContain("rosa@example.com");
    expect(html).not.toMatch(/<script/i);
    // Sign-in wears Athena's own sign-in card: pale blue ground, blue rule and button, the mark beside the contractor.
    expect(html).toContain('class="as-card"');
    expect(html).toContain("#DBEAFE");
    // Client-facing: the contractor leads up top in Inter; Athena is the small A and line in the card footer.
    expect(html).toMatch(/<div class="as-brand"><span class="as-co"><b>[^<]+<\/b>/);
    expect(html).toMatch(/class="as-foot"><svg[^>]*>.*<\/svg><span>Powered by Athena<\/span>/);
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain("family=Inter");
    // It reads as the contractor's own invite to this job, on a client page.
    expect(html).toMatch(/<h1>[^<]+ invites you to your [^<]+ project page<\/h1>/);
    expect(html).toContain("<span>Client page</span>");
    expect(html).not.toContain("Customer page");
    // Sign-in trouble goes to Athena's support inbox; project questions go to the contractor.
    expect(html).toContain(
      'href="mailto:support@meetathena.io?subject=Help%20signing%20in%20to%20Athena"',
    );
    expect(html).not.toContain("alpcontractorcircle");
  });

  it("emails a code whose hash is what the database stores, then signs in with a cookie scoped to the page", async () => {
    const { d, calls, mail } = deps();
    expect(
      (
        await handleInvite(
          await post(`/c/i/${TOKEN}`, { action: "send_code" }, { origin: "https://evil.example" }),
          TOKEN,
          d,
        )
      ).status,
    ).toBe(403);
    const sent = await handleInvite(await post(`/c/i/${TOKEN}`, { action: "send_code" }), TOKEN, d);
    expect(sent.status).toBe(303);
    expect(sent.headers.get("location")).toBe(`/c/i/${TOKEN}?step=code&sent=1`);
    expect(mail[0]).toMatchObject({
      to: "rosa@example.com",
      subject: "123456 is your Northline Builders sign-in code",
    });
    const issue = calls.find((c) => c.fn === "mcp_portal_code_issue")!;
    expect(issue.args._code_hash).toBe(await codeHash(ACCESS, "123456"));
    expect(issue.args._invite_hash).toBe(await tokenHash(TOKEN));

    const signed = await handleInvite(
      await post(`/c/i/${TOKEN}`, { action: "verify", code: "123456", remember: "1" }),
      TOKEN,
      d,
    );
    expect(signed.status).toBe(303);
    expect(signed.headers.get("location")).toBe(`/c/${ACCESS}`);
    const cookie = signed.headers.get("set-cookie")!;
    expect(cookie).toMatch(
      new RegExp(
        `^athena_portal=[A-Za-z0-9_-]{43}; Path=/c/${ACCESS}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$`,
      ),
    );
    const si = calls.find((c) => c.fn === "mcp_portal_sign_in")!;
    expect(si.args._session_hash).toBe(await tokenHash(cookie.split(";")[0]!.split("=")[1]!));
    expect(si.args._session_hash).not.toBe(cookie.split(";")[0]!.split("=")[1]);
  });

  it("says when email is off instead of pretending a code went out", async () => {
    const { d } = deps();
    d.emailOn = () => false;
    const r = await handleInvite(await post(`/c/i/${TOKEN}`, { action: "send_code" }), TOKEN, d);
    expect(r.status).toBe(503);
    expect(await r.text()).toContain("Sign-in codes can&#39;t be sent right now");
  });
});

describe("customer page", () => {
  it("needs a session", async () => {
    const { d } = deps();
    const r = await handlePortal(req(`/c/${ACCESS}`), ACCESS, d);
    expect(r.status).toBe(401);
    expect(await r.text()).toContain("You&#39;re signed out");
    expect((await handlePortal(req("/c/not-a-uuid"), "not-a-uuid", d)).status).toBe(404);
  });

  it("renders every section in the Athena blue client look, with signed photos and no storage paths or scripts", async () => {
    const { d } = deps();
    for (const s of PORTAL_SECTIONS) {
      const r = await handlePortal(req(`/c/${ACCESS}?s=${s}`, { cookie: true }), ACCESS, d);
      const html = await r.text();
      expect(r.status, s).toBe(200);
      expect(html, s).not.toMatch(/<script/i);
      // Approved Nov 5: Athena blue hero over white cards, Powered by Athena in the footer.
      expect(html, s).toContain('<section class="cp-hero">');
      // The approved Good/Better/Best compare (round five) uses hero, act, co and co-sub classes of its
      // own; the portal's shell styles are prefixed cp- so they can't restyle it.
      for (const cls of ["hero", "act", "acts", "co", "co-sub", "co-logo", "co-word"])
        expect(html.replace(COMPARE_CSS, ""), `${s} .${cls}`).not.toMatch(
          new RegExp(`(?<![\\w-])\\.${cls}(?![\\w-])`),
        );
      expect(html, s).toContain("linear-gradient(160deg,#2f6cf2,#1a47c7)");
      expect(html, s).toContain("Powered by Athena");
      expect(html, s).not.toContain("secret-path");
      expect(html, s).toContain('aria-current="page"');
      expect(html, s).toContain("@media (max-width:640px)");
    }
    const home = await (
      await handlePortal(req(`/c/${ACCESS}`, { cookie: true }), ACCESS, d)
    ).text();
    expect(home).toContain("2 decisions waiting");
    expect(home).toContain("https://storage.example.com/signed/");
    expect(home).toContain("PCO-004 · Exam room lights");
  });

  it("opens any photo full size, with no script, and shows the client a clean caption", async () => {
    const v = view();
    v.photos.push({
      id: "33333333-3333-4333-8333-333333333333",
      taken_on: "2026-11-03",
      area: "Interior office / ceiling",
      work: "Progress photo of installed linear LED ceiling strips, recessed downlights, and accent wall lighting; documentation only, not evidence of duct-bank quantity.",
      storage_path: "jobs/second.jpg",
    });
    const { d } = deps({ view: v });
    const html = await (
      await handlePortal(req(`/c/${ACCESS}?s=photos`, { cookie: true }), ACCESS, d)
    ).text();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("documentation only");
    expect(html).not.toContain("duct-bank");
    expect(html).toContain(
      "Installed linear LED ceiling strips, recessed downlights, and accent wall lighting",
    );
    // Every photo, in the grid and in the hero, links to its own full-size slide; slides link to their neighbours.
    expect(html).toContain(`href="#ph-${PHOTO}"`);
    expect(html).toContain(`<section class="lb-slide" id="ph-${PHOTO}"`);
    expect(html).toContain(
      'href="#ph-33333333-3333-4333-8333-333333333333" aria-label="Next photo"',
    );
    expect(html).toContain(`href="#ph-${PHOTO}" aria-label="Previous photo"`);
    expect(html).toContain('class="lb-x" href="#_"');
    expect(html).toContain(".lb:has(.lb-slide:target)");
    expect(html.match(/<section class="lb-slide"/g)).toHaveLength(2);
  });

  it("keeps the contractor's record notes out of photo captions", () => {
    expect(
      customerCaption(
        "Progress photo showing linear LED strip lights and recessed fixtures through glass; documentation only, not evidence of November 3 duct-bank, sheetrock, or plumbing quantities.",
        "Interior office viewed through glass / ceiling",
      ),
    ).toBe("Linear LED strip lights and recessed fixtures through glass");
    expect(
      customerCaption("Drywall hung on the north wall. Taping starts Monday.", "Exam room 2"),
    ).toBe("Drywall hung on the north wall. Taping starts Monday.");
    expect(customerCaption("Documentation only; for the record.", "Exam room 2")).toBe(
      "Exam room 2",
    );
    expect(customerCaption(null, null)).toBe("Progress photo");
  });

  it("refuses a view carrying an unexpected field", async () => {
    const v = view();
    (v.items[0]!.view as Record<string, unknown>).cost_cents = 1;
    const { d } = deps({ view: v });
    expect((await handlePortal(req(`/c/${ACCESS}`, { cookie: true }), ACCESS, d)).status).toBe(503);
  });

  it("checks the form token and origin on every post", async () => {
    const { d, calls } = deps();
    expect(
      (
        await handlePortal(
          await post(`/c/${ACCESS}`, { action: "sign_out" }, { cookie: true }),
          ACCESS,
          d,
        )
      ).status,
    ).toBe(403);
    const csrf = await csrfFor(SESSION);
    expect(
      (
        await handlePortal(
          await post(
            `/c/${ACCESS}`,
            { action: "sign_out", csrf },
            { cookie: true, origin: "https://evil.example" },
          ),
          ACCESS,
          d,
        )
      ).status,
    ).toBe(403);
    const out = await handlePortal(
      await post(`/c/${ACCESS}`, { action: "sign_out", csrf }, { cookie: true }),
      ACCESS,
      d,
    );
    expect(out.status).toBe(303);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(calls.some((c) => c.fn === "mcp_portal_sign_out")).toBe(true);
  });

  it("approves a change order with a fresh emailed code, the typed name and the exact statement", async () => {
    const { d, calls, mail } = deps();
    const csrf = await csrfFor(SESSION);
    const start = await handlePortal(
      await post(`/c/${ACCESS}`, { action: "start", item: CO, csrf }, { cookie: true }),
      ACCESS,
      d,
    );
    expect(start.headers.get("location")).toBe(
      `/c/${ACCESS}?s=changes&i=${CO}&step=confirm&sent=1`,
    );
    expect(mail.at(-1)).toMatchObject({
      to: "rosa@example.com",
      subject: "123456 is your Northline Builders confirmation code",
    });
    expect(calls.find((c) => c.fn === "mcp_portal_code_issue")!.args).toMatchObject({
      _purpose: "decide",
      _item: CO,
      _session_hash: await tokenHash(SESSION),
    });

    const confirm = await (
      await handlePortal(
        req(`/c/${ACCESS}?s=changes&i=${CO}&step=confirm&sent=1`, { cookie: true }),
        ACCESS,
        d,
      )
    ).text();
    expect(confirm).toContain(
      "I approve PCO-004 · Exam room lights from Northline Builders for $4,860.00 and +2 days to the schedule",
    );
    expect(confirm).toContain('name="fingerprint" value="' + FP + '"');

    const base = {
      action: "decide",
      item: CO,
      decision: "approved",
      fingerprint: FP,
      typed_name: "Rosa  Delgado",
      code: "123456",
      csrf,
    };
    const noAgree = await handlePortal(
      await post(`/c/${ACCESS}`, base, { cookie: true }),
      ACCESS,
      d,
    );
    expect(noAgree.headers.get("location")).toContain("e=agree");
    expect(calls.some((c) => c.fn === "mcp_portal_decide")).toBe(false);

    const ok = await handlePortal(
      await post(`/c/${ACCESS}`, { ...base, agree: "1" }, { cookie: true }),
      ACCESS,
      d,
    );
    expect(ok.headers.get("location")).toBe(`/c/${ACCESS}?s=changes&i=${CO}&ok=approved`);
    const decided = calls.find((c) => c.fn === "mcp_portal_decide")!.args;
    expect(decided).toMatchObject({
      _decision: "approved",
      _choice: null,
      _typed_name: "Rosa Delgado",
      _fingerprint: FP,
      _code_hash: await codeHash(ACCESS, "123456"),
    });
    expect(decided._statement).toContain("is my electronic signature");
    expect(mail.at(-1)).toMatchObject({
      to: "pat@example.com",
      subject: "Customer approved: PCO-004 · Exam room lights",
    });
    expect(mail.at(-1)!.text).not.toContain("$");
  });

  it("keeps the customer on the form when the code is wrong", async () => {
    const { d, mail } = deps({ decide: { status: "wrong" } });
    const csrf = await csrfFor(SESSION);
    const r = await handlePortal(
      await post(
        `/c/${ACCESS}`,
        {
          action: "decide",
          item: CO,
          decision: "approved",
          fingerprint: FP,
          typed_name: "Rosa Delgado",
          code: "000000",
          agree: "1",
          csrf,
        },
        { cookie: true },
      ),
      ACCESS,
      d,
    );
    expect(r.headers.get("location")).toBe(`/c/${ACCESS}?s=changes&i=${CO}&step=confirm&e=wrong`);
    expect(mail).toHaveLength(0);
  });

  it("declines without a code and chooses a package with one", async () => {
    const { d, calls } = deps();
    const csrf = await csrfFor(SESSION);
    await handlePortal(
      await post(
        `/c/${ACCESS}`,
        {
          action: "decide",
          item: CO,
          decision: "declined",
          fingerprint: FP,
          typed_name: "Rosa Delgado",
          note: "Too much",
          csrf,
        },
        { cookie: true },
      ),
      ACCESS,
      d,
    );
    expect(calls.find((c) => c.fn === "mcp_portal_decide")!.args).toMatchObject({
      _decision: "declined",
      _code_hash: null,
      _note: "Too much",
    });

    const start = await handlePortal(
      await post(
        `/c/${ACCESS}`,
        { action: "start", item: SEL, choice: "better", csrf },
        { cookie: true },
      ),
      ACCESS,
      d,
    );
    expect(start.headers.get("location")).toBe(
      `/c/${ACCESS}?s=selections&i=${SEL}&step=confirm&sent=1&choice=better`,
    );
    const page = await (
      await handlePortal(req(start.headers.get("location")!, { cookie: true }), ACCESS, d)
    ).text();
    expect(page).toContain("Sign your choice");
    expect(page).toContain("You're choosing");
    expect(page).toContain('name="choice" value="better"');
    expect(page).toContain("What happens when you confirm");
    await handlePortal(
      await post(
        `/c/${ACCESS}`,
        {
          action: "decide",
          item: SEL,
          decision: "chosen",
          choice: "better",
          fingerprint: FP,
          typed_name: "Rosa Delgado",
          code: "123456",
          agree: "1",
          csrf,
        },
        { cookie: true },
      ),
      ACCESS,
      d,
    );
    expect(calls.filter((c) => c.fn === "mcp_portal_decide").at(-1)!.args).toMatchObject({
      _decision: "chosen",
      _choice: "better",
    });
  });
});

const PAY = "00000000-0000-4000-8000-0000000000e1";
const PAY_OLD = "00000000-0000-4000-8000-0000000000e2";
const payView = (number: string, end: string, due: number, prior: number) => ({
  number,
  period_start: `${end.slice(0, 8)}01`,
  period_end: end,
  original_contract_cents: 10000000,
  approved_changes_cents: 486000,
  contract_total_cents: 10486000,
  lines: [
    {
      item: "01",
      description: "Framing <and> trim",
      scheduled_cents: 6000000,
      previous_cents: 1500000,
      this_period_cents: 1000000,
      stored_cents: 500000,
      completed_to_date_cents: 3000000,
      percent_complete: 50,
    },
    {
      item: "02",
      description: "Electrical",
      scheduled_cents: 4486000,
      previous_cents: 0,
      this_period_cents: 0,
      stored_cents: 0,
      completed_to_date_cents: 0,
      percent_complete: 0,
    },
  ],
  totals: {
    completed_and_stored_cents: 3000000,
    retainage_percent: 10,
    retainage_cents: 300000,
    previous_certified_cents: prior,
    current_due_cents: due,
  },
});
const withPayApps = () => {
  const v = view();
  (v.items as unknown[]).push(
    {
      id: PAY,
      kind: "pay_app",
      shared_on: "2026-11-04",
      due_on: "2026-11-12",
      fingerprint: FP,
      view: payView("7", "2026-10-31", 1350000, 1350000),
      decision: null,
    },
    {
      id: PAY_OLD,
      kind: "pay_app",
      shared_on: "2026-10-03",
      due_on: null,
      fingerprint: FP,
      view: payView("Application 6", "2026-09-30", 1350000, 0),
      decision: {
        decision: "approved",
        choice: null,
        typed_name: "Rosa Delgado",
        decided_at: "2026-10-05T15:00:00Z",
        note: null,
        code_verified: true,
      },
    },
  );
  return v;
};

describe("billing: pay applications", () => {
  it("renders the Billing tab, home money panel and every billing view with phone and tablet rules", async () => {
    const { d } = deps({ view: withPayApps() });
    expect(PORTAL_SECTIONS).toContain("billing");
    const home = await (
      await handlePortal(req(`/c/${ACCESS}`, { cookie: true }), ACCESS, d)
    ).text();
    expect(home).toMatch(/>Billing<span class="count" aria-label="1 waiting">1<\/span><\/a>/);
    expect(home).toContain("3 decisions waiting");
    expect(home).toContain("Pay application · $13,500.00 due");
    expect(home).toContain("Approve by Nov 12 · 8 days");
    expect(home).toContain("Money at a glance");
    expect(home).toContain("$104,860.00");
    // Approved before this bill, this bill, and what's left of the contract.
    expect(home).toContain("<span>Approved</span><b>$13,500.00</b>");
    expect(home).toContain("<span>This bill</span><b>$13,500.00</b>");
    expect(home).toContain("<span>Remaining</span><b>$77,860.00</b>");
    for (const at of [
      `/c/${ACCESS}?s=billing`,
      `/c/${ACCESS}?s=billing&i=${PAY}`,
      `/c/${ACCESS}?s=billing&i=${PAY}&step=confirm`,
      `/c/${ACCESS}?s=billing&i=${PAY}&step=decline`,
      `/c/${ACCESS}?s=billing&i=${PAY_OLD}`,
    ]) {
      const r = await handlePortal(req(at, { cookie: true }), ACCESS, d);
      const html = await r.text();
      expect(r.status, at).toBe(200);
      expect(html, at).not.toMatch(/<script/i);
      expect(html, at).not.toContain("Framing <and>");
      expect(html, at).toContain("Framing &lt;and&gt; trim");
      expect(html, at).toContain("@media (max-width:640px){.pay-head");
      expect(html, at).toContain("@media (max-width:1000px){.pay-due");
      // Billing styles never use the compare's own class names, so they can't restyle it.
      for (const cls of [
        "hero",
        "act",
        "acts",
        "co",
        "co-sub",
        "big",
        "seg",
        "bar",
        "row",
        "col",
        "line",
        "tag",
        "pin",
        "cap",
      ])
        expect(html.replace(COMPARE_CSS, ""), `${at} .${cls}`).not.toMatch(
          new RegExp(`(?<![\\w-])\\.${cls}(?![\\w-])`),
        );
    }
    const list = await (
      await handlePortal(req(`/c/${ACCESS}?s=billing`, { cookie: true }), ACCESS, d)
    ).text();
    expect(list).toContain("Latest pay application · Oct 1, 2026 to Oct 31, 2026");
    expect(list).toContain('<p class="pay-due">$13,500.00<span>due now</span></p>');
    expect(list).toContain("Work done and materials stored");
    expect(list).toContain("Held back, 10% (retainage)");
    expect(list).toContain("You keep it until the job is finished and accepted.");
    expect(list).toContain("Already approved</dt><dd>−$13,500.00");
    expect(list).toContain("Due now</dt><dd>$13,500.00");
    expect(list).toContain("Work by line");
    expect(list).toContain('class="cp-seg cp-now" style="width:16.67%"');
    expect(list).toContain("Billing history");
    expect(list).toContain('<span class="pill wait">Needs you</span>');
    expect(list).toContain('<span class="pill ok">Approved Oct 5, 2026</span>');
    // A number that already says Application keeps its own words.
    expect(list).toContain("<h3>Application 6</h3>");
    expect(list).toContain("Your contract");
    expect(list).toContain("<dt>Approved change orders</dt><dd>+$4,860.00</dd>");
    // Home without a shared pay application has no money panel.
    const { d: plain } = deps();
    expect(
      await (await handlePortal(req(`/c/${ACCESS}`, { cookie: true }), ACCESS, plain)).text(),
    ).not.toContain("Money at a glance");
    expect(
      await (
        await handlePortal(req(`/c/${ACCESS}?s=billing`, { cookie: true }), ACCESS, plain)
      ).text(),
    ).toContain("No pay applications shared with you yet.");
  });

  it("refuses a pay application view carrying a cost, fee or note", async () => {
    for (const extra of [
      (v: Record<string, unknown>) => (v.fee_pct = 10),
      (v: Record<string, unknown>) => ((v.lines as Record<string, unknown>[])[0]!.cost_cents = 1),
      (v: Record<string, unknown>) => ((v.totals as Record<string, unknown>).reason = "x"),
    ]) {
      const v = withPayApps();
      extra(
        (v.items as { id: string; view: Record<string, unknown> }[]).find((i) => i.id === PAY)!
          .view,
      );
      const { d } = deps({ view: v });
      expect(
        (await handlePortal(req(`/c/${ACCESS}?s=billing`, { cookie: true }), ACCESS, d)).status,
      ).toBe(503);
    }
  });

  it("approves a pay application with a fresh code, the typed name and the pay application statement", async () => {
    const { d, calls, mail } = deps({ view: withPayApps() });
    const csrf = await csrfFor(SESSION);
    const start = await handlePortal(
      await post(`/c/${ACCESS}`, { action: "start", item: PAY, csrf }, { cookie: true }),
      ACCESS,
      d,
    );
    expect(start.headers.get("location")).toBe(
      `/c/${ACCESS}?s=billing&i=${PAY}&step=confirm&sent=1`,
    );
    expect(mail.at(-1)!.text).toContain("confirm your decision on Payment Application 7");
    const confirm = await (
      await handlePortal(req(start.headers.get("location")!, { cookie: true }), ACCESS, d)
    ).text();
    const statement =
      "I approve Payment Application 7 from Northline Builders for $13,500.00 due for work through Oct 31, 2026, as described on this page. I understand that typing my name and confirming with the emailed code is my electronic signature.";
    expect(confirm).toContain(statement);
    expect(confirm).toContain("Approve pay application");
    expect(confirm).toContain('name="agree" value="1" required');
    expect(confirm).toContain('name="fingerprint" value="' + FP + '"');
    const base = {
      action: "decide",
      item: PAY,
      decision: "approved",
      fingerprint: FP,
      typed_name: "Rosa Delgado",
      code: "123456",
      csrf,
    };
    expect(
      (
        await handlePortal(await post(`/c/${ACCESS}`, base, { cookie: true }), ACCESS, d)
      ).headers.get("location"),
    ).toContain("e=agree");
    // A pay application takes approve or decline, never a package choice.
    expect(
      (
        await handlePortal(
          await post(
            `/c/${ACCESS}`,
            { ...base, decision: "chosen", choice: "good", agree: "1" },
            { cookie: true },
          ),
          ACCESS,
          d,
        )
      ).headers.get("location"),
    ).toContain("e=invalid");
    expect(calls.some((c) => c.fn === "mcp_portal_decide")).toBe(false);
    const ok = await handlePortal(
      await post(`/c/${ACCESS}`, { ...base, agree: "1" }, { cookie: true }),
      ACCESS,
      d,
    );
    expect(ok.headers.get("location")).toBe(`/c/${ACCESS}?s=billing&i=${PAY}&ok=approved`);
    expect(calls.find((c) => c.fn === "mcp_portal_decide")!.args).toMatchObject({
      _decision: "approved",
      _choice: null,
      _statement: statement,
      _code_hash: await codeHash(ACCESS, "123456"),
    });
    const pm = mail.at(-1)!;
    expect(pm).toMatchObject({
      to: "pat@example.com",
      subject: "Customer approved: Payment Application 7",
    });
    expect(pm.text).toContain("Nothing in billing changed");
    expect(pm.text).not.toContain("$");
  });

  it("declines a pay application without a code and shows the receipt once decided", async () => {
    const { d, calls } = deps({ view: withPayApps() });
    const csrf = await csrfFor(SESSION);
    const r = await handlePortal(
      await post(
        `/c/${ACCESS}`,
        {
          action: "decide",
          item: PAY,
          decision: "declined",
          fingerprint: FP,
          typed_name: "Rosa Delgado",
          note: "Line 01 looks high",
          csrf,
        },
        { cookie: true },
      ),
      ACCESS,
      d,
    );
    expect(r.headers.get("location")).toBe(`/c/${ACCESS}?s=billing&i=${PAY}&ok=declined`);
    expect(calls.find((c) => c.fn === "mcp_portal_decide")!.args).toMatchObject({
      _decision: "declined",
      _code_hash: null,
      _statement: "I decline Payment Application 7 from Northline Builders.",
    });
    const receipt = await (
      await handlePortal(req(`/c/${ACCESS}?s=billing&i=${PAY_OLD}`, { cookie: true }), ACCESS, d)
    ).text();
    expect(receipt).toContain('class="receipt"');
    expect(receipt).toContain("With a code emailed to you");
    expect(receipt).not.toContain('name="action" value="start"');
  });

  it("emails the customer that a pay application needs their approval", () => {
    const m = noticeEmail({
      to: "rosa@example.com",
      name: "Rosa Delgado",
      company: "Northline Builders",
      jobName: "Harbor Point Dental",
      link: `${ORIGIN}/c/${ACCESS}`,
      kind: "decision",
      label: "Payment Application 7",
      item: "pay_app",
      nonce: "n",
    });
    expect(m.subject).toBe(
      "Northline Builders sent a pay application for your approval: Payment Application 7",
    );
    expect(m.text).toContain(
      "Northline Builders sent Payment Application 7 for Harbor Point Dental. It needs your review and approval.",
    );
    expect(m.html).toContain("A pay application needs your approval");
  });
});

describe("package choice follows the job's contract stage", () => {
  const page = async (under: boolean | undefined, path = `/c/${ACCESS}?s=selections&i=${SEL}`) => {
    const v = view();
    const { d } = deps({ view: { ...v, job: { ...v.job, under_contract: under } } });
    const html = await (await handlePortal(req(path, { cookie: true }), ACCESS, d)).text();
    return html.replace(/>Change orders</g, "><"); // the page's own tab name
  };

  it("keeps the approved compare look inside the client page's own styles", async () => {
    const html = await page(false);
    const gbb = html.slice(html.indexOf('<div class="gbb">'));
    expect(gbb).toContain('<section class="gbb-hero">');
    expect(gbb).toContain('<div class="gbb-act">');
    // The client page styles bare .hero (blue blueprint hero) and .act (grey card); the compare uses neither.
    expect(gbb).not.toMatch(/class="(?:hero|act)"/);
  });

  it("before a contract, choosing sets the proposal price and never says change order", async () => {
    const html = await page(false);
    expect(html).toContain("its total becomes your proposal price");
    expect(html).toContain("Choose Better");
    expect(html).toContain('name="action" value="start"');
    expect(html).not.toMatch(/change order/i);
    expect(html).not.toMatch(/<a [^>]*href="https:\/\/lighting/);
    const confirm = await page(
      false,
      `/c/${ACCESS}?s=selections&i=${SEL}&step=confirm&sent=1&choice=best`,
    );
    expect(confirm).toContain("Your proposal price becomes the Best total of");
    expect(confirm).not.toMatch(/change order/i);
  });

  it("under contract, an upgrade is added by change order the customer approves", async () => {
    const html = await page(true);
    expect(html).toContain(
      "Choosing another package approves the difference as a change order to your contract",
    );
    const confirm = await page(
      true,
      `/c/${ACCESS}?s=selections&i=${SEL}&step=confirm&sent=1&choice=best`,
    );
    expect(confirm).toContain("Approve your change order");
    expect(confirm).toContain(
      "Confirming approves a change order to your contract for +$1,686.00.",
    );
    // The time is stated right before the code, and the button says what it does.
    const form = confirm.slice(confirm.indexOf("Approve your change order"));
    expect(form.indexOf("No additional time is necessary for this change.")).toBeLessThan(
      form.indexOf('name="code"'),
    );
    expect(form).toContain("Approve change order</button>");
  });

  it("tells the PM whether a change order was drafted", async () => {
    const { d, mail } = deps({
      decide: {
        status: "ok",
        decision_id: "d1",
        pm_email: "pat@example.com",
        under_contract: true,
        difference_cents: 168600,
        schedule_days: 0,
        change_order_number: "PCO-005",
        co_number: "CO-002",
      },
    });
    const csrf = await csrfFor(SESSION);
    await handlePortal(
      await post(
        `/c/${ACCESS}`,
        {
          action: "decide",
          item: SEL,
          decision: "chosen",
          choice: "best",
          fingerprint: FP,
          typed_name: "Rosa Delgado",
          code: "123456",
          agree: "1",
          csrf,
        },
        { cookie: true },
      ),
      ACCESS,
      d,
    );
    const m = mail.at(-1)!;
    expect(m.text).toContain(
      "the customer's signed choice approved change order CO-002 (PCO-005) for the package difference of $1,686.00, with no added time",
    );
    const { d: d2, mail: mail2 } = deps({
      decide: {
        status: "ok",
        decision_id: "d2",
        pm_email: "pat@example.com",
        under_contract: false,
      },
    });
    await handlePortal(
      await post(
        `/c/${ACCESS}`,
        {
          action: "decide",
          item: SEL,
          decision: "chosen",
          choice: "best",
          fingerprint: FP,
          typed_name: "Rosa Delgado",
          code: "123456",
          agree: "1",
          csrf,
        },
        { cookie: true },
      ),
      ACCESS,
      d2,
    );
    expect(mail2.at(-1)!.text).toContain("this is a proposal approval, not a change order");
  });
});

describe("codes", () => {
  it("are six digits and skip the biased top of the range", () => {
    const seq = [4_294_967_295, 4_294_000_000, 7];
    expect(sixDigits(() => seq.shift()!)).toBe("000007");
    expect(sixDigits(() => 999_999)).toBe("999999");
  });
});

describe("customer emails", () => {
  const invite = inviteEmail({
    to: "rosa@example.com",
    name: "Rosa Diaz",
    company: "ALP Construction",
    jobName: "Harbor Residence",
    pmName: "Sam Lee",
    link: "https://app.meetathena.io/c/i/x",
    expires: "Nov 18",
    nonce: "n",
  });
  const code = codeEmail({
    to: "rosa@example.com",
    name: "Rosa Diaz",
    company: "ALP Construction",
    jobName: "Harbor Residence",
    code: "123456",
    purpose: "sign_in",
    nonce: "n",
  });
  it("match Athena's sign-in emails with the contractor up top and Athena small underneath", () => {
    for (const m of [invite, code]) {
      expect(m.html).toContain(ATHENA_BLUE);
      expect(m.html).toContain(ATHENA_NAVY);
      expect(m.html).toMatch(/font-weight:700[^>]*>ALP Construction<\/p>/);
      expect(m.html).toContain(">Client page</p>");
      // The A is only the 16px corner mark beside "Powered by Athena".
      expect(m.html).toContain(`<img src="${ATHENA_EMAIL_LOGO_URL}" width="16"`);
      expect(m.html).not.toContain('width="56"');
      expect(m.html).toContain("Powered by Athena</p>");
    }
    expect(invite.subject).toBe(
      "ALP Construction invites you to your Harbor Residence project page",
    );
    expect(invite.html).toContain(
      ">ALP Construction invites you to your Harbor Residence project page</h1>",
    );
    expect(invite.html).toContain("Sam Lee at ALP Construction set up this private page for you.");
    expect(invite.html).not.toContain("Customer page");
    expect(invite.html).toContain('href="https://app.meetathena.io/c/i/x"');
    expect(code.html).toContain(">Your sign-in code</h1>");
    expect(code.html).toMatch(/letter-spacing:8px[^>]*>123456<\/p>/);
  });
  it("keep the designed look on a computer and stay readable in the Gmail phone apps' dark mode", () => {
    expect(invite.html).toContain('<meta name="supported-color-schemes" content="light">');
    expect(invite.html).toContain('<body class="body"');
    // No forced-white background: on iOS it stays white while Gmail flips the text pale on top of it.
    expect(invite.html).not.toContain("linear-gradient(#FFFFFF");
    expect(code.html).not.toContain("linear-gradient(#F2F6FF");
    // The button keeps the design's blue, from the style block (Android) and inline (iOS).
    expect(invite.html).toMatch(
      /\.ath-panel\{[^}]*background-image:linear-gradient\(#1E5FED,#1E5FED\)/,
    );
    expect(invite.html).toMatch(/u \+ \.body \.gm-screen\{[^}]*mix-blend-mode:screen/);
    expect(invite.html).toContain(
      '<span class="gm-screen"><span class="gm-diff">Open your project page</span></span>',
    );
    // The code keeps its pale blue box and navy digits as plain colours, so dark mode darkens it with the card.
    expect(code.html).toMatch(
      /background-color:#F2F6FF;color:#0F1E3D;[^>]*letter-spacing:8px[^>]*>123456<\/p>/,
    );
  });
  it("show the contractor's saved logo when there is one, and only an https one", () => {
    const base = {
      to: "a@b.co",
      name: "Rosa",
      company: "ALP Construction",
      jobName: "J",
      code: "123456",
      purpose: "sign_in" as const,
      nonce: "n",
    };
    const withLogo = codeEmail({ ...base, logo: "https://cdn.example.com/alp.png" });
    expect(withLogo.html).toContain(
      '<img src="https://cdn.example.com/alp.png" height="48" alt="ALP Construction"',
    );
    expect(withLogo.html).not.toMatch(/font-weight:700[^>]*>ALP Construction<\/p>/);
    const bad = codeEmail({ ...base, logo: 'javascript:alert(1)"' });
    expect(bad.html).not.toContain("javascript:");
    expect(bad.html).toMatch(/font-weight:700[^>]*>ALP Construction<\/p>/);
  });
  it("escape what the contractor and customer typed", () => {
    const m = inviteEmail({
      to: "a@b.co",
      name: "<b>x</b>",
      company: "A & B <Build>",
      jobName: "J",
      pmName: null,
      link: "https://app.meetathena.io/c/i/x",
      expires: "Nov 18",
      nonce: "n",
    });
    expect(m.html).toContain("A &amp; B &lt;Build&gt;");
    expect(m.html).not.toContain("<b>x</b>");
  });
});

describe("sign-in screens", () => {
  it("show the contractor's saved https logo up top, and their name otherwise", () => {
    const withLogo = renderGone("expired", "ALP Construction", "https://cdn.example.com/alp.png");
    expect(withLogo).toContain(
      '<img class="as-logo" src="https://cdn.example.com/alp.png" alt="ALP Construction">',
    );
    const bad = renderGone("expired", "ALP Construction", "http://cdn.example.com/alp.png");
    expect(bad).not.toContain(`class="as-logo"`);
    expect(bad).toContain("<b>ALP Construction</b>");
  });
  it("name the contractor instead of 'your contractor' when they know who it is", () => {
    expect(renderGone("expired", "ALP Construction")).toContain(
      "Ask ALP Construction to send you a new invite.",
    );
    expect(renderGone("revoked", "ALP Construction")).toContain(
      "ALP Construction turned off access. Contact ALP Construction if you think",
    );
    expect(renderGone("expired")).toContain("Ask your contractor to send you a new invite.");
  });
});

describe("the contractor's saved logo on the customer page", () => {
  const LOGO = "https://x.supabase.co/storage/v1/object/public/company-logos/northline.png";

  it("leads the sign-in screen, the page header and the code email when the contractor has one", async () => {
    const { d, mail } = deps();
    const asked: string[] = [];
    d.logo = async (a) => {
      asked.push(a);
      return LOGO;
    };
    const invite = await (await handleInvite(req(`/c/i/${TOKEN}`), TOKEN, d)).text();
    expect(invite).toContain(`class="as-logo" src="${LOGO}"`);
    await handleInvite(await post(`/c/i/${TOKEN}`, { action: "send_code" }), TOKEN, d);
    expect(mail.at(-1)!.html).toContain(`src="${LOGO}"`);
    const page = await (
      await handlePortal(req(`/c/${ACCESS}`, { cookie: true }), ACCESS, d)
    ).text();
    expect(page).toContain(`<img class="cp-co-img" src="${LOGO}" alt="Northline Builders">`);
    expect(asked.every((a) => a === ACCESS)).toBe(true);
  });

  it("keeps the initials and name when there is no logo or the lookup fails", async () => {
    const { d } = deps();
    d.logo = async () => {
      throw new Error("down");
    };
    const page = await (
      await handlePortal(req(`/c/${ACCESS}`, { cookie: true }), ACCESS, d)
    ).text();
    expect(page).not.toContain(`class="cp-co-img"`);
    expect(page).toContain("<b>Northline Builders</b>");
  });
});

const JOB = "00000000-0000-4000-8000-0000000000b1";
const MSG = "00000000-0000-4000-8000-0000000000f1";

/** deps() plus the messages functions and a job notice recorder that keeps what it was asked to record. */
function withNotices(
  over: Partial<{
    view: unknown;
    decide: unknown;
    post: unknown;
    thread: unknown;
    job: unknown;
  }> = {},
) {
  const base = deps({ view: over.view, decide: over.decide });
  const notices: Record<string, unknown>[] = [];
  const teamMail: PortalEmail[] = [];
  const rpc = base.d.rpc;
  base.d.rpc = async (fn, args) => {
    if (fn === "mcp_portal_messages") {
      base.calls.push({ fn, args });
      return (
        over.thread ?? {
          status: "ok",
          unread: 1,
          messages: [
            {
              id: MSG,
              author_kind: "client",
              author_name: "Rosa Delgado",
              body: "Can we <b>see</b> the fixture?",
              created_at: "2026-11-04T15:00:00Z",
              item_id: CO,
              about_label: "PCO-004 · Exam room lights",
            },
            {
              id: "00000000-0000-4000-8000-0000000000f2",
              author_kind: "team",
              author_name: "Pat Lee",
              body: "Yes, I'll bring one Monday.",
              created_at: "2026-11-04T16:00:00Z",
              item_id: null,
              about_label: null,
            },
          ],
        }
      );
    }
    if (fn === "mcp_portal_message_post") {
      base.calls.push({ fn, args });
      return (
        over.post ?? {
          status: "ok",
          message_id: MSG,
          created_at: "2026-11-04T15:00:00Z",
          job_id: JOB,
          job_number: "2715",
          job_name: "Harbor Point Dental",
          customer: "Rosa Delgado",
          item_id: args._item ?? null,
          about_kind: args._item ? "change_order" : null,
          about_label: args._item ? "PCO-004 · Exam room lights" : null,
        }
      );
    }
    if (fn === "mcp_portal_decision_job") {
      base.calls.push({ fn, args });
      return over.job === undefined ? JOB : over.job;
    }
    return rpc(fn, args);
  };
  base.d.notice = {
    rpc: async (fn, args) => {
      if (fn === "mcp_job_notice_record") {
        notices.push(args);
        return {
          notice_id: `n${notices.length}`,
          created: true,
          topic: args._topic,
          title: args._title,
          detail: args._detail,
          actor: args._actor,
          job_number: "2715",
          job_name: "Harbor Point Dental",
          company: "Northline Builders",
          recipients: [{ email: "pat@example.com", role: "job_pm" }],
        };
      }
      return null;
    },
    send: async (m) => {
      teamMail.push(m);
      return "sent";
    },
  };
  return { ...base, notices, teamMail };
}

const decidePost = async (d: PortalDeps, body: Record<string, string>) =>
  handlePortal(
    await post(
      `/c/${ACCESS}`,
      { typed_name: "Rosa Delgado", fingerprint: FP, csrf: await csrfFor(SESSION), ...body },
      { cookie: true },
    ),
    ACCESS,
    d,
  );

describe("job notices for client decisions", () => {
  it("records one notice per decision with the price and days, and the PM gets no second email", async () => {
    const { d, mail, notices, teamMail } = withNotices();
    const r = await decidePost(d, {
      action: "decide",
      item: CO,
      decision: "approved",
      code: "123456",
      agree: "1",
    });
    expect(r.headers.get("location")).toBe(`/c/${ACCESS}?s=changes&i=${CO}&ok=approved`);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      _job: JOB,
      _topic: "client_decision",
      _kind: "co_approved",
      _title: "Rosa Delgado approved PCO-004 · Exam room lights",
      _actor: "Rosa Delgado",
      _ref_table: "mcp_portal_decisions",
      _ref_id: "d1",
      _board_page: "cos",
      _dedupe_key: "portal-decision:d1",
      _facts: { decision: "approved", amount_cents: 486000, days: 2 },
    });
    expect(JSON.stringify(notices[0])).not.toMatch(/cost|markup|fee_pct/);
    // The notice email replaces the old decision email, so the PM hears once.
    expect(teamMail.map((m) => m.to)).toEqual(["pat@example.com"]);
    expect(mail.some((m) => m.subject.startsWith("Customer approved"))).toBe(false);
  });

  it("files pay applications under billing and package picks under change orders, with the CO number when there is one", async () => {
    const pay = withNotices({ view: withPayApps() });
    await decidePost(pay.d, {
      action: "decide",
      item: PAY,
      decision: "declined",
      note: "Retainage looks high",
    });
    expect(pay.notices[0]).toMatchObject({
      _kind: "pay_app_declined",
      _title: "Rosa Delgado declined Payment Application 7",
      _board_page: "billing",
      _facts: { decision: "declined", amount_cents: 1350000, period_end: "2026-10-31" },
    });
    expect(pay.notices[0]!._detail).toContain("Their note: Retainage looks high");

    // With the change terms result: the pick approved a change order, named in the title.
    const sel = withNotices({
      decide: {
        status: "ok",
        decision_id: "d3",
        pm_email: "pat@example.com",
        under_contract: true,
        difference_cents: 168600,
        change_order_number: "PCO-005",
        co_number: "CO-003",
        schedule_days: 2,
      },
    });
    await decidePost(sel.d, {
      action: "decide",
      item: SEL,
      decision: "chosen",
      choice: "best",
      code: "123456",
      agree: "1",
    });
    expect(sel.notices[0]).toMatchObject({
      _kind: "choice_made",
      _board_page: "cos",
      _facts: { choice: "best", difference_cents: 168600, days: 2, co_number: "CO-003" },
    });
    expect(sel.notices[0]!._title).toMatch(/^Rosa Delgado chose Best for .+, approving CO-003$/);

    // Without it (before the change terms migration) the same pick still records, with no CO number.
    const old = withNotices({
      decide: { status: "ok", decision_id: "d4", pm_email: "pat@example.com" },
    });
    await decidePost(old.d, {
      action: "decide",
      item: SEL,
      decision: "chosen",
      choice: "better",
      code: "123456",
      agree: "1",
    });
    expect(old.notices[0]!._title).toMatch(/^Rosa Delgado chose Better for [^,]+$/);
    expect(old.notices[0]!._facts).not.toHaveProperty("co_number");
  });

  it("falls back to emailing the PM when the notice can't be recorded", async () => {
    const { d, mail, notices } = withNotices({ job: null });
    await decidePost(d, {
      action: "decide",
      item: CO,
      decision: "approved",
      code: "123456",
      agree: "1",
    });
    expect(notices).toHaveLength(0);
    expect(mail.at(-1)).toMatchObject({
      to: "pat@example.com",
      subject: "Customer approved: PCO-004 · Exam room lights",
    });
  });
});

describe("client messages on the customer page", () => {
  it("shows the thread escaped, marks replies read only on the Messages tab, and counts them elsewhere", async () => {
    const { d, calls } = withNotices();
    const home = await (
      await handlePortal(req(`/c/${ACCESS}`, { cookie: true }), ACCESS, d)
    ).text();
    expect(home).toMatch(/>Messages<span class="count" aria-label="1 new">1<\/span><\/a>/);
    expect(calls.find((c) => c.fn === "mcp_portal_messages")!.args._mark_read).toBe(false);
    const page = await (
      await handlePortal(req(`/c/${ACCESS}?s=messages`, { cookie: true }), ACCESS, d)
    ).text();
    expect(calls.filter((c) => c.fn === "mcp_portal_messages").at(-1)!.args._mark_read).toBe(true);
    expect(page).toContain("Can we &lt;b&gt;see&lt;/b&gt; the fixture?");
    expect(page).not.toContain("<b>see</b>");
    expect(page).toContain("About PCO-004 · Exam room lights");
    expect(page).toContain("Pat Lee");
    expect(page).toContain('name="action" value="message"');
    expect(page).toContain(`name="csrf" value="${await csrfFor(SESSION)}"`);
    expect(page).toContain('maxlength="4000"');
    expect(page).not.toMatch(/>Messages<span class="count"/);
    expect(page).toContain("@media (max-width:640px){.cp-msg{");
    expect(page).toContain("@media (max-width:1000px){.cp-msg{");
    expect(page).not.toMatch(/<script/i);
  });

  it("puts 'Ask a question about this' beside the decision, outside every signing form", async () => {
    const { d } = withNotices({ view: withPayApps() });
    const ask = `/c/${ACCESS}?s=messages&amp;about=`;
    for (const [path, id] of [
      [`/c/${ACCESS}?s=changes&i=${CO}`, CO],
      [`/c/${ACCESS}?s=billing&i=${PAY}`, PAY],
      [`/c/${ACCESS}?s=billing&i=${PAY_OLD}`, PAY_OLD],
      [`/c/${ACCESS}?s=selections&i=${SEL}`, SEL],
    ] as const) {
      const html = await (await handlePortal(req(path, { cookie: true }), ACCESS, d)).text();
      expect(html, path).toContain(`${ask}${id}#write">Ask a question about this</a>`);
      // Never inside a form: every form closes before the link, or opens after it.
      for (const f of html.match(/<form[\s\S]*?<\/form>/g) ?? [])
        expect(f, path).not.toContain("Ask a question about this");
    }
    for (const step of ["confirm", "decline"]) {
      const html = await (
        await handlePortal(
          req(`/c/${ACCESS}?s=changes&i=${CO}&step=${step}`, { cookie: true }),
          ACCESS,
          d,
        )
      ).text();
      expect(html, step).not.toContain("Ask a question about this");
    }
    // The link opens Messages with the item named and posted along with the message.
    const page = await (
      await handlePortal(req(`/c/${ACCESS}?s=messages&about=${CO}`, { cookie: true }), ACCESS, d)
    ).text();
    expect(page).toContain("About <b>PCO-004 · Exam room lights</b>");
    expect(page).toContain(`name="about" value="${CO}"`);
  });

  it("posts with the form token and origin, records the notice, and confirms it was sent", async () => {
    const { d, calls, notices } = withNotices();
    const csrf = await csrfFor(SESSION);
    const send = (body: Record<string, string>, origin?: string) =>
      handlePortal(
        req(`/c/${ACCESS}`, {
          method: "POST",
          body: new URLSearchParams(body).toString(),
          cookie: true,
          ...(origin ? { origin } : {}),
        }),
        ACCESS,
        d,
      );
    expect((await send({ action: "message", body: "Hi" })).status).toBe(403);
    expect(
      (await send({ action: "message", body: "Hi", csrf }, "https://evil.example")).status,
    ).toBe(403);
    expect(calls.some((c) => c.fn === "mcp_portal_message_post")).toBe(false);

    const empty = await send({ action: "message", body: "   ", csrf, about: CO });
    expect(empty.headers.get("location")).toBe(`/c/${ACCESS}?s=messages&about=${CO}&e=msg_invalid`);
    const long = await send({ action: "message", body: "x".repeat(4001), csrf });
    expect(long.headers.get("location")).toContain("e=msg_invalid");

    const ok = await send({
      action: "message",
      body: "  Can we see it?\r\nThanks  ",
      csrf,
      about: CO,
    });
    expect(ok.headers.get("location")).toBe(`/c/${ACCESS}?s=messages&ok=sent#latest`);
    expect(calls.find((c) => c.fn === "mcp_portal_message_post")!.args).toMatchObject({
      _access: ACCESS,
      _session_hash: await tokenHash(SESSION),
      _item: CO,
      _body: "Can we see it?\nThanks",
    });
    expect(notices[0]).toMatchObject({
      _job: JOB,
      _topic: "client_message",
      _kind: "client_question",
      _title: "Rosa Delgado asked about PCO-004 · Exam room lights",
      _detail: "Can we see it?\nThanks",
      _ref_table: "mcp_portal_messages",
      _ref_id: MSG,
      _board_page: "messages",
      _dedupe_key: `portal-message:${MSG}`,
    });
    // A message about the job as a whole.
    await send({ action: "message", body: "When is paint?", csrf });
    expect(notices[1]).toMatchObject({
      _kind: "client_message",
      _title: "Rosa Delgado sent a message",
    });
    // A bad about id is dropped, not passed through.
    await send({ action: "message", body: "Hi", csrf, about: "not-a-uuid" });
    expect(calls.filter((c) => c.fn === "mcp_portal_message_post").at(-1)!.args._item).toBeNull();

    const flash = await (
      await handlePortal(req(`/c/${ACCESS}?s=messages&ok=sent`, { cookie: true }), ACCESS, d)
    ).text();
    expect(flash).toContain("Message sent.");
  });

  it("holds the client to the hourly limit with a plain message", async () => {
    const { d, notices } = withNotices({ post: { status: "slow_down" } });
    const r = await handlePortal(
      await post(
        `/c/${ACCESS}`,
        { action: "message", body: "One more", csrf: await csrfFor(SESSION) },
        { cookie: true },
      ),
      ACCESS,
      d,
    );
    expect(r.headers.get("location")).toBe(`/c/${ACCESS}?s=messages&e=msg_slow`);
    expect(notices).toHaveLength(0);
    const page = await (
      await handlePortal(req(`/c/${ACCESS}?s=messages&e=msg_slow`, { cookie: true }), ACCESS, d)
    ).text();
    expect(page).toContain("sent a lot of messages in the last hour");
  });

  it("still shows the page when the thread can't be read", async () => {
    const { d } = withNotices({ thread: { status: "ok", unread: 0, messages: [{ cost: 1 }] } });
    const r = await handlePortal(req(`/c/${ACCESS}?s=messages`, { cookie: true }), ACCESS, d);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("Messages can't be shown right now");
  });
});

describe("the team's reply email", () => {
  it("leads with the contractor, carries the reply and a button back, escapes it and holds no price", () => {
    const m = replyEmail(
      {
        message_id: MSG,
        created_at: "2026-11-04T16:00:00Z",
        author_name: "Pat Lee",
        body: "Yes <script>x</script>\nMonday.",
        item_id: CO,
        about_label: "PCO-004 · Exam room lights",
        access_id: ACCESS,
        customer_name: "Rosa Delgado",
        customer_email: "rosa@example.com",
        job_id: JOB,
        job_number: "2715",
        job_name: "Harbor Point Dental",
        company: "Northline Builders",
      },
      "https://cdn.example.com/logo.png",
    );
    expect(m).toMatchObject({
      to: "rosa@example.com",
      key: `portal-message:${MSG}`,
      fromName: "Northline Builders via Athena",
      subject: "Northline Builders replied about PCO-004 · Exam room lights",
    });
    expect(m.html).toContain("https://cdn.example.com/logo.png");
    expect(m.html).toContain("Powered by Athena");
    expect(m.html).toContain(`https://app.meetathena.io/c/${ACCESS}?s=messages`);
    expect(m.html).toContain("Yes &lt;script&gt;x&lt;/script&gt;<br>Monday.");
    expect(m.html).not.toContain("<script>");
    expect(m.text).toContain("Yes <script>x</script>\nMonday.");
    expect(m.text).not.toContain("$");
  });

  it("posts the reply as the member, then emails the customer; a failed email keeps the reply", async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const reply = {
      message_id: MSG,
      created_at: "2026-11-04T16:00:00Z",
      author_name: "Pat Lee",
      body: "Monday.",
      item_id: null,
      about_label: null,
      access_id: ACCESS,
      customer_name: "Rosa Delgado",
      customer_email: "rosa@example.com",
      job_id: JOB,
      job_number: "2715",
      job_name: "Harbor Point Dental",
      company: "Northline Builders",
    };
    const r = await replyToClient(
      {
        rpc: async (fn, args) => {
          calls.push({ fn, args });
          return reply;
        },
        send: async () => {
          throw new Error("down");
        },
      },
      { jobId: JOB, accessId: ACCESS, body: "  Monday. " },
    );
    expect(calls).toEqual([
      {
        fn: "mcp_job_message_reply",
        args: { _job: JOB, _access: ACCESS, _body: "Monday.", _about_item: null },
      },
    ]);
    expect(r).toMatchObject({ email: "failed", reply: { message_id: MSG } });
    await expect(
      replyToClient(
        { rpc: async () => reply, send: async () => "sent" },
        { jobId: JOB, accessId: ACCESS, body: " " },
      ),
    ).rejects.toThrow(/4,000/);
  });
});

describe("paying an approved pay application online", () => {
  const STATE = {
    status: "ok",
    accepting: true,
    test: true,
    card: true,
    bank: true,
    card_max_cents: 2_500_000,
    payments: [] as unknown[],
  };
  function payDeps(
    state: unknown = STATE,
    result: unknown = {
      status: "redirect",
      url: "https://checkout.stripe.com/c/pay/cs_test_1#abc",
    },
  ) {
    const base = deps({ view: withPayApps() });
    const rpc = base.d.rpc;
    const pays: unknown[] = [];
    base.d.rpc = async (fn, args) => {
      if (fn === "mcp_portal_payments_state") {
        base.calls.push({ fn, args });
        return state;
      }
      return rpc(fn, args);
    };
    base.d.pay = async (p) => {
      pays.push(p);
      return result as never;
    };
    return { ...base, pays };
  }
  const page = async (d: PortalDeps, at: string) => {
    const r = await handlePortal(req(at, { cookie: true }), ACCESS, d);
    return { r, html: await r.text() };
  };

  it("offers bank and card on an approved pay application, in test mode, on every layout", async () => {
    const { d } = payDeps();
    const { r, html } = await page(d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}`);
    expect(r.headers.get("content-security-policy")).toContain(
      "form-action 'self' https://checkout.stripe.com",
    );
    expect(html).toContain("<h2>Pay $13,500.00</h2>");
    expect(html).toContain('name="action" value="pay"');
    expect(html).toContain('name="method" value="bank"');
    expect(html).toContain(">Pay by bank</button>");
    expect(html).toContain(">Pay by card</button>");
    expect(html).toContain("Test mode. No real money moves");
    expect(html).toContain("Northline Builders gets it directly");
    expect(html).toContain(
      "@media (min-width:641px) and (max-width:1000px){.pay-card+.pp .pp-btns",
    );
    expect(html).not.toMatch(/application fee|fee_pct|markup/i);
    // Not approved yet: approve first, no way to pay.
    const open = await page(d, `/c/${ACCESS}?s=billing&i=${PAY}`);
    expect(open.html).not.toContain(">Pay by bank</button>");
    // The billing overview offers it under the latest pay application only once that one is approved.
    expect((await page(d, `/c/${ACCESS}?s=billing`)).html).not.toContain(">Pay by bank</button>");
  });

  it("counts wire and check payments the contractor recorded, and asks only for what's left", async () => {
    const rec = (amount_cents: number, method = "check", accepting = true) => ({
      ...STATE,
      accepting,
      recorded: [{ item_id: PAY_OLD, amount_cents, method, received_on: "2026-11-03" }],
    });
    const part = payDeps(rec(500_000));
    const { html } = await page(part.d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}`);
    expect(html).toContain("<h2>Pay $8,500.00</h2>");
    expect(html).toContain("Received $5,000.00 by check on");
    expect(html).toContain("$8,500.00 is left to pay.");
    expect(html).toContain('<span class="pill wait">Partly paid</span>');
    // Not taking payments here: the part paid still shows, with what's left.
    const closed = payDeps(rec(500_000, "check", false));
    const c = (await page(closed.d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}`)).html;
    expect(c).toContain("<h2>Partly paid</h2>");
    expect(c).toContain("$8,500.00 still due");
    expect(c).not.toContain("<h2>Pay $");
    // Paid in full by wire: paid, no way to pay, and no bank or wire details anywhere.
    const full = payDeps(rec(1_350_000, "wire"));
    const f = (await page(full.d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}`)).html;
    expect(f).toContain("<b>Paid</b><span>Received $13,500.00 by wire on");
    expect(f).toContain("Northline Builders recorded this payment.");
    expect(f).not.toContain("<h2>Pay $");
    expect(f).not.toMatch(/routing|account number|wire instructions|swift/i);
    const both = payDeps(rec(1_350_000, "mixed"));
    expect((await page(both.d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}`)).html).toContain(
      "by wire and check",
    );
  });

  it("keeps card off over the contractor's card limit and when they turned it off", async () => {
    const { d } = payDeps({ ...STATE, card_max_cents: 1_000_000 });
    const { html } = await page(d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}`);
    expect(html).not.toContain(">Pay by card</button>");
    expect(html).toContain("Card payments are open up to $10,000.00, so pay this one by bank.");
    const off = payDeps({ ...STATE, bank: false, card: false });
    expect((await page(off.d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}`)).html).not.toContain(
      "<h2>Pay $",
    );
    const closed = payDeps({ ...STATE, accepting: false });
    expect((await page(closed.d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}`)).html).not.toContain(
      "<h2>Pay $",
    );
  });

  it("shows a payment on its way, a paid one and a refund", async () => {
    const pay = (over: Record<string, unknown>) => ({
      ...STATE,
      payments: [
        {
          item_id: PAY_OLD,
          status: "paid",
          method: "bank",
          amount_cents: 1_350_000,
          refunded_cents: 0,
          paid_at: "2026-11-05T14:00:00Z",
          test: false,
          updated_at: "2026-11-03T14:00:00Z",
          ...over,
        },
      ],
    });
    const paid = await page(payDeps(pay({})).d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}`);
    expect(paid.html).toContain("Paid $13,500.00 by bank on Nov 5, 2026.");
    expect(paid.html).toContain('<span class="pill ok">Paid</span>');
    expect(paid.html).not.toContain(">Pay by bank</button>");
    const list = await page(payDeps(pay({})).d, `/c/${ACCESS}?s=billing`);
    expect(list.html).toContain('<span class="pill ok">Paid</span>');
    const going = await page(
      payDeps(pay({ status: "processing", paid_at: null })).d,
      `/c/${ACCESS}?s=billing&i=${PAY_OLD}`,
    );
    expect(going.html).toContain("Your $13,500.00 bank payment started Nov 3, 2026.");
    expect(going.html).toContain("Payment on its way");
    const part = await page(
      payDeps(pay({ status: "partially_refunded", refunded_cents: 50_000 })).d,
      `/c/${ACCESS}?s=billing&i=${PAY_OLD}`,
    );
    expect(part.html).toContain("$500.00 was refunded.");
    const failed = await page(
      payDeps(pay({ status: "failed", paid_at: null })).d,
      `/c/${ACCESS}?s=billing&i=${PAY_OLD}`,
    );
    expect(failed.html).toContain("Your last payment didn't go through");
    expect(failed.html).toContain(">Pay by bank</button>");
  });

  it("shows nothing about paying when the page can't take payments", async () => {
    const { d, calls } = deps({ view: withPayApps() });
    const { html } = await page(d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}`);
    expect(html).not.toContain("Pay by");
    expect(calls.some((c) => c.fn === "mcp_portal_payments_state")).toBe(false);
    // A payments read that fails still shows the page.
    const broken = payDeps({ status: "signed_out" });
    const r = await page(broken.d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}`);
    expect(r.r.status).toBe(200);
    expect(r.html).not.toContain("Pay by");
  });

  it("sends the customer to Stripe, and only to Stripe", async () => {
    const csrf = await csrfFor(SESSION);
    const { d, pays } = payDeps();
    const r = await handlePortal(
      await post(
        `/c/${ACCESS}`,
        { action: "pay", item: PAY_OLD, method: "bank", csrf },
        { cookie: true },
      ),
      ACCESS,
      d,
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://checkout.stripe.com/c/pay/cs_test_1#abc");
    expect(pays[0]).toEqual({
      access: ACCESS,
      sessionHash: await tokenHash(SESSION),
      item: PAY_OLD,
      method: "bank",
    });

    const evil = payDeps(STATE, { status: "redirect", url: "https://evil.example.com/pay" });
    const r2 = await handlePortal(
      await post(
        `/c/${ACCESS}`,
        { action: "pay", item: PAY_OLD, method: "card", csrf },
        { cookie: true },
      ),
      ACCESS,
      evil.d,
    );
    expect(r2.headers.get("location")).toBe(`/c/${ACCESS}?s=billing&i=${PAY_OLD}&e=pay_error`);

    for (const st of ["nothing_due", "not_accepting", "already_paid", "method", "not_approved"]) {
      const x = payDeps(STATE, { status: st });
      const rr = await handlePortal(
        await post(
          `/c/${ACCESS}`,
          { action: "pay", item: PAY_OLD, method: "bank", csrf },
          { cookie: true },
        ),
        ACCESS,
        x.d,
      );
      expect(rr.headers.get("location")).toBe(`/c/${ACCESS}?s=billing&i=${PAY_OLD}&e=pay_${st}`);
    }
    const shown = await page(payDeps().d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}&e=pay_nothing_due`);
    expect(shown.html).toContain("Nothing is due on this pay application.");

    const bad = payDeps();
    const r3 = await handlePortal(
      await post(
        `/c/${ACCESS}`,
        { action: "pay", item: PAY_OLD, method: "crypto", csrf },
        { cookie: true },
      ),
      ACCESS,
      bad.d,
    );
    expect(r3.headers.get("location")).toBe(`/c/${ACCESS}?s=billing&e=invalid`);
    expect(bad.pays).toEqual([]);
    const r4 = await handlePortal(
      await post(
        `/c/${ACCESS}`,
        { action: "pay", item: PAY_OLD, method: "bank", csrf: "x" },
        { cookie: true },
      ),
      ACCESS,
      bad.d,
    );
    expect(r4.status).toBe(403);
    expect(bad.pays).toEqual([]);
  });

  it("thanks the customer when Stripe sends them back", async () => {
    const { html } = await page(payDeps().d, `/c/${ACCESS}?s=billing&i=${PAY_OLD}&paid=1`);
    expect(html).toContain("Stripe is confirming your payment");
  });
});

const PRECON = "00000000-0000-4000-8000-0000000000e1";
const BILL = "00000000-0000-4000-8000-0000000000e2";
const preconView = (extra: Record<string, unknown> = {}) => ({
  ...view(),
  items: [
    {
      id: PRECON,
      kind: "precon_agreement",
      shared_on: "2026-11-05",
      due_on: "2026-11-12",
      fingerprint: FP,
      view: {
        title: "Pre-construction agreement · Harbor Point Dental",
        price_cents: 1_700_000,
        design_partner: "Rivera Architecture",
        design_role: "Architect",
        design_days: 35,
        includes: ["Schematic design", "Construction drawings"],
        payments: [
          { index: 1, amount_cents: 500_000, due: "signing", on: null, when: null },
          {
            index: 2,
            amount_cents: 1_200_000,
            due: "step",
            on: null,
            when: "when you approve the schematic design",
          },
        ],
        owner_owns_drawings: true,
        credit_days: 90,
        own_terms: ["Two rounds of design changes are included."],
        construction_line: true,
      },
      decision: null,
    },
  ],
  ...extra,
});

describe("pre-construction agreement", () => {
  it("shows the Agreement tab with the contractor's terms and never the fee build-up", async () => {
    const { d } = deps({ view: preconView() });
    const html = await (
      await handlePortal(req(`/c/${ACCESS}?s=agreement&i=${PRECON}`, { cookie: true }), ACCESS, d)
    ).text();
    expect(html).toContain(">Agreement<");
    expect(html).toContain("Rivera Architecture");
    expect(html).toContain("Two rounds of design changes are included.");
    expect(html).toContain("when you approve the schematic design");
    expect(html).toContain("Sign the agreement");
    expect(html).not.toMatch(/hourly|markup|design fee/i);
    expect(html).not.toMatch(/<script/i);
    // Without anything shared, the tab doesn't show and the link opens Home.
    const { d: d2 } = deps();
    const plain = await (
      await handlePortal(req(`/c/${ACCESS}?s=agreement`, { cookie: true }), ACCESS, d2)
    ).text();
    expect(plain).not.toContain("?s=agreement");
  });

  it("signs with consent, a code and the typed name, then sends the owner their copy", async () => {
    const { d, calls, mail } = deps({
      view: preconView(),
      rpcs: {
        mcp_portal_precon_sign: {
          status: "ok",
          decision_id: "pd1",
          decided_at: "2026-11-05T20:30:00Z",
          customer: "Rosa Delgado",
          customer_email: "rosa@example.com",
          job_id: "j1",
          job_name: "Harbor Point Dental",
          job_number: "2715",
          pm_email: "pat@example.com",
          pm_name: "Pat Lee",
          label: "Pre-construction agreement",
          signed_on: "2026-11-05",
          bill: { item_id: BILL, number: "PC-2715-1", amount_cents: 500_000 },
        },
      },
    });
    const csrf = await csrfFor(SESSION);
    const confirm = await (
      await handlePortal(
        req(`/c/${ACCESS}?s=agreement&i=${PRECON}&step=confirm&sent=1`, { cookie: true }),
        ACCESS,
        d,
      )
    ).text();
    expect(confirm).toContain('name="consent"');
    expect(confirm).toContain("I agree to do this electronically");
    const base = {
      action: "decide",
      item: PRECON,
      decision: "signed",
      fingerprint: FP,
      typed_name: "Rosa Delgado",
      code: "123456",
      agree: "1",
      csrf,
    };
    const noConsent = await handlePortal(
      await post(`/c/${ACCESS}`, base, { cookie: true }),
      ACCESS,
      d,
    );
    expect(noConsent.headers.get("location")).toContain("e=consent");
    expect(calls.some((c) => c.fn === "mcp_portal_precon_sign")).toBe(false);

    const ok = await handlePortal(
      await post(`/c/${ACCESS}`, { ...base, consent: "1" }, { cookie: true }),
      ACCESS,
      d,
    );
    expect(ok.headers.get("location")).toContain("ok=signed");
    const signed = calls.find((c) => c.fn === "mcp_portal_precon_sign")!.args;
    expect(signed).toMatchObject({
      _decision: "signed",
      _typed_name: "Rosa Delgado",
      _fingerprint: FP,
      _code_hash: await codeHash(ACCESS, "123456"),
    });
    expect(signed._consent).toContain("sign this agreement electronically");
    expect(signed._statement).toContain("$17,000");
    const copy = mail.find((m) => m.to === "rosa@example.com")!;
    expect(copy).toBeTruthy();
    expect(copy.text).toContain("Two rounds of design changes are included.");
    expect(copy.text).toContain("Rosa Delgado");
    expect(mail.some((m) => m.to === "pat@example.com")).toBe(true);
  });

  it("lets the owner say they're paying a bill by check, and shows the pickup once it's set", async () => {
    const bill = {
      id: BILL,
      kind: "service_invoice",
      shared_on: "2026-11-05",
      due_on: null,
      fingerprint: FP,
      view: {
        number: "PC-2715-1",
        stage: "bill",
        title: "Pre-construction payment 1 of 2 · Harbor Point Dental",
        work_order: "Pre-construction agreement",
        site_address: null,
        issue: null,
        lines: [{ description: "Payment 1", detail: null, amount_cents: 500_000 }],
        signoff: null,
        totals: { subtotal_cents: 500_000, credit_cents: 0, current_due_cents: 500_000 },
        note: null,
      },
      decision: null,
    };
    const v = preconView();
    const { d, calls } = deps({
      view: { ...v, items: [...v.items, bill], check_items: [BILL] },
      rpcs: {
        mcp_portal_check_request: {
          status: "ok",
          request_id: "cr1",
          again: false,
          job_id: "j1",
          job_name: "Harbor Point Dental",
          job_number: "2715",
          customer: "Rosa Delgado",
          pm_email: "pat@example.com",
          number: "PC-2715-1",
          label: "PC-2715-1",
          amount_cents: 500_000,
          note: null,
        },
      },
    });
    const page = await (
      await handlePortal(req(`/c/${ACCESS}?s=billing&i=${BILL}`, { cookie: true }), ACCESS, d)
    ).text();
    expect(page).toContain("Pay by check");
    expect(page).not.toContain("Pay by card");
    const csrf = await csrfFor(SESSION);
    const r = await handlePortal(
      await post(`/c/${ACCESS}`, { action: "check_request", item: BILL, csrf }, { cookie: true }),
      ACCESS,
      d,
    );
    expect(r.headers.get("location")).toContain("ok=check");
    expect(calls.some((c) => c.fn === "mcp_portal_check_request")).toBe(true);

    const set = deps({
      view: {
        ...v,
        items: [...v.items, bill],
        check_items: [BILL],
        checks: [
          {
            item_id: BILL,
            requested_at: "2026-11-05T21:00:00Z",
            note: null,
            pickup_on: "2026-11-10",
            pickup_window: "9:00 to 10:00 AM",
            pickup_place: "the job site",
            pickup_by: "Pat Lee",
          },
        ],
      },
    });
    const after = await (
      await handlePortal(req(`/c/${ACCESS}?s=billing&i=${BILL}`, { cookie: true }), ACCESS, set.d)
    ).text();
    expect(after).toContain("9:00 to 10:00 AM");
    expect(after).toContain("Pat Lee");
  });
});
