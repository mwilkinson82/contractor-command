// 0.8.11: file share links. The host builds the file (PDF, Excel, CSV, PNG, Word) and hands the bytes to
// Athena's file_share tool; Athena stores them in a private bucket scoped to company/job and returns a
// tokenized link (https://app.meetathena.io/f/<token>) that opens for anyone who has it, until it expires
// or is turned off. Only a SHA-256 of the token is stored. Pure helpers only (no database, no network) so
// they are unit-tested directly.

export const FILE_BUCKET = "athena-files";
export const FILE_LINK_BASE = "https://app.meetathena.io/f/";
/** 10 MB decoded. Practical inline base64 limit is lower (the host model has to write the base64 out). */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_B64_MAX_CHARS = Math.ceil(FILE_MAX_BYTES / 3) * 4 + 8;
export const FILE_DEFAULT_DAYS = 30;
export const FILE_MAX_DAYS = 90;
export const FILE_KINDS = ["sov", "schedule", "report", "notice", "other"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** Supers (no dollars) may share a schedule only; contract-only scope may not share files. */
export function kindAllowed(
  kind: FileKind,
  scope: "full" | "contract" | "super" | undefined,
): boolean {
  if (scope === "full") return true;
  if (scope === "super") return kind === "schedule";
  return false;
}

export const MIME_BY_EXT = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
  png: "image/png",
} as const;
export type FileExt = keyof typeof MIME_BY_EXT;
export const ALLOWED_MIME = Object.values(MIME_BY_EXT);

export class FileRejected extends Error {}

/** Safe display/storage name: keeps letters, digits, space, dot, dash, underscore; one allowed extension. */
export function safeFilename(name: string): { name: string; ext: FileExt } {
  const base = name
    .split(/[\\/]/)
    .pop()!
    .normalize("NFKC")
    .replace(/[^\w .()-]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-120);
  const m = base.match(/\.([A-Za-z0-9]+)$/);
  const ext = m?.[1].toLowerCase();
  if (!ext || !(ext in MIME_BY_EXT))
    throw new FileRejected(
      "Only PDF, Excel (.xlsx), Word (.docx), CSV and PNG files can be shared. Nothing was shared.",
    );
  const stem =
    base
      .slice(0, -(ext.length + 1))
      .replace(/^[.\s]+/, "")
      .replace(/\./g, "_")
      .trim() || "file";
  return { name: `${stem}.${ext}`, ext: ext as FileExt };
}

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** Content check by magic bytes, so a renamed file can't slip through. */
export function sniff(bytes: Uint8Array, ext: FileExt): boolean {
  switch (ext) {
    case "pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "xlsx":
    case "docx":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]); // zip (OOXML)
    case "csv": {
      const head = bytes.subarray(0, 65536);
      if (head.includes(0)) return false;
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(
          head.length === bytes.length ? head : trimUtf8(head),
        );
        return true;
      } catch {
        return false;
      }
    }
  }
}
function trimUtf8(b: Uint8Array): Uint8Array {
  let end = b.length;
  while (end > 0 && end > b.length - 4 && (b[end - 1] & 0xc0) === 0x80) end--;
  if (end > 0 && b[end - 1] >= 0xc0) end--;
  return b.subarray(0, end);
}

export function decodeBase64(s: string): Uint8Array {
  const clean = s.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "");
  if (clean.length > FILE_B64_MAX_CHARS) throw new FileRejected(tooBig());
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean) || clean.length % 4 === 1)
    throw new FileRejected("The file data isn't valid base64. Nothing was shared.");
  const std = clean.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std.padEnd(Math.ceil(std.length / 4) * 4, "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const tooBig = () =>
  `That file is over ${FILE_MAX_BYTES / 1024 / 1024} MB, the most Athena can share. Nothing was shared.`;

export function validateFile(bytes: Uint8Array, filename: string) {
  const { name, ext } = safeFilename(filename);
  if (bytes.length === 0) throw new FileRejected("The file is empty. Nothing was shared.");
  if (bytes.length > FILE_MAX_BYTES) throw new FileRejected(tooBig());
  if (!sniff(bytes, ext))
    throw new FileRejected(
      `That file isn't a real .${ext} file. Build the file again and share it. Nothing was shared.`,
    );
  return { name, ext, mime: MIME_BY_EXT[ext], size: bytes.length };
}

/** ChatGPT file params (download_url) are fetched only from OpenAI's file hosts, over https, no redirects. */
export const FILE_URL_HOSTS = [/(^|\.)oaiusercontent\.com$/i, /(^|\.)openai\.com$/i];
export function allowedDownloadUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      FILE_URL_HOSTS.some((r) => r.test(url.hostname))
    );
  } catch {
    return false;
  }
}

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
/** 32 random bytes, base64url (43 chars). */
export function newToken(
  rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  return b64url(rand(32));
}
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export async function tokenHash(token: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}
/** Token from a full link, a /f/<token> path, or the bare token. */
export function tokenFromLink(s: string): string | null {
  const t =
    s
      .trim()
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .split("/")
      .pop() ?? "";
  return TOKEN_RE.test(t) ? t : null;
}
export const shareLink = (token: string) => `${FILE_LINK_BASE}${token}`;
export const storagePath = (companyId: string, jobId: string, id: string, name: string) =>
  `${companyId}/${jobId}/${id}/${name}`;
export function expiry(days: number | undefined, now = new Date()): Date {
  const d = Math.min(Math.max(Math.trunc(days ?? FILE_DEFAULT_DAYS), 1), FILE_MAX_DAYS);
  return new Date(now.getTime() + d * 86_400_000);
}
export const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

/** Pinned REQUIRED line on every file_share result (host-facing, every host). */
export const FILE_LINK_RULE =
  "Put this link in the email body on its own line. Say the file is attached only if your email tool attached it. Do not send the email yourself.";

/** Host guidance: how each host gets the file it built to file_share. */
export const FILE_SHARE_HOW =
  "How to share a file you built: call file_share with job_number, kind, filename (ending .pdf, .xlsx, .docx, .csv or .png) and content_base64 (the file's bytes, base64). ChatGPT: if the file is a chat upload Athena can read, pass it as file instead. Claude, Codex and Grok Bot: base64 the file you built (in your code tool) and pass content_base64. Athena checks it, stores it privately for this job and returns a link anyone with it can open for 30 days. Put the link in the email body.";

/** Member-facing download page (no tool names, no hosting names). Blue/gray only. */
export function goneHtml(): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Link unavailable</title></head>` +
    `<body style="margin:0;background:#F3F4F6;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#6B7280">` +
    `<main style="max-width:480px;margin:15vh auto;background:#FFFFFF;border:1px solid #D1D5DB;border-radius:12px;padding:32px">` +
    `<h1 style="margin:0 0 12px;font-size:20px;color:#2563EB">This link isn't available</h1>` +
    `<p style="margin:0;line-height:1.5">It has expired or was turned off. Ask the sender for a new link.</p>` +
    `<p style="margin:24px 0 0;font-size:12px;color:#9CA3AF">Athena powered by ALP</p></main></body></html>`
  );
}

/** Headers for the download response: always a download, never rendered inline from our origin. */
export function downloadHeaders(name: string, mime: string, size?: number): Headers {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const h = new Headers({
    "content-type": mime,
    "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex",
  });
  if (size !== undefined) h.set("content-length", String(size));
  return h;
}
