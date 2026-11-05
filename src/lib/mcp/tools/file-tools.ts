// 0.8.11: file_share and file_share_revoke. The host builds the file; Athena stores it privately per job and
// returns a link that opens for anyone who has it (expires in 30 days by default; can be turned off).
import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text, type Sb } from "../guard";
import { FULL_ACCESS_MESSAGE, READ_ONLY_MESSAGE, audit, named, prefix, resolveJob } from "../jobs";
import { guide } from "../visible";
import { cpmLookaheadPdf, cpmLookaheadPdfName, lookaheadPdf, lookaheadPdfName } from "../lookahead-pdf";
import { lookaheadPlan } from "../../cpm-gantt";
import { readScheduleControl } from "../schedule-control";
import type { LivingData } from "../living";
import { pdfContractorBrand } from "../document-email-brand";
import { lookaheadData } from "./workflow-tools";
import { LOOKAHEAD_PDF_EMAIL_RULE } from "../email-safety";
import {
  FILE_B64_MAX_CHARS, FILE_BUCKET, FILE_DEFAULT_DAYS, FILE_KINDS, FILE_LINK_RULE, FILE_MAX_BYTES, FILE_MAX_DAYS,
  FileRejected, OPTIONS_SHARE_REFUSAL, allowedDownloadUrl, decodeBase64, expiry, fmtDate, kindAllowed, looksLikeOptionsComparison, newToken, sha256Hex, shareLink,
  storagePath, tokenFromLink, tokenHash, validateFile, type FileKind,
} from "../file-share";
import { immutableDrawingDeleteRefused } from "../drawing-set";

const jobNumber = z.string().trim().min(1).max(40);
const companyId = z.string().trim().min(1).max(200).optional();

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
  if (error) dbError(error);
  return data as T;
}

/** ChatGPT file param: fetched once, https only, OpenAI file hosts only, no redirects, size-capped. */
async function fetchFile(url: string): Promise<Uint8Array> {
  if (!allowedDownloadUrl(url)) throw new FileRejected("Athena can't read that file link. Pass the file's bytes as content_base64 instead. Nothing was shared.");
  const res = await fetch(url, { redirect: "error" });
  if (!res.ok || !res.body) throw new FileRejected("Athena couldn't download that file. Pass the file's bytes as content_base64 instead. Nothing was shared.");
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > FILE_MAX_BYTES) throw new FileRejected(`That file is over ${FILE_MAX_BYTES / 1024 / 1024} MB, the most Athena can share. Nothing was shared.`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > FILE_MAX_BYTES) { await reader.cancel(); throw new FileRejected(`That file is over ${FILE_MAX_BYTES / 1024 / 1024} MB, the most Athena can share. Nothing was shared.`); }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Deletes a share object. Refuses stored drawing originals and saved markups. */
async function removeStored(sb: Sb, path: string) {
  const refusal = immutableDrawingDeleteRefused(FILE_BUCKET, path);
  if (refusal) throw new ToolError(refusal);
  await sb.storage.from(FILE_BUCKET).remove([path]);
}

/** Store a checked file privately for the job and make its share link (used by file_share and lookahead_pdf). */
export async function storeFile(sb: Sb, job: { job_id: string; company_id: string }, kind: FileKind, f: { name: string; mime: string; size: number }, bytes: Uint8Array, days?: number) {
  const id = crypto.randomUUID();
  const path = storagePath(job.company_id, job.job_id, id, f.name);
  const token = newToken();
  const exp = expiry(days);
  const seconds = Math.ceil((exp.getTime() - Date.now()) / 1000);
  const up = await sb.storage.from(FILE_BUCKET).upload(path, bytes, { contentType: f.mime, upsert: false, cacheControl: "no-store" });
  if (up.error) throw new ToolError("Athena couldn't store that file right now. Nothing was shared. Try again in a moment.");
  const signed = await sb.storage.from(FILE_BUCKET).createSignedUrl(path, seconds);
  if (signed.error || !signed.data?.signedUrl) {
    await removeStored(sb, path);
    throw new ToolError("Athena couldn't make a link for that file right now. Nothing was shared. Try again in a moment.");
  }
  try {
    await rpc(sb, "mcp_file_share_create", {
      _id: id, _job: job.job_id, _kind: kind, _filename: f.name, _mime: f.mime, _size: f.size, _sha256: await sha256Hex(bytes),
      _path: path, _token_hash: await tokenHash(token), _signed_url: signed.data.signedUrl, _expires_at: exp.toISOString(),
    });
  } catch (e) {
    await removeStored(sb, path);
    throw e;
  }
  return { id, link: shareLink(token), exp };
}

/** True when an Athena file link (app.meetathena.io/f/...) is live: exists, not turned off, not expired. Doesn't count a download. */
export async function fileLinkLive(sb: Sb, link: string): Promise<{ filename: string; mime_type: string } | null> {
  const token = tokenFromLink(link);
  if (!token) return null;
  const { data, error } = await (sb.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)("mcp_file_share_open", { _token_hash: await tokenHash(token), _count: false });
  if (error || !data) return null;
  return data as { filename: string; mime_type: string };
}

const KIND_LABEL: Record<FileKind, string> = { sov: "SOV", schedule: "Schedule", report: "Report", notice: "Notice", other: "File" };

export const fileShare = defineTool({
  name: "file_share",
  title: "Share a file as a link",
  description: "Creates a job-scoped download link without registering a contract, specification, or drawing source.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    kind: z.enum(FILE_KINDS),
    filename: z.string().trim().min(1).max(120),
    content_base64: z.string().max(FILE_B64_MAX_CHARS).optional(),
    file: z.object({ download_url: z.string(), file_id: z.string(), mime_type: z.string().optional(), file_name: z.string().optional() }).optional(),
    expires_in_days: z.number().int().min(1).max(FILE_MAX_DAYS).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: (args, ctx) =>
    run("file_share", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      const kind = args.kind as FileKind;
      if (!kindAllowed(kind, job.scope)) throw new ToolError(job.scope === "super" ? READ_ONLY_MESSAGE : FULL_ACCESS_MESSAGE);
      let f: ReturnType<typeof validateFile>;
      let bytes: Uint8Array;
      try {
        if (args.content_base64) bytes = decodeBase64(args.content_base64);
        else if (args.file?.download_url) bytes = await fetchFile(args.file.download_url);
        else throw new FileRejected("Send the file's bytes as content_base64. Nothing was shared.");
        f = validateFile(bytes, args.filename || args.file?.file_name || "");
      } catch (e) {
        if (e instanceof FileRejected) throw new ToolError(e.message);
        throw e;
      }
      if (looksLikeOptionsComparison(f.name, bytes)) throw new ToolError(OPTIONS_SHARE_REFUSAL);
      const { id, link, exp } = await storeFile(sb, job, kind, f, bytes, args.expires_in_days);
      await audit(sb, job, "file_share", `share_file_${kind}`, id);
      return guide(
        {
          ...text([FILE_LINK_RULE, `${prefix(job)}${KIND_LABEL[kind]} link ready: ${f.name}`, `Link: ${link}`, `Anyone with this link can download the file until ${fmtDate(exp)}.`].join("\n")),
          structuredContent: { shared: true, source_document: false, link, filename: f.name, mime_type: f.mime, size_bytes: f.size, kind, expires_at: exp.toISOString(), attached: false },
        },
        `Put ${link} in the email body on its own line with the file name. Say "link" (not "attached") unless your email tool also attached the file. This result is a download share, not a registered project source. To add a contract or specification source use file_upload; for drawing sources use drawing_set_import. If the member wants the link turned off later, call file_share_revoke with this link.`,
      );
    }),
});

export const fileShareRevoke = defineTool({
  name: "file_share_revoke",
  title: "Turn off a file link",
  description: "Turns off a file link and deletes the stored file.",
  inputSchema: { job_number: jobNumber, company_id: companyId, link: z.string().trim().min(1).max(300) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  handler: (args, ctx) =>
    run("file_share_revoke", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      const token = tokenFromLink(args.link);
      if (!token) throw new ToolError("That isn't an Athena file link. Nothing was changed.");
      const r = await rpc<{ id: string; path: string; filename: string } | null>(sb, "mcp_file_share_revoke", { _job: job.job_id, _token_hash: await tokenHash(token) });
      if (!r) throw new ToolError("No file link like that on this job. Nothing was changed.");
      await removeStored(sb, r.path);
      await audit(sb, job, "file_share_revoke", "revoke_file_link", r.id);
      return guide(
        { ...text(`${prefix(job)}Link turned off: ${r.filename}. Anyone who opens it now sees that it's no longer available.`), structuredContent: { revoked: true, filename: r.filename } },
        "Tell the member the link is off. To share the file again, call file_share for a new link.",
      );
    }),
});

// ---------- lookahead_pdf ----------
export const lookaheadPdfTool = defineTool({
  name: "lookahead_pdf",
  title: "Lookahead as a PDF file (for email)",
  description:
    "Builds the job's two-week lookahead as a PDF and returns a download link; with a saved CPM it matches the schedule page, 1 to 6 weeks from the data date grouped by total float, start, WBS or any activity code, with stacked code filters, the data date line and the End of lookahead period line.",
  inputSchema: {
    job_number: jobNumber,
    company_id: companyId,
    lookahead_id: z.string().trim().min(1).max(64).optional(),
    weeks: z.number().int().min(1).max(6).optional(),
    group: z.string().trim().min(1).max(80).optional(),
    filters: z
      .array(z.object({ code_id: z.string().trim().min(1).max(80), value_ids: z.array(z.string().trim().min(1).max(160)).min(1).max(50) }))
      .max(10)
      .optional(),
    expires_in_days: z.number().int().min(1).max(FILE_MAX_DAYS).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: (args, ctx) =>
    run("lookahead_pdf", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveJob(sb, args.job_number, args.company_id);
      if (!kindAllowed("schedule", job.scope)) throw new ToolError(FULL_ACCESS_MESSAGE);
      // A job with a saved CPM needs no saved lookahead row: the window runs from the data date.
      const data = await lookaheadData(sb, job, args.lookahead_id ?? "latest").catch((e) => {
        if (args.lookahead_id || !(e instanceof ToolError)) throw e;
        return lookaheadData(sb, job, { id: "00000000-0000-0000-0000-000000000000", start_date: null, end_date: null }).then((d) => {
          if (!d.cpmData) throw e;
          return d;
        });
      });
      const brand = await pdfContractorBrand(sb, job.company_id);
      // A saved, calculated CPM prints the page's lookahead Gantt; a saved lookahead window from an export keeps the two-week calendar.
      const control = !args.lookahead_id && data.cpmData ? readScheduleControl(data.cpmData) : null;
      if (control && (data.cpmData as LivingData).activities?.length) {
        const r = lookaheadPlan(
          { data: data.cpmData as LivingData, control, dataDate: data.dataDate, contractCompletion: data.contractCompletion },
          { weeks: args.weeks, group: args.group, filters: args.filters },
        );
        if (!r.ok) throw new ToolError(`${prefix(job)}${r.message} Nothing was made.`);
        const p = r.plan;
        const start = new Date(p.dd).toISOString().slice(0, 10), end = new Date(p.t1 - 86_400_000).toISOString().slice(0, 10);
        const pdf = cpmLookaheadPdf({ title: named(job), plan: p, version: data.version, acts: data.acts, items: data.items, today: data.today, brand });
        let cf: ReturnType<typeof validateFile>;
        try { cf = validateFile(pdf, cpmLookaheadPdfName(job.job_number, p.weeks, start, end)); } catch (e) { if (e instanceof FileRejected) throw new ToolError(e.message); throw e; }
        const stored = await storeFile(sb, job, "schedule", cf, pdf, args.expires_in_days);
        await audit(sb, job, "lookahead_pdf", "share_lookahead_pdf", stored.id);
        const shown = [p.groupLabel.toLowerCase(), ...(p.filterLines.length ? [`only ${p.filterLines.join("; ")}`] : [])].join(", ");
        return guide(
          {
            ...text([`${prefix(job)}Lookahead PDF ready: ${cf.name} (${Math.max(1, Math.round(cf.size / 1024))} KB, ${p.weeks} ${p.weeks === 1 ? "week" : "weeks"} from the ${start} data date, ${shown}, ${p.count} ${p.count === 1 ? "activity" : "activities"}).`, `Download: ${stored.link}`, `The link works until ${fmtDate(stored.exp)}.`].join("\n")),
            structuredContent: { pdf: true, download_url: stored.link, filename: cf.name, mime_type: cf.mime, size_bytes: cf.size, weeks: p.weeks, group: p.groupLabel, filters: p.filterLines, activities: p.count, window: { start, end }, data_date: data.dataDate, expires_at: stored.exp.toISOString(), attached: false },
          },
          LOOKAHEAD_PDF_EMAIL_RULE(stored.link, cf.name),
        );
      }
      if (!data.win) throw new ToolError(`${prefix(job)}There's no lookahead window or saved schedule to put in a PDF yet. Send the schedule export (or save the CPM) first. Nothing was made.`);
      const bytes = lookaheadPdf({ title: named(job), ref: data.ref, start: data.win.start, end: data.win.end, dataDate: data.dataDate, acts: data.acts, items: data.items, today: data.today, brand, version: data.version });
      let f: ReturnType<typeof validateFile>;
      try { f = validateFile(bytes, lookaheadPdfName(job.job_number, data.win.start, data.win.end)); } catch (e) { if (e instanceof FileRejected) throw new ToolError(e.message); throw e; }
      const { id, link, exp } = await storeFile(sb, job, "schedule", f, bytes, args.expires_in_days);
      await audit(sb, job, "lookahead_pdf", "share_lookahead_pdf", id);
      return guide(
        {
          ...text([`${prefix(job)}Lookahead PDF ready: ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB, ${data.ref}, ${data.win.start} to ${data.win.end}).`, `Download: ${link}`, `The link works until ${fmtDate(exp)}.`].join("\n")),
          structuredContent: { pdf: true, download_url: link, filename: f.name, mime_type: f.mime, size_bytes: f.size, lookahead_ref: data.ref, window: data.win, data_date: data.dataDate, expires_at: exp.toISOString(), attached: false },
        },
        LOOKAHEAD_PDF_EMAIL_RULE(link, f.name),
      );
    }),
});
