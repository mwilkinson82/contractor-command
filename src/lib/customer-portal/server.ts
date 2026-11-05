// Customer page request handling. Every customer read and action goes through a service-role database function
// that checks the session hash; the page server holds no customer data of its own. Dependencies are injected so
// tests run without a database or email.
import { newToken, TOKEN_RE, tokenHash } from "../mcp/file-share";
import { codeEmail, decisionEmail, type PortalEmail } from "./email";
import {
  approvalStatement,
  choiceTerms,
  inviteOpenSchema,
  portalMessagesSchema,
  portalViewSchema,
  TIER_NAME,
  UUID,
  type PortalPage,
  type PortalView,
} from "./model";
import { recordJobNotice, type NoticeDeps } from "../notices/send";
import { MESSAGE_MAX } from "./messages";
import { decisionNotice, messageNotice, type DecideResult, type PostedMessage } from "./notices";
import {
  itemLabel,
  longDate,
  PORTAL_HEADERS,
  PORTAL_SECTIONS,
  renderGone,
  renderInvite,
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

/** The PM's next step after the customer decides on a pay application. The page never certifies it or changes billing. */
export function payAppNextForPm(decision: string): string {
  return decision === "approved"
    ? "Nothing in billing changed: the pay application is not certified and no payment is recorded. Record the actual certificate on the pay application when it comes in."
    : "Nothing in billing changed. Read their note, then revise the pay application and share it again.";
}

export type PortalDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  signPhotos: (paths: string[]) => Promise<Map<string, string>>;
  send: (m: PortalEmail) => Promise<"sent" | "off" | "failed">;
  emailOn: () => boolean;
  randomInt?: () => number;
  /** The contractor's saved logo for this customer's page, an https URL, or null. Optional: name-only without it. */
  logo?: (access: string) => Promise<string | null>;
  /**
   * Records job notices for the customer's decisions and messages (service role). Without it a decision emails the
   * job's PM directly, as before, and a message is kept but tells no one.
   */
  notice?: NoticeDeps;
};

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
  send: "We couldn't send the email. Try again in a moment.",
  changed:
    "This changed since you opened it, so nothing was recorded. Your contractor will share the current version.",
  not_open: "This is no longer waiting on you.",
  invalid: "Something was missing. Check the form and try again.",
  agree: "Tick the box to agree before you confirm.",
  msg_invalid: "Write a message of up to 4,000 characters, then send it.",
  msg_slow: "You've sent a lot of messages in the last hour. Wait a little, then send this one.",
};
const FLASH: Record<string, string> = {
  sent: "Message sent. Your project team will reply here, and we'll email you when they do.",
  approved: "Approved. Your contractor has been told, and the record is below.",
  declined: "Declined. Your contractor has been told and will follow up.",
  chosen: "Your choice is recorded. Your contractor has been told.",
};

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
    if (typeof view === "string") return goneFor(view, access);
    const paths = view.photos.map((p) => p.storage_path);
    const signed = paths.length
      ? await deps.signPhotos(paths).catch(() => new Map<string, string>())
      : new Map<string, string>();
    const page: PortalPage = {
      ...view,
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
        step: step === "confirm" || step === "decline" ? step : null,
        choice: q.get("choice"),
        error: e ? (ERRORS[e] ?? null) : null,
        flash: ok
          ? (FLASH[ok] ?? null)
          : q.get("sent") === "1"
            ? "We emailed you a 6-digit code."
            : null,
        logo: brandLogo,
      }),
    );
  }

  if (req.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  if (!session || !sessionHash) return goneFor("signed_out", access);
  const f = await form(req);
  if (f.csrf !== (await csrfFor(session))) return new Response("Forbidden", { status: 403 });

  if (f.action === "sign_out") {
    await deps
      .rpc("mcp_portal_sign_out", { _access: access, _session_hash: sessionHash })
      .catch(() => null);
    return redirect(self, { "set-cookie": clearCookie(access) });
  }

  if (f.action === "message") return postMessage(req, access, sessionHash, f, deps);

  const view = await loadView(deps, access, sessionHash, req);
  if (typeof view === "string") return goneFor(view, access);
  const item = view.items.find((i) => i.id === f.item);
  if (!item) return redirect(`${self}?e=not_open`);
  const sec: PortalSection =
    item.kind === "change_order" ? "changes" : item.kind === "pay_app" ? "billing" : "selections";
  const at = (extra: Record<string, string>) =>
    `${self}?${new URLSearchParams({ s: sec, i: item.id, ...extra }).toString()}`;
  if (item.decision) return redirect(at({ e: "not_open" }));
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
      ((item.kind === "change_order" || item.kind === "pay_app") &&
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
                const terms = choiceTerms(view.job.under_contract, pk, item.view.proposal.currency);
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
