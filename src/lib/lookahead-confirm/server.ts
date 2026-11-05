// The public look-ahead confirmation page (/l/<token>). A supplier or sub opens it from Athena's email and confirms
// the date, proposes another, or says they can't make it. Every read and answer goes through a service-role
// database function that looks the link up by its hash; the page server holds nothing of its own. Each answer is
// recorded as a field_confirm job notice, which emails the job's PM and the supers on the job.
import { newToken, TOKEN_RE, tokenHash } from "../mcp/file-share";
import { clientIp, sameOrigin } from "../customer-portal/server";
import { recordJobNotice, type NoticeDeps } from "../notices/send";
import type { PortalEmail } from "../customer-portal/email";
import { answerNotice, openSchema, respondSchema, type PublicView } from "./model";
import {
  CONFIRM_HEADERS,
  renderAsk,
  renderConfirmGone,
  renderDone,
  type ConfirmStep,
} from "./render";

export type ConfirmDeps = {
  /** A service-role rpc: the confirm functions are server only. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Sends the team's notice emails (Athena branded). */
  send: (m: PortalEmail) => Promise<"sent" | "off" | "failed">;
  /** Only the contractor's own saved logo may show; anything else falls back to their name. */
  logoOk?: (url: string) => boolean;
  /** Today in UTC, for the date picker's earliest day. Injected in tests. */
  today?: () => string;
};

/** The page's own cookie: a random value whose hash is the form's CSRF field. Scoped to this one link. */
export const CSRF_COOKIE = "athena_lac";
export const confirmCsrf = async (cookie: string, token: string) =>
  (await tokenHash(`csrf:${cookie}:${token}`)).slice(0, 32);
const cookieHeader = (token: string, value: string) =>
  `${CSRF_COOKIE}=${value}; Path=/l/${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`;

function readCookie(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === CSRF_COOKIE) {
      const val = v.join("=");
      return TOKEN_RE.test(val) ? val : null;
    }
  }
  return null;
}

const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...CONFIRM_HEADERS, ...extra } });
const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });

const ERRORS: Record<string, string> = {
  name: "Type your name so they know who confirmed.",
  date: "Pick the date that works for you, from today on.",
  same_date: "That's the date they asked for. Use Confirm this date instead.",
  note: "Add a short note so they know what's in the way.",
  answer: "Something was missing. Check the form and try again.",
  session: "This page sat open too long. Please try again.",
};

async function form(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/x-www-form-urlencoded") && !ct.includes("multipart/form-data"))
    return {};
  if (Number(req.headers.get("content-length") ?? "0") > 20_000) return {};
  const fd = await req.formData().catch(() => null);
  const out: Record<string, string> = {};
  fd?.forEach((v, k) => {
    if (typeof v === "string" && v.length <= 4000) out[k] = v;
  });
  return out;
}

const todayUtc = () => new Date().toISOString().slice(0, 10);
/** A YYYY-MM-DD that is a real day (no Feb 30). */
export function realDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T12:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Records the answer as a job notice and emails the team. The dedupe key makes a repeat send nothing. */
async function notify(deps: ConfirmDeps, v: PublicView & { job_id: string }) {
  const nd: NoticeDeps = { rpc: deps.rpc, send: deps.send };
  await recordJobNotice(nd, answerNotice(v)).catch(() => null);
}

export async function handleConfirmPage(
  req: Request,
  token: string,
  deps: ConfirmDeps,
): Promise<Response> {
  if (!TOKEN_RE.test(token)) return html(renderConfirmGone("unknown"), 404);
  const hash = await tokenHash(token);
  const self = `/l/${token}`;
  const logoFor = (url: string | null | undefined) => (url && deps.logoOk?.(url) ? url : null);

  if (req.method === "GET" || req.method === "HEAD") {
    const parsed = openSchema.safeParse(
      await deps.rpc("mcp_lookahead_confirm_open", { _token_hash: hash }).catch(() => null),
    );
    if (!parsed.success) return html(renderConfirmGone("error"), 503);
    const o = parsed.data;
    if (o.status === "unknown") return html(renderConfirmGone("unknown"), 404);
    if (o.status !== "ok")
      return html(renderConfirmGone(o.status, o.company ?? null, logoFor(o.logo_url)), 410);
    const logo = logoFor(o.logo_url);
    if (o.answer !== "asked") return html(renderDone(o, logo));
    const url = new URL(req.url);
    const s = url.searchParams.get("step");
    const step: ConfirmStep = s === "propose" || s === "decline" ? s : "main";
    const e = url.searchParams.get("e");
    let cookie = readCookie(req);
    const extra: Record<string, string> = {};
    if (!cookie) {
      cookie = newToken();
      extra["set-cookie"] = cookieHeader(token, cookie);
    }
    return html(
      renderAsk(o, {
        step,
        csrf: await confirmCsrf(cookie, token),
        error: e ? (ERRORS[e] ?? null) : null,
        logo,
        today: (deps.today ?? todayUtc)(),
      }),
      200,
      extra,
    );
  }

  if (req.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const f = await form(req);
  const cookie = readCookie(req);
  if (!cookie) return redirect(`${self}?e=session`);
  if (!f.csrf || f.csrf !== (await confirmCsrf(cookie, token)))
    return new Response("Forbidden", { status: 403 });

  const answer = f.answer;
  const step: ConfirmStep =
    answer === "proposed_new_date" ? "propose" : answer === "declined" ? "decline" : "main";
  const name = (f.name ?? "").trim().replace(/\s+/g, " ");
  const note = (f.note ?? "").trim().slice(0, 2000);
  const date = answer === "proposed_new_date" ? (f.date ?? "").trim() : "";
  // A mistake shows the same form again with what they typed, so nothing has to be typed twice.
  const again = async (e: string) => {
    const o = openSchema.safeParse(
      await deps.rpc("mcp_lookahead_confirm_open", { _token_hash: hash }).catch(() => null),
    );
    if (!o.success || o.data.status !== "ok" || o.data.answer !== "asked") return redirect(self);
    return html(
      renderAsk(o.data, {
        step,
        csrf: f.csrf!,
        error: ERRORS[e] ?? ERRORS.answer!,
        logo: logoFor(o.data.logo_url),
        today: (deps.today ?? todayUtc)(),
        values: { name, note, date },
      }),
      422,
    );
  };
  if (answer !== "confirmed" && answer !== "proposed_new_date" && answer !== "declined")
    return again("answer");
  if (name.length < 2 || name.length > 120) return again("name");
  if (answer === "proposed_new_date" && !realDate(date)) return again("date");
  if (answer === "declined" && note.length < 2) return again("note");

  const parsed = respondSchema.safeParse(
    await deps
      .rpc("mcp_lookahead_confirm_respond", {
        _token_hash: hash,
        _answer: answer,
        _date: date || null,
        _name: name,
        _note: note || null,
        _ip: clientIp(req),
        _user_agent: (req.headers.get("user-agent") ?? "").slice(0, 400) || null,
      })
      .catch(() => null),
  );
  if (!parsed.success) return html(renderConfirmGone("error"), 503);
  const r = parsed.data;
  if (r.status === "ok" || r.status === "answered") {
    // An answer already on file still re-records its notice: the dedupe key makes that a no-op once it landed.
    await notify(deps, r);
    return redirect(self);
  }
  if (r.status === "invalid") return again(r.reason);
  if (r.status === "unknown") return html(renderConfirmGone("unknown"), 404);
  return html(renderConfirmGone(r.status), r.status === "slow_down" ? 429 : 410);
}
