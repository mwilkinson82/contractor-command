// The reviewer return page: https://app.meetathena.io/r/submittal-return/<code>. The code is the only key; every
// read and write goes through a service-role database function that looks it up by hash. Dependencies are
// injected so tests run without a database, storage or email.
import { newToken, TOKEN_RE, tokenHash } from "../mcp/file-share";
import type { NoticeDeps } from "../notices/send";
import { recordReplyNotice, type RecordedReply } from "./notice";
import { REPLY_CODE_RE, isReplyAction, replyCodeHash } from "./reply-link";
import {
  RETURN_HEADERS,
  renderGone,
  renderReturnForm,
  renderThanks,
  type ReturnForm,
  type ReturnInfo,
} from "./render";

export const RETURN_FILE_MAX_BYTES = 25 * 1024 * 1024;
const MAX_BODY = RETURN_FILE_MAX_BYTES + 256 * 1024;
export const RETURN_COOKIE = "athena_sr";

export type ReturnDeps = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Stores a file in the submittals bucket at this path. Throws when it could not. */
  upload: (path: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  send: NoticeDeps["send"];
  /** The contractor's saved logo when it is one of ours to show, or null. */
  logo?: (url: string | null) => string | null;
  newId?: () => string;
};

type Open = ReturnInfo & {
  status: string;
  company_id: string;
  job_id: string;
  logo_url?: string | null;
  returned: {
    action_label: string;
    reviewer_name: string | null;
    created_at: string;
    file_count?: number;
  } | null;
};

const page = (body: string | null, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...RETURN_HEADERS, ...extra } });
const redirect = (to: string) =>
  new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });

/** Same-site posts only, the same rule as the customer page. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (origin === "null") return site === "same-origin";
  if (origin) return origin === new URL(req.url).origin || origin === "https://app.meetathena.io";
  return site === null || site === "same-origin" || site === "none";
}

function readCookie(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === RETURN_COOKIE) {
      const val = v.join("=");
      return TOKEN_RE.test(val) ? val : null;
    }
  }
  return null;
}
const cookieFor = (code: string, value: string) =>
  `${RETURN_COOKIE}=${value}; Path=/r/submittal-return/${code}; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;
export const returnCsrf = async (cookie: string) =>
  (await tokenHash(`csrf:submittal-return:${cookie}`)).slice(0, 32);

const clientIp = (req: Request) => {
  const h = req.headers;
  const v =
    h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip");
  return v ? v.trim().slice(0, 100) : null;
};

/** PDF, PNG or JPEG by their first bytes; the browser's claimed type is not trusted. */
export function sniffReturnFile(
  bytes: Uint8Array,
): { ext: "pdf" | "png" | "jpg"; mime: string } | null {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { ext: "pdf", mime: "application/pdf" };
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { ext: "png", mime: "image/png" };
  if (starts([0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  return null;
}

/** A storage-safe file name that ends in the file's real type. */
export function returnFileName(raw: string, ext: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? "")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[^A-Za-z0-9 _.-]+/g, "")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return `${base || "stamped-copy"}.${ext}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleSubmittalReturn(
  req: Request,
  code: string,
  deps: ReturnDeps,
): Promise<Response> {
  const head = req.method === "HEAD";
  if (!REPLY_CODE_RE.test(code)) return page(head ? null : renderGone("unknown"), 404);
  const self = `/r/submittal-return/${code}`;
  const hash = await replyCodeHash(code);
  let open: Open;
  try {
    open = (await deps.rpc("mcp_submittal_reply_page_open", { _token_hash: hash })) as Open;
  } catch {
    return page(head ? null : renderGone("error"), 503);
  }
  const status = typeof open?.status === "string" ? open.status : "error";
  const logo = deps.logo ? deps.logo(open?.logo_url ?? null) : null;
  const company = typeof open?.company === "string" ? open.company : null;
  if (status !== "ok")
    return page(
      head ? null : renderGone(status, company, logo),
      status === "unknown" ? 404 : status === "error" ? 503 : 410,
    );

  if (req.method === "GET" || head) {
    if (open.returned) return page(head ? null : renderThanks(open, open.returned, logo));
    const existing = readCookie(req);
    const cookie = existing ?? newToken();
    return page(
      head ? null : renderReturnForm(open, { csrf: await returnCsrf(cookie), logo }),
      200,
      existing ? {} : { "set-cookie": cookieFor(code, cookie) },
    );
  }
  if (req.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD, POST" } });
  if (!sameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const cookie = readCookie(req);
  if (!cookie) return new Response("Forbidden", { status: 403 });
  const csrf = await returnCsrf(cookie);
  if (open.returned) return redirect(self);

  const again = (error: string, values: ReturnForm, code = 400) =>
    page(renderReturnForm(open, { csrf, logo, error, values }), code);
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("multipart/form-data") && !ct.includes("application/x-www-form-urlencoded"))
    return again("Something was missing. Check the form and try again.", {});
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY)
    return again(
      "That file is over 25 MB. Attach a smaller copy, or reply to the email with it.",
      {},
      413,
    );
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return again("Something was missing. Check the form and try again.", {});
  }
  const str = (k: string, max: number) => {
    const v = fd.get(k);
    return typeof v === "string" ? v.slice(0, max) : "";
  };
  if (str("csrf", 100) !== csrf) return new Response("Forbidden", { status: 403 });
  const values: ReturnForm = {
    action: str("action", 40),
    reviewer_name: str("reviewer_name", 200).trim().replace(/\s+/g, " "),
    reviewer_email: str("reviewer_email", 400).trim(),
    comments: str("comments", 4100).trim(),
  };
  if (!isReplyAction(values.action)) return again("Pick your action.", values);
  if (values.reviewer_name!.length < 2 || values.reviewer_name!.length > 120)
    return again("Type your name so the contractor knows who reviewed it.", values);
  if (
    values.reviewer_email &&
    (!EMAIL.test(values.reviewer_email) || values.reviewer_email.length > 320)
  )
    return again("Check your email address, or leave it blank.", values);
  if (values.comments!.length > 4000) return again("Keep comments under 4,000 characters.", values);

  const raw = fd.get("file");
  let file: { bytes: Uint8Array; name: string; mime: string } | null = null;
  if (raw && typeof raw !== "string" && raw.size > 0) {
    if (raw.size > RETURN_FILE_MAX_BYTES)
      return again(
        "That file is over 25 MB. Attach a smaller copy, or reply to the email with it.",
        values,
        413,
      );
    const bytes = new Uint8Array(await raw.arrayBuffer());
    const kind = sniffReturnFile(bytes);
    if (!kind) return again("Attach a PDF, PNG or JPEG.", values);
    file = { bytes, name: returnFileName(raw.name ?? "", kind.ext), mime: kind.mime };
  }

  const tried = (await deps
    .rpc("mcp_submittal_reply_page_try", { _token_hash: hash })
    .catch(() => null)) as { status?: string } | null;
  if (tried?.status === "slow_down") return page(renderGone("slow_down", company, logo), 429);
  if (tried?.status !== "ok") return page(renderGone(tried?.status ?? "error", company, logo), 503);

  const id = (deps.newId ?? (() => crypto.randomUUID()))();
  const files: Record<string, unknown>[] = [];
  if (file) {
    const path = `${open.company_id}/${open.job_id}/returns/${id}/${file.name}`;
    try {
      await deps.upload(path, file.bytes, file.mime);
    } catch {
      return again(
        "We couldn't save your file. Try again, or reply to the email with it.",
        values,
        503,
      );
    }
    files.push({
      path,
      filename: file.name,
      content_type: file.mime,
      size_bytes: file.bytes.length,
    });
  }
  const res = (await deps
    .rpc("mcp_submittal_reply_page_submit", {
      _token_hash: hash,
      _response: id,
      _action: values.action,
      _reviewer_name: values.reviewer_name,
      _reviewer_email: values.reviewer_email || null,
      _comments: values.comments || null,
      _files: files,
      _ip: clientIp(req),
      _user_agent: (req.headers.get("user-agent") ?? "").slice(0, 400) || null,
    })
    .catch(() => null)) as ({ status?: string } & Partial<RecordedReply>) | null;
  const st = res?.status ?? "error";
  if (st === "ok") {
    await recordReplyNotice(deps, res as RecordedReply, values.comments).catch(() => null);
    return redirect(self);
  }
  if (st === "already") return redirect(self);
  if (st === "invalid")
    return again("Something was missing. Check the form and try again.", values);
  return page(renderGone(st, company, logo), st === "error" ? 503 : 410);
}
