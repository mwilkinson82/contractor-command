import { ToolError, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, text, type Sb } from "../guard";
import { boardFor, resolveSubmittalJob } from "./submittal-tools";
import { guide } from "../visible";
import type { CardModel, CardRow } from "../cards/model";
import {
  buildSubmittalPdf,
  findPackagePiece,
  packageGaps,
  pieceRef,
  storedPiece,
  SUBMITTAL_BUCKET,
  PACKAGE_MAX_BYTES,
  type PackageContext,
  type PackageFile,
} from "../submittal-package";
import { newToken, tokenHash, sha256Hex, allowedDownloadUrl } from "../file-share";
import { outboundEmailDisabled } from "../email-safety";
import { submittalRecordUrl } from "../board-url";
import { callHost } from "../call-host";
import { allowedDrawingDownloadUrl } from "../drawing-set";

/** One line per piece: short name, what, who, status, whether a file is stored, and the id any host can pass back. */
function pieceLine(item: PackageContext["items"][number], n: number): string {
  const stored = !!item.file_ref?.trim() && ["received", "approved"].includes(item.status);
  return `${pieceRef(n)} · ${item.kind.replace(/_/g, " ")} · ${item.source_party} · ${item.status}${stored ? " · file stored" : " · no file yet"}${item.id ? ` · piece id ${item.id}` : ""}`;
}

const COVER_RULE =
  "Built packages contain the server-generated company cover and transmittal before the included documents.";
const ids = {
  job_number: z.string().trim().min(1).max(40),
  company_id: z.string().uuid().optional(),
  submittal_id: z.string().uuid().optional(),
  submittal_number: z.string().trim().min(1).max(40).optional(),
};
export async function submittalRpc<T>(
  sb: Sb,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(fn, args);
  if (error) dbError(error);
  return data as T;
}
export function packageCard(
  title: string,
  ctx: PackageContext,
  lines: (string | CardRow)[],
  extra: Record<string, unknown> = {},
) {
  const card: CardModel = {
    state: "result",
    title,
    show_state: false,
    job: `${ctx.job_number} – ${ctx.job_name}`,
    kpis: [
      { label: "Transmittal", value: `T-${ctx.transmittal_number}` },
      { label: "Revision", value: String(ctx.submittal.revision) },
    ],
    sections: [
      {
        heading: ctx.submittal.title,
        kind: "list",
        rows: [
          { cells: [`Submittal ${ctx.submittal.number} · Spec ${ctx.submittal.spec_section}`] },
          ...lines.map((l) =>
            typeof l !== "string"
              ? l
              : {
                  cells: [l],
                  href: l.startsWith("Private preview (10 minutes): ")
                    ? l.slice("Private preview (10 minutes): ".length)
                    : null,
                },
          ),
        ],
      },
    ],
  };
  return guide(
    {
      ...text(
        lines.map((line) => (typeof line === "string" ? line : line.cells.join("\n"))).join("\n"),
      ),
      structuredContent: { card, ...extra },
    },
    "Show the Athena card and full details; never claim an email was sent without a successful provider receipt.",
  );
}
async function identify(sb: Sb, job: string, id?: string, number?: string) {
  if (id) return id;
  if (!number) throw new ToolError("Which submittal number from the living log?");
  const result = await sb
    .from("mcp_submittals")
    .select("id,number,revision")
    .eq("job_id", job)
    .eq("number", number)
    .order("revision", { ascending: false })
    .limit(1);
  if (result.error) dbError(result.error);
  if (!result.data?.[0]) throw new ToolError("That submittal number is not in this job’s log.");
  return result.data[0].id as string;
}
async function context(sb: Sb, job: string, submittal: string) {
  return submittalRpc<PackageContext>(sb, "mcp_submittal_package_context", {
    _job: job,
    _submittal: submittal,
  });
}
async function bounded(response: Response) {
  if (!response.ok || !response.body)
    throw new ToolError("The file could not be read. Nothing was sent.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > PACKAGE_MAX_BYTES) {
      await reader.cancel();
      throw new ToolError("The file is over 50 MB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
function fileType(name: string) {
  const ext = name.split(".").at(-1)?.toLowerCase();
  const types: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv",
  };
  if (!ext || !types[ext] || /[\\/]/.test(name) || /\p{Cc}/u.test(name))
    throw new ToolError("Use a PDF, PNG, JPEG, DOCX, XLSX or CSV filename.");
  return types[ext];
}
export const submittalPackage = defineTool({
  name: "submittal_package",
  title: "Collect and build a submittal package",
  description:
    "Stores received submittal pieces without overwriting originals, naming each piece by its short name (P1, P2), its piece id, or its kind and source as the submittal card shows them, and builds a versioned package whose first pages are the company cover and transmittal, with a private download preview.",
  inputSchema: {
    ...ids,
    action: z.enum(["get", "upload_piece", "build", "renew_link", "revoke"]),
    package_item_id: z.string().uuid().optional(),
    package_item: z.string().trim().min(1).max(200).optional(),
    package_id: z.string().uuid().optional(),
    filename: z.string().trim().min(1).max(120).optional(),
    content_base64: z
      .string()
      .max(Math.ceil(PACKAGE_MAX_BYTES / 3) * 4)
      .optional(),
    file: z.object({ download_url: z.string().url() }).optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: (args, ctx) =>
    run("submittal_package", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveSubmittalJob(
        sb,
        args.job_number,
        args.company_id,
        args.action === "get" ? undefined : "full",
      );
      if (!job) throw new ToolError("Which job has this submittal?");
      const sid = await identify(sb, job.job_id, args.submittal_id, args.submittal_number);
      let data = await context(sb, job.job_id, sid);
      if (data.is_current === false && !["get", "revoke"].includes(args.action))
        throw new ToolError("Use the latest revision from the living log.");
      if (args.action === "upload_piece") {
        const named = args.package_item ?? args.package_item_id;
        if (!named || !args.filename)
          throw new ToolError(
            `Name the package piece and its filename. Pieces on this submittal: ${data.items.length ? data.items.map(pieceLine).join("; ") : "none logged yet; add them with submittal_log package_items first"}.`,
          );
        let piece: PackageContext["items"][number] | null;
        try {
          piece = findPackagePiece(data.items, named);
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : "Name one piece.");
        }
        if (!piece?.id)
          throw new ToolError(
            `That piece is not on this submittal. Pieces: ${data.items.length ? data.items.map(pieceLine).join("; ") : "none logged yet; add them with submittal_log package_items first"}.`,
          );
        const pieceId = piece.id;
        const mime = fileType(args.filename);
        let bytes: Uint8Array;
        if (args.content_base64) {
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(args.content_base64) || args.content_base64.length % 4)
            throw new ToolError("The file bytes are invalid.");
          try {
            bytes = Uint8Array.from(atob(args.content_base64), (c) => c.charCodeAt(0));
          } catch {
            throw new ToolError("The file bytes are invalid.");
          }
        } else if (
          args.file?.download_url &&
          (allowedDownloadUrl(args.file.download_url) ||
            allowedDrawingDownloadUrl(args.file.download_url))
        )
          bytes = await bounded(
            await fetch(args.file.download_url, {
              redirect: "manual",
              signal: AbortSignal.timeout(30000),
            }),
          );
        else
          throw new ToolError(
            "Pass the received file bytes or the AI-hosted file; Athena never edits the supplier copy.",
          );
        if (!bytes.length || bytes.length > PACKAGE_MAX_BYTES)
          throw new ToolError("The file must be between 1 byte and 50 MB.");
        const path = `${job.company_id}/${job.job_id}/pieces/${crypto.randomUUID()}/${args.filename}`;
        const up = await sb.storage
          .from(SUBMITTAL_BUCKET)
          .upload(path, bytes, { contentType: mime, upsert: false });
        if (up.error) throw new ToolError("The received file could not be stored. Try again.");
        data = await submittalRpc(sb, "mcp_submittal_package_write", {
          _job: job.job_id,
          _submittal: sid,
          _action: "attach",
          _p: { item_id: pieceId, path },
        });
      }
      if (args.action === "revoke") {
        if (!args.package_id) throw new ToolError("Which package link should be turned off?");
        data = await submittalRpc(sb, "mcp_submittal_package_write", {
          _job: job.job_id,
          _submittal: sid,
          _action: "revoke",
          _p: { package_id: args.package_id },
        });
        return packageCard("Package link turned off", data, [
          "The link is off. Original files and saved packages are preserved.",
        ]);
      }
      const recordUrl = submittalRecordUrl(await boardFor(sb, job), data.submittal.number);
      const recordRow: CardRow[] = recordUrl
        ? [{ cells: [`Record page: ${recordUrl}`], href: recordUrl }]
        : [];
      const gaps = packageGaps(data);
      if (gaps.length)
        return packageCard("Collect the missing pieces", data, [...gaps, ...recordRow], {
          ready: false,
          items: data.items.map((item, n) => ({ ref: pieceRef(n), ...item })),
          record_url: recordUrl,
        });
      if (args.action === "build" && !data.package) {
        const files: PackageFile[] = [];
        let total = 0;
        for (const item of data.items.filter(
          (i) => !!i.file_ref && ["received", "approved"].includes(i.status),
        )) {
          const ref = storedPiece(item.file_ref!, job.company_id, job.job_id);
          const { data: blob, error } = await sb.storage.from(ref.bucket).download(ref.path);
          if (error || !blob)
            throw new ToolError(
              `The stored ${item.kind.replace(/_/g, " ")} from ${item.source_party} could not be read.`,
            );
          total += blob.size;
          if (total > PACKAGE_MAX_BYTES)
            throw new ToolError("The package files total more than 50 MB.");
          files.push({ item, name: ref.name, bytes: new Uint8Array(await blob.arrayBuffer()) });
        }
        let logo: Uint8Array | undefined;
        // Only read a configured logo in this backend's own Storage; no arbitrary URL fetch.
        // A logo that cannot be read is left off the cover; it never stops the package.
        if (data.brand.logo_url) {
          try {
            const backend = (sb as unknown as { supabaseUrl: string }).supabaseUrl;
            const url = new URL(data.brand.logo_url);
            if (
              backend &&
              url.origin === new URL(backend).origin &&
              url.pathname.startsWith("/storage/v1/object/public/") &&
              /\.(png|jpe?g)$/i.test(url.pathname)
            ) {
              const response = await fetch(url, {
                redirect: "manual",
                signal: AbortSignal.timeout(10000),
              });
              if (Number(response.headers.get("content-length")) <= 1024 * 1024) {
                const bytes = await bounded(response);
                if (bytes.length <= 1024 * 1024) logo = bytes;
              }
            }
          } catch {
            logo = undefined;
          }
        }
        const built = await buildSubmittalPdf(data, files, logo);
        const id = crypto.randomUUID();
        const filename = `Submittal-${data.submittal.number.replace(/[^A-Za-z0-9-]/g, "-")}-R${data.submittal.revision}-T${data.transmittal_number}-${data.today}.pdf`;
        const path = `${job.company_id}/${job.job_id}/packages/${id}/${filename}`;
        const up = await sb.storage
          .from(SUBMITTAL_BUCKET)
          .upload(path, built.bytes, { contentType: "application/pdf", upsert: false });
        if (up.error) throw new ToolError("The package could not be stored.");
        const signed = await sb.storage.from(SUBMITTAL_BUCKET).createSignedUrl(path, 30 * 86400);
        if (signed.error || !signed.data?.signedUrl)
          throw new ToolError("The private package link could not be prepared.");
        const token = newToken();
        data = await submittalRpc(sb, "mcp_submittal_package_write", {
          _job: job.job_id,
          _submittal: sid,
          _action: "save",
          _p: {
            id,
            path,
            filename,
            fingerprint: data.fingerprint,
            sha256: await sha256Hex(built.bytes),
            size_bytes: built.bytes.length,
            page_count: built.pageCount,
            cover_date: data.today,
            manifest: built.manifest,
            token_hash: await tokenHash(token),
            download_url: `https://app.meetathena.io/r/submittal-file/${token}`,
            signed_url: signed.data.signedUrl,
            expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          },
        });
      }
      if (args.action === "renew_link") {
        if (!data.package) throw new ToolError("Build a current package before renewing its link.");
        const signed = await sb.storage
          .from(SUBMITTAL_BUCKET)
          .createSignedUrl(data.package.path, 30 * 86400);
        if (signed.error || !signed.data?.signedUrl)
          throw new ToolError("The renewed package link could not be prepared.");
        const token = newToken();
        data = await submittalRpc(sb, "mcp_submittal_package_write", {
          _job: job.job_id,
          _submittal: sid,
          _action: "renew",
          _p: {
            package_id: data.package.id,
            token_hash: await tokenHash(token),
            signed_url: signed.data.signedUrl,
            download_url: `https://app.meetathena.io/r/submittal-file/${token}`,
            expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          },
        });
      }
      const artifact = data.package;
      const lines: (string | CardRow)[] = [...data.items.map(pieceLine), ...recordRow];
      if (artifact) {
        const privatePreview = await sb.storage
          .from(SUBMITTAL_BUCKET)
          .createSignedUrl(artifact.path, 600);
        if (privatePreview.error || !privatePreview.data?.signedUrl)
          throw new ToolError("The private preview could not be prepared.");
        const previewToken = newToken();
        await submittalRpc(sb, "mcp_submittal_preview", {
          _job: job.job_id,
          _package: artifact.id,
          _token_hash: await tokenHash(previewToken),
          _signed_url: privatePreview.data.signedUrl,
        });
        const previewUrl = `https://app.meetathena.io/r/submittal-preview/${previewToken}`;
        lines.unshift(
          `Package ready: ${artifact.filename} · ${artifact.page_count} pages.`,
          `Private preview (10 minutes): ${previewUrl}`,
          artifact.sent_at
            ? `Package sent ${artifact.sent_at.slice(0, 10)}; provider receipt recorded.`
            : "Not sent. Review the exact recipient, email and package before approving delivery.",
        );
      } else lines.unshift("Every required file is collected. Build the package next.");
      return guide(
        packageCard("Submittal package", data, lines, {
          record_url: recordUrl,
          package: artifact
            ? {
                id: artifact.id,
                filename: artifact.filename,
                download_url: artifact.download_url,
                expires_at: artifact.expires_at,
                sent_at: artifact.sent_at ?? null,
                page_count: artifact.page_count,
                approved: !!artifact.approved_at,
                revoked: !!artifact.revoked_at,
              }
            : null,
          items: data.items.map((item, n) => ({ ref: pieceRef(n), ...item })),
          ready: !!artifact,
          sent: !!artifact?.sent_at,
        }),
        artifact
          ? `${COVER_RULE} Give the member the private preview link and the record page link as they are.`
          : `${COVER_RULE} Call submittal_package build when the member asks for the package.`,
      );
    }),
});
export const submittalDelivery = defineTool({
  name: "submittal_delivery",
  title: "Review and record a submittal email",
  description:
    "Saves an exact package or chase draft, waits for approval and records a successful email provider receipt separately before counting a send.",
  inputSchema: {
    ...ids,
    action: z.enum(["draft", "get", "approve", "record_sent"]),
    kind: z.enum(["package", "chase"]).optional(),
    package_id: z.string().uuid().optional(),
    package_item_id: z.string().uuid().optional(),
    delivery_id: z.string().uuid().optional(),
    draft_key: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
    draft: z
      .object({
        to: z.email(),
        cc: z.array(z.email()).max(20).default([]),
        subject: z.string().trim().min(1).max(300),
        body: z.string().trim().min(1).max(20000),
        link: z.string().nullable().optional(),
        attachment: z.null().optional(),
      })
      .optional(),
    confirmed: z.literal(true).optional(),
    provider: z.string().trim().min(1).max(80).optional(),
    message_id: z.string().trim().min(1).max(300).optional(),
    sent_at: z.iso.datetime({ offset: true }).optional(),
    recipient_name: z.string().trim().max(120).optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run("submittal_delivery", ctx, { jobNumber: args.job_number }, async (sb) => {
      const job = await resolveSubmittalJob(sb, args.job_number, args.company_id, "full");
      if (!job) throw new ToolError("Which job has this submittal?");
      if (args.action === "approve" && outboundEmailDisabled())
        throw new ToolError("Email sending is turned off. Nothing was sent.");
      const sid = await identify(sb, job.job_id, args.submittal_id, args.submittal_number);
      const data = await context(sb, job.job_id, sid);
      const saved = await submittalRpc<{
        id: string;
        draft_key: string;
        draft: { to: string; cc: string[]; subject: string; body: string };
        approved_at: string | null;
        already_approved?: boolean;
        sent_at: string | null;
      }>(sb, "mcp_submittal_delivery", {
        _job: job.job_id,
        _submittal: sid,
        _action: args.action,
        // The host that approved or recorded this send goes on the project-record event; no host sends a conversation id yet.
        _p: { ...args, host: callHost(ctx), thread_ref: null },
      });
      const lines = [
        saved.sent_at
          ? "Send recorded from the email provider receipt."
          : saved.approved_at
            ? "Approval saved. Send receipt not yet recorded."
            : "Draft saved. Not sent. Wait for a separate yes.",
        {
          cells: [
            `To: ${saved.draft.to}`,
            `CC: ${saved.draft.cc.join(", ") || "None"}`,
            `Subject: ${saved.draft.subject}`,
            "",
            saved.draft.body,
          ],
          tone: "literal" as const,
          raw: true,
        },
      ];
      return guide(
        packageCard("Submittal delivery", data, lines, {
          delivery_id: saved.id,
          draft_key: saved.draft_key,
          draft: saved.draft,
          approved: !!saved.approved_at,
          sent: !!saved.sent_at,
          send_allowed: !outboundEmailDisabled(),
          send_confirmed:
            args.action === "approve" &&
            !!saved.approved_at &&
            !saved.sent_at &&
            saved.already_approved !== true,
          already_approved: saved.already_approved === true,
          // The email card re-drafts and approves with these ids; nothing here is new to the caller.
          kind: args.kind ?? "package",
          submittal_id: sid,
          package_item_id: args.package_item_id ?? null,
          job_number: job.job_number,
          company_id: job.company_id,
        }),
        saved.sent_at
          ? "This send is already recorded. Show the card; do not send it again."
          : saved.approved_at
            ? args.action === "approve" && saved.already_approved !== true
              ? "The member approved this exact draft; use structuredContent.draft.to, cc, subject and body unchanged with their connected email tool, never reconstruct them from card text. Send it once, then call submittal_delivery record_sent with the successful provider message id and sent time; a failure must never be recorded as sent."
              : "This draft was already approved but has no send receipt. Check connected Sent mail before retrying: record an existing successful receipt, or send once only if the provider confirms it was not sent."
            : "Show the full draft and wait for approval; never send automatically.",
      );
    }),
});
