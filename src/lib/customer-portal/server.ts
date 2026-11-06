// Customer page request handling. Every customer read and action goes through a service-role database function
// that checks the session hash; the page server holds no customer data of its own. Dependencies are injected so
// tests run without a database or email.
import { newToken, TOKEN_RE, tokenHash } from "../mcp/file-share";
import {
  checkTeamEmail,
  codeEmail,
  decisionEmail,
  preconCopyEmail,
  type PortalEmail,
} from "./email";
import {
  approvalStatement,
  workOrderPrice,
  choiceTerms,
  inviteOpenSchema,
  portalMessagesSchema,
  portalPaymentsSchema,
  portalUrl,
  portalViewSchema,
  preconConsent,
  preconStatement,
  preconTerms,
  TIER_NAME,
  wholePrice,
  UUID,
  type PortalPage,
  type PortalPayments,
  type PortalView,
} from "./model";
import type { OpenCheckoutResult, PayMethod } from "../client-payments/checkout";
import { recordJobNotice, type NoticeDeps } from "../notices/send";
import { MESSAGE_MAX } from "./messages";
import {
  checkNotice,
  decisionNotice,
  messageNotice,
  preconNotice,
  type CheckRequested,
  type DecideResult,
  type PostedMessage,
  type PreconSigned,
} from "./notices";
import {
  itemLabel,
  longDate,
  PORTAL_HEADERS,
  PORTAL_SECTIONS,
  renderGone,
  renderInvite,
  renderPageSignIn,
  renderPortal,
  type PortalSection,
} from "./render";
import { displayPrice } from "../selections/format";

/** The PM's next step after a package choice. Under contract a change order is drafted; before, the choice is a proposal approval. */
export function choiceNextForPm(
  r: {
    under_contract?: boolean;
    difference_cents?: number | null;
    change_order_number?: string | null;
    co_number?: string | null;
    schedule_days?: number | null;
  },
  item: PortalView["items"][number],
): string | null {
  const currency = item.kind === "selection" ? item.view.proposal.currency : "USD";
  const diff =
    typeof r.difference_cents === "number" ? displayPrice(r.difference_cents, currency) : null;
  if (r.change_order_number)
    return `The job is under contract, so the customer's signed choice approved change order ${r.co_number ? `${r.co_number} (${r.change_order_number})` : r.change_order_number} for the package difference${diff ? ` of ${diff}` : ""}${typeof r.schedule_days === "number" ? `, ${r.schedule_days > 0 ? `with ${r.schedule_days} added ${r.schedule_days === 1 ? "day" : "days"}` : "with no added time"}` : ""}. Add it to the contract in Athena so billing picks it up.`;
  if (r.under_contract)
    return "The job is under contract and this package is already in the contract price, so no change order was drafted.";
  if (r.under_contract === false)
    return "The job has no contract value on file yet, so this is a proposal approval, not a change order. Carry the package total into the contract.";
  return null;
}

/** The PM's next step after the customer decides on a work order. */
export function workOrderNextForPm(decision: string, label: string): string {
  return decision === "approved"
    ? `The customer approved ${label}. Do the work, then log the time, materials and the customer's sign-off in Athena so the bill goes out.`
    : `The customer declined ${label}. Talk with them, then revise the work order or close the call.`;
}

/** The PM's next step after the customer decides on a pay application. The page never certifies it or changes billing. */
export function payAppNextForPm(decision: string): string {
  return decision === "approved"
    ? "Nothing in billing changed: the pay application is not certified and no payment is recorded. Record the actual certificate on the pay application when it comes in."
    : "Nothing in billing changed. Read their note, then revise the pay application and share it again.";
}

export type PortalDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  signPhotos: (paths: string[]) => Promise<Map<string, string>>;
  /** Signs the PM's own photo (athena-people bucket). Absent or failing: the page shows initials. */
  signHeadshot?: (path: string) => Promise<string | null>;
  send: (m: PortalEmail) => Promise<"sent" | "off" | "failed">;
  emailOn: () => boolean;
  randomInt?: () => number;
  /** The contractor's saved logo for this customer's page, an https URL, or null. Optional: name-only without it. */
  logo?: (access: string) => Promise<string | null>;
  /**
   * Who the signed-out sign-in page belongs to: the contractor's name and the job this access link opens, so the
   * customer can tell it's really their contractor and project. Optional: the page shows "Client page" without it.
   */
  brand?: (access: string) => Promise<PortalBrand | null>;
  /**
   * Records job notices for the customer's decisions and messages (service role). Without it a decision emails the
   * job's PM directly, as before, and a message is kept but tells no one.
   */
  notice?: NoticeDeps;
  /**
   * Opens a Stripe Checkout page for an approved pay application on the contractor's account. Without it the page
   * shows no way to pay.
   */
  pay?: (p: {
    access: string;
    sessionHash: string;
    item: string;
    method: PayMethod;
  }) => Promise<OpenCheckoutResult>;
};

export type PortalBrand = {
  company: string | null;
  job_number: string | null;
  job_name: string | null;
};
const brandFor = (deps: PortalDeps, access: string): Promise<PortalBrand | null> =>
  deps.brand ? deps.brand(access).catch(() => null) : Promise.resolve(null);

const logoFor = (deps: PortalDeps, access: string): Promise<string | null> =>
  deps.logo ? deps.logo(access).catch(() => null) : Promise.resolve(null);

export const COOKIE = "athena_portal";

const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...PORTAL_HEADERS, ...extra } });
const redirect = (to: string, extra: Record<string, string> = {}) =>
  new Response(null, {
    status: 303,
    headers: { location: to, "cache-control": "no-store", ...extra },
  });

const ERRORS: Record<string, string> = {
  wrong: "That code didn't match. Check the newest email and try again.",
  locked: "Too many tries on that code. Send yourself a new one.",
  expired: "That code has expired. Send yourself a new one.",
  slow: "Too many codes requested. Wait a few minutes and try again.",
  email:
    "That isn't the email this page was shared with. Use the address your contractor sent it to.",
  send: "We couldn't send the email. Try again in a moment.",
  changed:
    "This changed since you opened it, so nothing was recorded. Your contractor will share the current version.",
  not_open: "This is no longer waiting on you.",
  invalid: "Something was missing. Check the form and try again.",
  agree: "Tick the box to agree before you confirm.",
  consent: "Tick the box to agree to do this electronically before you sign.",
  msg_invalid: "Write a message of up to 4,000 characters, then send it.",
  msg_slow: "You've sent a lot of messages in the last hour. Wait a little, then send this one.",
  pay_not_approved: "Approve this pay application first, then you can pay it here.",
  pay_nothing_due: "Nothing is due on this pay application.",
  pay_not_accepting: "Online payments aren't open right now. Ask your project team how to pay.",
  pay_already_paid: "This pay application is already paid or a payment is on its way.",
  pay_method:
    "That way to pay isn't available for this amount. Try the other one, or ask your project team.",
  pay_error: "We couldn't open the payment page. Nothing was charged. Try again in a moment.",
};
const FLASH: Record<string, string> = {
  sent: "Message sent. Your project team will reply here, and we'll email you when they do.",
  approved: "Approved. Your contractor has been told, and the record is below.",
  declined: "Declined. Your contractor has been told and will follow up.",
  chosen: "Your choice is recorded. Your contractor has been told.",
  signed: "Signed. A copy is on its way to your email.",
};
const PAID_FLASH =
  "Thanks. Stripe is confirming your payment, and this page shows it once they do. You'll also get a receipt from Stripe.";

/** The customer's payments on this job. Null when the page can't take payments or they couldn't be read. */
async function loadPayments(
  deps: PortalDeps,
  access: string,
  sessionHash: string,
): Promise<PortalPayments | null> {
  if (!deps.pay) return null;
  const raw = await deps
    .rpc("mcp_portal_payments_state", { _access: access, _session_hash: sessionHash })
    .catch(() => null);
  const parsed = portalPaymentsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { status: _s, ...rest } = parsed.data;
  return rest;
}

/** Only Stripe's own Checkout pages: anything else from the pay step is refused. */
const isCheckoutUrl = (u: string) =>
  /^https:\/\/checkout\.stripe\.com\/[A-Za-z0-9/_\-#%.?=&]+$/.test(u);

export function clientIp(req: Request): string | null {
  const h = req.headers;
  const v =
    h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip");
  return v ? v.trim().slice(0, 100) : null;
}
const ua = (req: Request) => (req.headers.get("user-agent") ?? "").slice(0, 400) || null;

/**
 * Same-site posts only. A browser always sends Origin or Sec-Fetch-Site on a form post. Under a
 * no-referrer policy a browser sends `Origin: null` even for a same-origin form, so a null origin
 * passes only when the browser's own Sec-Fetch-Site says same-origin.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (origin === "null") return site === "same-origin";
  if (origin) return origin === new URL(req.url).origin || origin === "https://app.meetathena.io";
  return site === null || site === "same-origin" || site === "none";
}

export function readCookie(req: Request, name = COOKIE): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      const val = v.join("=");
      return TOKEN_RE.test(val) ? val : null;
    }
  }
  return null;
}

export function sessionCookie(access: string, token: string, remember: boolean): string {
  return `${COOKIE}=${token}; Path=/c/${access}; HttpOnly; Secure; SameSite=Lax${remember ? "; Max-Age=2592000" : ""}`;
}
const clearCookie = (access: string) =>
  `${COOKIE}=; Path=/c/${access}; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Six digits, uniform. */
export function sixDigits(
  rand: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]!,
): string {
  for (;;) {
    const n = rand() >>> 0;
    if (n < 4_294_000_000) return String(n % 1_000_000).padStart(6, "0");
  }
}
export const codeHash = (access: string, code: string) => tokenHash(`${access}:${code}`);
export const csrfFor = async (session: string) => (await tokenHash(`csrf:${session}`)).slice(0, 32);

async function form(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/x-www-form-urlencoded") && !ct.includes("multipart/form-data"))
    return {};
  const len = Number(req.headers.get("content-length") ?? "0");
  // Room for a 4,000 character message in any language (a browser sends line breaks as two characters).
  if (len > 80_000) return {};
  const fd = await req.formData();
  const out: Record<string, string> = {};
  fd.forEach((v, k) => {
    if (typeof v === "string" && v.length <= 8000) out[k] = v;
  });
  return out;
}

const status = (x: unknown) =>
  x && typeof x === "object" && typeof (x as { status?: unknown }).status === "string"
    ? (x as { status: string }).status
    : "error";

// ---------- invite link: /c/i/<token> ----------

export async function handleInvite(
  req: Request,
  token: string,
  deps: PortalDeps,
): Promise<Response> {
  if (!TOKEN_RE.test(token)) return html(renderGone("unknown"), 404);
  const inviteHash = await tokenHash(token);
  let info;
  try {
    info = inviteOpenSchema.parse(
      await deps.rpc("mcp_portal_invite_open", { _invite_hash: inviteHash }),
    );
  } catch {
    return html(renderGone("error"), 503);
  }
  if (info.status !== "ok")
    return html(renderGone(info.status), info.status === "unknown" ? 404 : 410);
  const self = `/c/i/${token}`;
  const url = new URL(req.url);
  const brandLogo = await logoFor(deps, info.access_id);

  if (req.method === "GET" || req.method === "HEAD") {
    const step = url.searchParams.get("step") === "code" ? "code" : "start";
    const e = url.searchParams.get("e");
    return html(
      renderInvite(info, step, {
        sent: url.searchParams.get("sent") === "1",
        error: e ? (ERRORS[e] ?? null) : null,
        logo: brandLogo,
      }),
    );
  }
  if (req.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const f = await form(req);

  if (f.action === "send_code") {
    if (!deps.emailOn()) return html(renderGone("email_off", info.company, brandLogo), 503);
    const code = sixDigits(deps.randomInt);
    const issued = await deps
      .rpc("mcp_portal_code_issue", {
        _access: info.access_id,
        _purpose: "sign_in",
        _code_hash: await codeHash(info.access_id, code),
        _invite_hash: inviteHash,
        _session_hash: null,
        _item: null,
      })
      .catch(() => null);
    const st = status(issued);
    if (st === "slow_down") return redirect(`${self}?step=code&e=slow`);
    if (st !== "ok")
      return html(renderGone(st === "error" ? "error" : st, info.company, brandLogo), 410);
    const sent = await deps.send(
      codeEmail({
        to: info.email,
        name: info.name,
        company: info.company,
        jobName: info.job_name,
        code,
        purpose: "sign_in",
        logo: brandLogo,
        nonce: newToken(),
      }),
    );
    return redirect(sent === "sent" ? `${self}?step=code&sent=1` : `${self}?e=send`);
  }

  if (f.action === "verify") {
    const code = (f.code ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) return redirect(`${self}?step=code&e=wrong`);
    const session = newToken();
    const remember = f.remember === "1";
    const res = await deps
      .rpc("mcp_portal_sign_in", {
        _invite_hash: inviteHash,
        _code_hash: await codeHash(info.access_id, code),
        _session_hash: await tokenHash(session),
        _remember: remember,
        _ip: clientIp(req),
        _user_agent: ua(req),
      })
      .catch(() => null);
    const st = status(res);
    if (st === "ok")
      return redirect(`/c/${info.access_id}`, {
        "set-cookie": sessionCookie(info.access_id, session, remember),
      });
    if (st === "wrong" || st === "locked" || st === "expired")
      return redirect(`${self}?step=code&e=${st}`);
    return html(renderGone(st === "error" ? "error" : st, info.company, brandLogo), 410);
  }
  return redirect(self);
}

// ---------- the customer page: /c/<access> ----------

async function loadView(
  deps: PortalDeps,
  access: string,
  sessionHash: string | null,
  req: Request,
): Promise<PortalView | string> {
  if (!sessionHash) return "signed_out";
  let raw: unknown;
  try {
    raw = await deps.rpc("mcp_portal_view", {
      _access: access,
      _session_hash: sessionHash,
      _ip: clientIp(req),
      _user_agent: ua(req),
    });
  } catch {
    return "error";
  }
  const st = status(raw);
  if (st !== "ok") return st;
  const parsed = portalViewSchema.safeParse(raw);
  return parsed.success ? parsed.data : "invalid_view";
}

function goneFor(st: string, access: string): Response {
  if (st === "invalid_view")
    return new Response("This page can't be shown right now.", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  const code = st === "error" ? 503 : st === "signed_out" ? 401 : st === "unknown" ? 404 : 410;
  return html(
    renderGone(st),
    code,
    st === "signed_out" || st === "revoked" || st === "closed"
      ? { "set-cookie": clearCookie(access) }
      : {},
  );
}

const section = (s: string | null): PortalSection =>
  (PORTAL_SECTIONS as readonly string[]).includes(s ?? "") ? (s as PortalSection) : "home";

/** The page's own place (section and item), kept through sign-in so the customer lands where they were going. */
export function backQuery(q: URLSearchParams): string {
  const out = new URLSearchParams();
  const s = q.get("s");
  if (s && section(s) !== "home") out.set("s", s);
  const i = q.get("i");
  if (i && UUID.safeParse(i).success) out.set("i", i);
  return out.toString();
}

/** Sign in on the page itself: email, then a 6-digit code, then back to what they opened. */
async function pageSignIn(
  req: Request,
  access: string,
  f: Record<string, string>,
  deps: PortalDeps,
): Promise<Response> {
  const back = backQuery(new URLSearchParams(f.back ?? ""));
  const self = `/c/${access}`;
  const at = (extra: string) => `${self}?${back ? `${back}&` : ""}${extra}`;
  if (f.action === "page_send_code") {
    if (!deps.emailOn())
      return html(renderGone("email_off", null, await logoFor(deps, access)), 503);
    const email = (f.email ?? "").trim().slice(0, 320);
    if (!email) return redirect(at("step=signin&e=email"));
    const code = sixDigits(deps.randomInt);
    const issued = await deps
      .rpc("mcp_portal_page_code_issue", {
        _access: access,
        _email: email,
        _code_hash: await codeHash(access, code),
        _ip: clientIp(req),
        _user_agent: ua(req),
      })
      .catch(() => null);
    const st = status(issued);
    if (st === "mismatch") return redirect(at("step=signin&e=email"));
    if (st === "slow_down") return redirect(at("step=signin&e=slow"));
    if (st !== "ok") return goneFor(st === "error" ? "error" : st, access);
    const info = issued as { email: string; name: string; company: string; job_name: string };
    const sent = await deps.send(
      codeEmail({
        to: info.email,
        name: info.name,
        company: info.company,
        jobName: info.job_name,
        code,
        purpose: "sign_in",
        logo: await logoFor(deps, access),
        nonce: newToken(),
      }),
    );
    return redirect(sent === "sent" ? at("step=code&sent=1") : at("step=signin&e=send"));
  }
  const code = (f.code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return redirect(at("step=code&e=wrong"));
  const session = newToken();
  const remember = f.remember === "1";
  const res = await deps
    .rpc("mcp_portal_page_sign_in", {
      _access: access,
      _code_hash: await codeHash(access, code),
      _session_hash: await tokenHash(session),
      _remember: remember,
      _ip: clientIp(req),
      _user_agent: ua(req),
    })
    .catch(() => null);
  const st = status(res);
  if (st === "ok")
    return redirect(back ? `${self}?${back}` : self, {
      "set-cookie": sessionCookie(access, session, remember),
    });
  if (st === "wrong" || st === "locked" || st === "expired")
    return redirect(at(`step=code&e=${st}`));
  return goneFor(st === "error" ? "error" : st, access);
}

export async function handlePortal(
  req: Request,
  access: string,
  deps: PortalDeps,
): Promise<Response> {
  if (!UUID.safeParse(access).success) return html(renderGone("unknown"), 404);
  const session = readCookie(req);
  const sessionHash = session ? await tokenHash(session) : null;
  const url = new URL(req.url);
  const self = `/c/${access}`;

  if (req.method === "GET" || req.method === "HEAD") {
    const view = await loadView(deps, access, sessionHash, req);
    // Signed out: sign in right here and come back to the same place, never "find your invite email".
    if (view === "signed_out") {
      const q = url.searchParams;
      const e = q.get("e");
      const [logo, brand] = await Promise.all([logoFor(deps, access), brandFor(deps, access)]);
      return html(
        renderPageSignIn(q.get("step") === "code" ? "code" : "email", {
          back: backQuery(q),
          error: e ? (ERRORS[e] ?? null) : null,
          sent: q.get("sent") === "1",
          logo,
          company: brand?.company ?? null,
          job_number: brand?.job_number ?? null,
          job_name: brand?.job_name ?? null,
        }),
        200,
        session ? { "set-cookie": clearCookie(access) } : {},
      );
    }
    if (typeof view === "string") return goneFor(view, access);
    const paths = view.photos.map((p) => p.storage_path);
    const signed = paths.length
      ? await deps.signPhotos(paths).catch(() => new Map<string, string>())
      : new Map<string, string>();
    const { pm_photo_path, ...contractor } = view.contractor;
    const headshot =
      pm_photo_path && deps.signHeadshot
        ? await deps.signHeadshot(pm_photo_path).catch(() => null)
        : null;
    const page: PortalPage = {
      ...view,
      contractor: { ...contractor, pm_photo_url: headshot },
      photos: view.photos.map((p) => ({
        id: p.id,
        taken_on: p.taken_on,
        area: p.area,
        work: p.work,
        url: signed.get(p.storage_path) ?? null,
      })),
      access_id: access,
      csrf: await csrfFor(session!),
    };
    const q = url.searchParams;
    const sec = section(q.get("s"));
    // Opening Messages marks the team's replies read; every other page only counts them for the tab.
    page.messages = await loadMessages(deps, access, sessionHash!, sec === "messages");
    // A service call's page counts unpaid bills on every tab, so it reads payments everywhere.
    if (sec === "billing" || view.items.some((i) => i.kind === "service_invoice"))
      page.payments = await loadPayments(deps, access, sessionHash!);
    const brandLogo = await logoFor(deps, access);
    const step = q.get("step");
    const e = q.get("e");
    const ok = q.get("ok");
    const about = q.get("about");
    return html(
      renderPortal(page, {
        section: sec,
        about: about && UUID.safeParse(about).success ? about : null,
        item: q.get("i") && UUID.safeParse(q.get("i")).success ? q.get("i") : null,
        step: step === "confirm" || step === "decline" || step === "check" ? step : null,
        choice: q.get("choice"),
        error: e ? (ERRORS[e] ?? null) : null,
        flash: ok
          ? ok === "check"
            ? `Sent. ${view.contractor.name} will set a date to collect your check.`
            : (FLASH[ok] ?? null)
          : q.get("sent") === "1"
            ? "We emailed you a 6-digit code."
            : q.get("paid") === "1" && sec === "billing"
              ? PAID_FLASH
              : null,
        logo: brandLogo,
      }),
    );
  }

  if (req.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const f = await form(req);
  if (f.action === "page_send_code" || f.action === "page_verify")
    return pageSignIn(req, access, f, deps);
  if (!session || !sessionHash) return redirect(`${self}?step=signin`);
  if (f.csrf !== (await csrfFor(session))) return new Response("Forbidden", { status: 403 });

  if (f.action === "sign_out") {
    await deps
      .rpc("mcp_portal_sign_out", { _access: access, _session_hash: sessionHash })
      .catch(() => null);
    return redirect(self, { "set-cookie": clearCookie(access) });
  }

  if (f.action === "message") return postMessage(req, access, sessionHash, f, deps);

  if (f.action === "pay") {
    const item = f.item && UUID.safeParse(f.item).success ? f.item : null;
    const method = f.method === "card" || f.method === "bank" ? f.method : null;
    if (!item || !method || !deps.pay) return redirect(`${self}?s=billing&e=invalid`);
    const back = (e: string) =>
      redirect(`${self}?${new URLSearchParams({ s: "billing", i: item, e }).toString()}`);
    const r = await deps
      .pay({ access, sessionHash, item, method })
      .catch(() => ({ status: "error" }));
    if (r.status === "redirect" && "url" in r && typeof r.url === "string" && isCheckoutUrl(r.url))
      return redirect(r.url);
    if (
      r.status === "signed_out" ||
      r.status === "unknown" ||
      r.status === "revoked" ||
      r.status === "closed"
    )
      return goneFor(r.status, access);
    return back(ERRORS[`pay_${r.status}`] ? `pay_${r.status}` : "pay_error");
  }

  const view = await loadView(deps, access, sessionHash, req);
  if (typeof view === "string") return goneFor(view, access);
  const item = view.items.find((i) => i.id === f.item);
  if (!item) return redirect(`${self}?e=not_open`);
  const sec: PortalSection =
    item.kind === "change_order"
      ? "changes"
      : item.kind === "pay_app" || item.kind === "service_invoice"
        ? "billing"
        : item.kind === "work_order"
          ? "work"
          : item.kind === "precon_agreement"
            ? "agreement"
            : "selections";
  const at = (extra: Record<string, string>) =>
    `${self}?${new URLSearchParams({ s: sec, i: item.id, ...extra }).toString()}`;
  if (f.action === "check_request") {
    if (item.kind !== "service_invoice") return redirect(at({ e: "not_open" }));
    return checkRequest(req, access, sessionHash, f, deps, view, item, at);
  }
  // A service bill is paid, never decided.
  if (item.decision || item.kind === "service_invoice") return redirect(at({ e: "not_open" }));
  const choice =
    item.kind === "selection" &&
    (f.choice === "good" || f.choice === "better" || f.choice === "best")
      ? f.choice
      : null;

  if (f.action === "start") {
    if (item.kind === "selection" && !choice) return redirect(at({ e: "invalid" }));
    if (!deps.emailOn()) return html(renderGone("email_off"), 503);
    const code = sixDigits(deps.randomInt);
    const issued = await deps
      .rpc("mcp_portal_code_issue", {
        _access: access,
        _purpose: "decide",
        _code_hash: await codeHash(access, code),
        _invite_hash: null,
        _session_hash: sessionHash,
        _item: item.id,
      })
      .catch(() => null);
    const st = status(issued);
    if (st === "slow_down") return redirect(at({ e: "slow" }));
    if (st === "not_open") return redirect(at({ e: "not_open" }));
    if (st !== "ok") return goneFor(st, access);
    const sent = await deps.send(
      codeEmail({
        to: view.customer.email,
        name: view.customer.name,
        company: view.contractor.name,
        jobName: view.job.name,
        code,
        purpose: "decide",
        what: itemLabel(item),
        logo: await logoFor(deps, access),
        nonce: newToken(),
      }),
    );
    if (sent !== "sent") return redirect(at({ e: "send" }));
    return redirect(at({ step: "confirm", sent: "1", ...(choice ? { choice } : {}) }));
  }

  if (f.action === "decide" && item.kind === "precon_agreement")
    return preconDecide(req, access, sessionHash, f, deps, view, item, at);

  if (f.action === "decide") {
    const decision = f.decision;
    const typed = (f.typed_name ?? "").trim().replace(/\s+/g, " ");
    const needsCode = decision === "approved" || decision === "chosen";
    const back = (e: string) =>
      redirect(
        at(
          needsCode
            ? { step: "confirm", e, ...(choice ? { choice } : {}) }
            : { step: "decline", e },
        ),
      );
    const validKind =
      ((item.kind === "change_order" || item.kind === "pay_app" || item.kind === "work_order") &&
        (decision === "approved" || decision === "declined")) ||
      (item.kind === "selection" && decision === "chosen" && choice !== null);
    if (!validKind || typed.length < 2 || typed.length > 120) return back("invalid");
    if (needsCode && f.agree !== "1") return back("agree");
    const code = (f.code ?? "").replace(/\s+/g, "");
    if (needsCode && !/^\d{6}$/.test(code)) return back("wrong");
    const company = view.contractor.name;
    const label = itemLabel(item);
    const statement =
      decision === "declined"
        ? `I decline ${label} from ${company}.`
        : item.kind === "change_order"
          ? approvalStatement({
              kind: "change_order",
              company,
              label,
              price: displayPrice(item.view.price_cents, "USD"),
              scheduleDays: item.view.schedule_days,
            })
          : item.kind === "work_order"
            ? approvalStatement({
                kind: "work_order",
                company,
                label,
                price: workOrderPrice(item.view),
              })
            : item.kind === "pay_app"
              ? approvalStatement({
                  kind: "pay_app",
                  company,
                  label,
                  price: displayPrice(item.view.totals.current_due_cents, "USD"),
                  periodEnd: longDate(item.view.period_end),
                })
              : (() => {
                  const pk = item.view.proposal.packages.find((k) => k.tier === choice)!;
                  const terms = choiceTerms(
                    view.job.under_contract,
                    pk,
                    item.view.proposal.currency,
                  );
                  return approvalStatement({
                    kind: "selection",
                    company,
                    label,
                    price: displayPrice(pk.total_cents, item.view.proposal.currency),
                    choice: TIER_NAME[choice!],
                    scheduleDays: terms.days,
                    changeOrder: terms.changeOrder,
                  });
                })();
    const note = (f.note ?? "").trim().slice(0, 2000) || null;
    const res = await deps
      .rpc("mcp_portal_decide", {
        _access: access,
        _session_hash: sessionHash,
        _item: item.id,
        _decision: decision,
        _choice: choice,
        _code_hash: needsCode ? await codeHash(access, code) : null,
        _typed_name: typed,
        _statement: statement,
        _fingerprint: f.fingerprint ?? "",
        _note: note,
        _ip: clientIp(req),
        _user_agent: ua(req),
      })
      .catch(() => null);
    const st = status(res);
    if (st === "ok") {
      // co_number and schedule_days arrive only with the change terms migration; both are read as optional.
      const r = res as DecideResult & { pm_email?: string | null };
      const next =
        decision === "chosen"
          ? choiceNextForPm(r, item)
          : item.kind === "pay_app"
            ? payAppNextForPm(decision!)
            : item.kind === "work_order"
              ? workOrderNextForPm(decision!, label)
              : null;
      // The job notice tells the team (board, account page, morning brief) and emails the people the PM chose. The
      // PM gets the old decision email only when the notice can't be recorded, so nobody is emailed twice.
      const recorded = await recordDecisionNotice(deps, access, sessionHash, r, {
        customer: view.customer.name,
        item,
        label,
        decision: decision!,
        choice,
        note,
        next,
      });
      if (!recorded && r.pm_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.pm_email))
        await deps.send(
          decisionEmail({
            to: r.pm_email,
            customer: view.customer.name,
            jobName: view.job.name,
            jobNumber: view.job.number,
            label,
            decision: decision!,
            choice: choice ? TIER_NAME[choice] : null,
            note,
            reference: `Customer page decision ${r.decision_id ?? ""}`.trim(),
            next,
          }),
        );
      return redirect(at({ ok: decision! }));
    }
    if (st === "wrong" || st === "locked" || st === "expired" || st === "invalid") return back(st);
    if (st === "changed" || st === "not_open")
      return redirect(`${self}?${new URLSearchParams({ s: sec, e: st }).toString()}`);
    return goneFor(st, access);
  }
  return redirect(self);
}

// ---------- pre-construction agreements: sign or decline, and pay by check ----------

type Item = PortalView["items"][number];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const utc = (iso: string) => new Date(iso).toUTCString().replace("GMT", "UTC");

/**
 * The owner signs or declines the agreement. Signing needs their consent to do business electronically, a fresh
 * emailed code, their typed name and the statement; the consent and statement words are stored with the signature.
 */
async function preconDecide(
  req: Request,
  access: string,
  sessionHash: string,
  f: Record<string, string>,
  deps: PortalDeps,
  view: PortalView,
  item: Extract<Item, { kind: "precon_agreement" }>,
  at: (extra: Record<string, string>) => string,
): Promise<Response> {
  const self = `/c/${access}`;
  const decision = f.decision === "signed" || f.decision === "declined" ? f.decision : null;
  const signing = decision === "signed";
  const back = (e: string) => redirect(at({ step: signing ? "confirm" : "decline", e }));
  const typed = (f.typed_name ?? "").trim().replace(/\s+/g, " ");
  if (!decision || typed.length < 2 || typed.length > 120) return back("invalid");
  if (signing && f.consent !== "1") return back("consent");
  if (signing && f.agree !== "1") return back("agree");
  const code = (f.code ?? "").replace(/\s+/g, "");
  if (signing && !/^\d{6}$/.test(code)) return back("wrong");
  const company = view.contractor.name;
  const v = item.view;
  const consent = signing ? preconConsent(company, view.customer.email) : null;
  const statement = signing
    ? preconStatement(company, view.job.name, wholePrice(v.price_cents))
    : `I decline the pre-construction agreement from ${company} for ${view.job.name}.`;
  const note = signing ? null : (f.note ?? "").trim().slice(0, 2000) || null;
  const res = await deps
    .rpc("mcp_portal_precon_sign", {
      _access: access,
      _session_hash: sessionHash,
      _item: item.id,
      _decision: decision,
      _code_hash: signing ? await codeHash(access, code) : null,
      _typed_name: typed,
      _consent: consent,
      _statement: statement,
      _fingerprint: f.fingerprint ?? "",
      _note: note,
      _ip: clientIp(req),
      _user_agent: ua(req),
    })
    .catch(() => null);
  const st = status(res);
  if (st === "wrong" || st === "locked" || st === "expired" || st === "invalid") return back(st);
  if (st === "changed" || st === "not_open")
    return redirect(`${self}?${new URLSearchParams({ s: "agreement", e: st }).toString()}`);
  if (st !== "ok") return goneFor(st, access);
  const r = res as PreconSigned;
  const notified = deps.notice
    ? (await recordJobNotice(deps.notice, preconNotice(r, { decision, note })).catch(
        () => null,
      )) !== null
    : false;
  if (!notified && r.pm_email && EMAIL_RE.test(r.pm_email))
    await deps.send(
      decisionEmail({
        to: r.pm_email,
        customer: view.customer.name,
        jobName: view.job.name,
        jobNumber: view.job.number,
        label: "the pre-construction agreement",
        decision: signing ? "approved" : "declined",
        choice: null,
        note,
        reference: `Customer page decision ${r.decision_id}`,
        next: signing
          ? preconNextForPm(r)
          : "Read their note, change the terms with Athena and send it again.",
      }),
    );
  if (signing)
    await deps.send(
      preconCopyEmail({
        to: view.customer.email,
        name: view.customer.name,
        company,
        jobName: view.job.name,
        signedOn: longDate(r.signed_on ?? r.decided_at),
        terms: preconTerms(v, company, view.job.name),
        typedName: typed,
        signedAt: utc(r.decided_at),
        fingerprint: item.fingerprint,
        consent: consent!,
        statement,
        link: `${portalUrl(access)}?s=agreement`,
        logo: await logoFor(deps, access),
        decisionId: r.decision_id,
      }),
    );
  return redirect(at({ ok: decision }));
}

/** What the team does next once the owner signed. */
export function preconNextForPm(r: Pick<PreconSigned, "bill">): string {
  return r.bill
    ? `Payment 1, invoice ${r.bill.number} for ${wholePrice(r.bill.amount_cents)}, is on their page to pay. The job moves to Design.`
    : "Send payment 1 to their client page when it's due. The job moves to Design.";
}

/** The owner tells the contractor they're paying a bill by check. */
async function checkRequest(
  req: Request,
  access: string,
  sessionHash: string,
  f: Record<string, string>,
  deps: PortalDeps,
  view: PortalView,
  item: Extract<Item, { kind: "service_invoice" }>,
  at: (extra: Record<string, string>) => string,
): Promise<Response> {
  const note = (f.note ?? "").trim().slice(0, 1000) || null;
  const res = await deps
    .rpc("mcp_portal_check_request", {
      _access: access,
      _session_hash: sessionHash,
      _item: item.id,
      _note: note,
      _ip: clientIp(req),
      _user_agent: ua(req),
    })
    .catch(() => null);
  const st = status(res);
  if (st === "invalid") return redirect(at({ step: "check", e: "invalid" }));
  if (st === "not_open") return redirect(at({ e: "not_open" }));
  if (st !== "ok") return goneFor(st, access);
  const r = res as CheckRequested;
  const notified = deps.notice
    ? (await recordJobNotice(deps.notice, checkNotice(r)).catch(() => null)) !== null
    : false;
  if (!notified && r.pm_email && EMAIL_RE.test(r.pm_email))
    await deps.send(
      checkTeamEmail({
        to: r.pm_email,
        customer: view.customer.name,
        jobName: view.job.name,
        jobNumber: view.job.number,
        number: r.number,
        amount: wholePrice(r.amount_cents),
        note: r.note,
        reference: r.request_id,
      }),
    );
  return redirect(at({ ok: "check" }));
}

// ---------- notices and messages ----------

/** The customer's conversation, or null when it can't be read (the rest of the page still shows). */
async function loadMessages(
  deps: PortalDeps,
  access: string,
  sessionHash: string,
  markRead: boolean,
): Promise<PortalPage["messages"]> {
  const raw = await deps
    .rpc("mcp_portal_messages", {
      _access: access,
      _session_hash: sessionHash,
      _mark_read: markRead,
    })
    .catch(() => null);
  const parsed = portalMessagesSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { unread: markRead ? 0 : parsed.data.unread, list: parsed.data.messages };
}

/** Records the client_decision notice. False when it couldn't be, so the caller falls back to the PM email. */
async function recordDecisionNotice(
  deps: PortalDeps,
  access: string,
  sessionHash: string,
  r: DecideResult,
  a: Omit<Parameters<typeof decisionNotice>[0], "jobId" | "r">,
): Promise<boolean> {
  if (!deps.notice || !r.decision_id) return false;
  const jobId = await deps
    .rpc("mcp_portal_decision_job", {
      _access: access,
      _session_hash: sessionHash,
      _decision: r.decision_id,
    })
    .catch(() => null);
  if (typeof jobId !== "string" || !UUID.safeParse(jobId).success) return false;
  const n = await recordJobNotice(
    deps.notice,
    decisionNotice({ ...a, jobId, r: { ...r, decision_id: r.decision_id } }),
  ).catch(() => null);
  return n !== null;
}

/** The customer writes to the team. The notice tells the team; a failed notice still keeps the message. */
async function postMessage(
  req: Request,
  access: string,
  sessionHash: string,
  f: Record<string, string>,
  deps: PortalDeps,
): Promise<Response> {
  const about = f.about && UUID.safeParse(f.about).success ? f.about : null;
  const body = (f.body ?? "").replace(/\r\n/g, "\n").trim();
  const back = (extra: Record<string, string>) =>
    redirect(
      `/c/${access}?${new URLSearchParams({ s: "messages", ...(about ? { about } : {}), ...extra }).toString()}`,
    );
  if (!body || body.length > MESSAGE_MAX) return back({ e: "msg_invalid" });
  const res = await deps
    .rpc("mcp_portal_message_post", {
      _access: access,
      _session_hash: sessionHash,
      _item: about,
      _body: body,
      _ip: clientIp(req),
      _user_agent: ua(req),
    })
    .catch(() => null);
  const st = status(res);
  if (st === "slow_down") return back({ e: "msg_slow" });
  if (st === "invalid") return back({ e: "msg_invalid" });
  if (st !== "ok") return goneFor(st, access);
  const m = res as PostedMessage;
  if (deps.notice && m.job_id && m.message_id)
    await recordJobNotice(deps.notice, messageNotice(m, body, access)).catch(() => null);
  return redirect(`/c/${access}?s=messages&ok=sent#latest`);
}
