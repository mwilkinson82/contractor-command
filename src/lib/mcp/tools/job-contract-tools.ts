// Job contracts: every contract on a job (prime with the client, subcontracts, supplier contracts/POs, other),
// with who it is with, what it covers, value, status and the saved original. One tool, list or save.
// Full and contract job access read and write; a Super sees none. Written only by mcp_job_contract_save.
import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, run, type Sb } from "../guard";
import { resolveSubmittalJob } from "./submittal-tools";
import type { CardModel } from "../cards/model";
import { renderHtml } from "../cards/html";
import { renderMarkdown } from "../cards/markdown";
import { cardWidgetMeta } from "../cards/widget";
import { callHost } from "../call-host";
import { jobLinksMissingToken, signedJobPages } from "../board-url";

export const CONTRACT_KINDS = ["prime", "subcontract", "supplier", "other"] as const;
export const CONTRACT_STATUSES = ["draft", "sent", "signed", "void"] as const;
export const CONTRACT_SOURCES = [
  "chat",
  "upload",
  "client_page",
  "signing_page",
  "proposal",
  "purchase_order",
] as const;
export type JobContract = {
  id: string;
  kind: (typeof CONTRACT_KINDS)[number];
  counterparty: string;
  party_id?: string | null;
  party_name?: string | null;
  po_id?: string | null;
  po_number?: string | null;
  title?: string | null;
  tag?: string | null;
  cost_code?: string | null;
  value_cents?: number | null;
  status: (typeof CONTRACT_STATUSES)[number];
  sent_on?: string | null;
  signed_on?: string | null;
  document_id?: string | null;
  source?: string | null;
  note?: string | null;
  version: number;
};
export type JobContractsPayload = {
  job_id: string;
  job_number: string;
  job_name: string;
  contracts: JobContract[];
};
/** What a save returns: the saved row plus its previous and new status, so a notice can be sent server-side. */
export type SavedContract = JobContract & {
  contract_id: string;
  changed: boolean;
  previous_status: JobContract["status"] | null;
  status_changed: boolean;
};

/** The Contracts section of the job board: the signed project home link with #contracts. */
export function contractsBoardUrl(signedFieldUrl: string | null | undefined): string | null {
  if (!signedFieldUrl) return null;
  try {
    const url = new URL(signedFieldUrl);
    if (
      url.origin !== "https://app.meetathena.io" ||
      !/^\/r\/job\/[^/]+\/field$/.test(url.pathname)
    )
      return null;
    if (!url.searchParams.get("t")) return null;
    url.pathname = url.pathname.replace(/\/field$/, "/home");
    url.hash = "contracts";
    const out = url.toString();
    return jobLinksMissingToken(out).length ? null : out;
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<JobContract["kind"], string> = {
  prime: "Prime",
  subcontract: "Subcontract",
  supplier: "Supplier",
  other: "Other",
};
const usd = (cents: unknown) =>
  typeof cents === "number"
    ? (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "";
const statusText = (c: JobContract) =>
  c.status === "signed"
    ? `Signed${c.signed_on ? ` ${c.signed_on}` : ""}`
    : c.status === "sent"
      ? `Sent${c.sent_on ? ` ${c.sent_on}` : ""}`
      : c.status === "void"
        ? "Void"
        : "Draft";

/** The next step to offer after a save, in the member's words. */
export function contractNextStep(saved: JobContract | null | undefined): string {
  if (!saved) return "Drop in or name a contract and Athena lists it here after you confirm.";
  if (saved.status === "void") return "Voided. It stays on the job's record.";
  if (!saved.cost_code) return "Want to tag it to a cost code?";
  if (saved.value_cents == null) return "What's the contract value?";
  if (saved.status === "signed" && !saved.document_id) return "Upload the signed copy?";
  if (saved.status === "draft") return "Tell me when it's sent or signed and I'll update it.";
  return "Anything else on this contract, or another one to add?";
}

/** The contracts card. Pure, so it is tested without a database. */
export function jobContractsCard(
  payload: JobContractsPayload,
  saved?: SavedContract | null,
  boardUrl?: string | null,
): CardModel {
  const all = payload.contracts;
  const live = all.filter((c) => c.status !== "void");
  const signed = live.filter((c) => c.status === "signed");
  const committed = live
    .filter((c) => c.kind !== "prime")
    .reduce((t, c) => t + (typeof c.value_cents === "number" ? c.value_cents : 0), 0);
  const prime = live.find((c) => c.kind === "prime");
  const columns = ["Contract", "With", "Scope", "Cost code", "Value", "Status"];
  return {
    state: "result",
    show_state: false,
    title: "Contracts",
    job: `${payload.job_number} – ${payload.job_name}`,
    kpis: [
      {
        label: "Prime contract",
        value: prime ? usd(prime.value_cents) || "No value yet" : "None yet",
      },
      { label: "Subcontracts and suppliers", value: usd(committed) },
      { label: "Signed", value: `${signed.length} of ${live.length}` },
    ],
    sections: [
      {
        heading: "Contracts on this job",
        kind: "table",
        columns,
        rows: all.length
          ? all.map((c) => ({
              cells: [
                `${KIND_LABEL[c.kind]}${c.title ? ` · ${c.title}` : ""}${c.po_number ? ` · PO ${c.po_number}` : ""}`,
                c.counterparty,
                c.tag ?? "",
                c.cost_code ?? "",
                usd(c.value_cents),
                statusText(c),
              ],
              refId: c.id,
              tone: saved && c.id === saved.id ? ("known" as const) : null,
            }))
          : [{ cells: ["No contracts on this job yet.", ...columns.slice(1).map(() => "")] }],
      },
      ...(boardUrl
        ? [
            {
              heading: "Job board",
              kind: "chips" as const,
              rows: [
                {
                  cells: ["Open Contracts on the job board"],
                  href: boardUrl,
                  tone: "action" as const,
                },
              ],
            },
          ]
        : []),
    ],
    next_move: saved
      ? `${saved.changed ? `Saved v${saved.version}.` : "Nothing changed."} ${contractNextStep(saved)}`
      : contractNextStep(null),
  };
}

async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => PromiseLike<{ data: T; error: { message?: string } | null }>
  )(fn, args);
  if (error) dbError(error);
  return data;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().trim().max(max);

export const jobContracts = defineTool({
  name: "job_contracts",
  title: "Job contracts",
  description:
    "Lists or saves the contracts on a job: the prime contract with the client, subcontracts, supplier contracts and POs, and other agreements, with who each is with, the scope or trade it covers (tag), cost code, value, status (draft, sent, signed, void), dates and the saved original. " +
    "When a member drops in or names a contract in chat, read from the document who it is with, its kind, scope, value and dates, show them to the member, and save only after the member confirms. Never mark a contract sent or signed, or give a sent or signed date, unless the member said so. " +
    "To change a saved contract, list first and pass its contract_id, the expected_version you listed and a reason; only the fields you send change, and null clears one. Link document_id only to a document project_documents lists on this job. " +
    "Saved contracts show in the Contracts section of the job board (project home, /r/job/<job id>/home#contracts); give the member the board_url this tool returns, never a link you build. After saving, walk the member to the next step on the card (for example: Want to tag it to a cost code? Upload the signed copy?). Nothing is sent to anyone.",
  inputSchema: {
    action: z.enum(["list", "save"]),
    job_number: z.string().trim().min(1).max(40),
    company_id: z.string().uuid().optional(),
    contract_id: z
      .string()
      .uuid()
      .optional()
      .describe("Saved contract to change. Leave out to add a new one."),
    expected_version: z.number().int().min(1).optional(),
    reason: text(500)
      .optional()
      .describe("Why a saved contract is changing. Needed on every change."),
    kind: z.enum(CONTRACT_KINDS).optional(),
    counterparty: text(200).min(1).optional().describe("Who the contract is with."),
    party_id: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .describe("The job's saved subcontractor or supplier."),
    po_id: z
      .string()
      .uuid()
      .nullable()
      .optional()
      .describe("The job's purchase order behind this contract."),
    title: text(200).nullable().optional(),
    tag: text(200).nullable().optional().describe("The trade or scope the contract covers."),
    cost_code: text(60).nullable().optional(),
    value_cents: z.number().int().min(0).nullable().optional(),
    status: z.enum(CONTRACT_STATUSES).optional(),
    sent_on: date.nullable().optional(),
    signed_on: date.nullable().optional(),
    document_id: z.string().uuid().nullable().optional(),
    source: z
      .enum(CONTRACT_SOURCES)
      .optional()
      .describe("How the contract reached Athena. Usually chat or upload."),
    note: text(2000).nullable().optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "job_contracts",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        const job = await resolveSubmittalJob(sb, args.job_number, args.company_id);
        if (!job) throw new ToolError("Name the job for these contracts.");
        const { action, job_number: _n, company_id: _c, ...fields } = args;
        void _n;
        void _c;
        let saved: SavedContract | null = null;
        if (action === "save") {
          if (!fields.contract_id && (!fields.kind || !fields.counterparty))
            throw new ToolError(
              "Say what kind of contract it is and who it is with. Nothing was saved.",
            );
          const p: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(fields)) if (v !== undefined) p[k] = v;
          saved = await rpc<SavedContract>(sb, "mcp_job_contract_save", {
            _job: job.job_id,
            _p: p,
          });
        }
        const payload = await rpc<JobContractsPayload>(sb, "mcp_job_contract_rows", {
          _job: job.job_id,
        });
        // Only full job access gets a signed board link; contract-only roles open the board signed in.
        const board =
          job.scope === "full"
            ? await signedJobPages((fn, a) => sb.rpc(fn, a), job.job_id, job.scope)
            : {};
        const boardUrl = contractsBoardUrl(board.field);
        const card = jobContractsCard(payload, saved, boardUrl);
        return {
          content: [{ type: "text" as const, text: renderMarkdown(card) }],
          structuredContent: {
            card,
            html: renderHtml(card),
            job_id: payload.job_id,
            board_url: boardUrl,
            contracts: payload.contracts,
            ...(saved
              ? {
                  saved,
                  contract_id: saved.contract_id,
                  previous_status: saved.previous_status,
                  status: saved.status,
                  status_changed: saved.status_changed,
                  host: callHost(ctx),
                  next_step: contractNextStep(saved),
                }
              : {}),
          },
          _meta: cardWidgetMeta,
        };
      },
    ),
});
