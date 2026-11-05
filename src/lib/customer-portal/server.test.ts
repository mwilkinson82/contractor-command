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
import { codeEmail, inviteEmail, type PortalEmail } from "./email";
import {
  codeHash,
  csrfFor,
  handleInvite,
  handlePortal,
  sameOrigin,
  sixDigits,
  type PortalDeps,
} from "./server";
import { PORTAL_SECTIONS, renderGone } from "./render";

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

function deps(over: Partial<{ view: unknown; decide: unknown; issue: unknown }> = {}) {
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
    expect(html).toContain("the difference is added to your contract by change order");
    const confirm = await page(
      true,
      `/c/${ACCESS}?s=selections&i=${SEL}&step=confirm&sent=1&choice=best`,
    );
    expect(confirm).toContain("prepares a change order for the");
    expect(confirm).toContain(
      "Your contract price changes only when you approve that change order.",
    );
  });

  it("tells the PM whether a change order was drafted", async () => {
    const { d, mail } = deps({
      decide: {
        status: "ok",
        decision_id: "d1",
        pm_email: "pat@example.com",
        under_contract: true,
        difference_cents: 168600,
        change_order_number: "PCO-005",
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
      "Athena drafted change order PCO-005 for the package difference of $1,686.00",
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
    expect(page).toContain(`<img class="co-img" src="${LOGO}" alt="Northline Builders">`);
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
    expect(page).not.toContain(`class="co-img"`);
    expect(page).toContain("<b>Northline Builders</b>");
  });
});
