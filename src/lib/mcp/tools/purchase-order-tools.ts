import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { run, dbError, text, type Sb } from "../guard";
import { memberCompanies, resolveJob } from "../jobs";
import { guide } from "../visible";

const line = z
  .object({
    description: z.string().trim().min(1).max(2000),
    quantity: z.number().positive().max(1e9),
    unit: z.string().trim().min(1).max(100),
    unit_price_cents: z.number().int().min(0).max(9e12),
  })
  .strict();
const facts = z
  .object({
    id: z.string().uuid().optional(),
    request_id: z.string().uuid().optional(),
    expected_version: z.number().int().min(0).max(2147483646).optional(),
    expected_default_version: z.number().int().min(0).max(2147483646).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    kind: z.enum(["supplier", "subcontractor", "both"]).optional(),
    trade: z.string().trim().min(1).max(200).nullable().optional(),
    contact_name: z.string().trim().min(1).max(200).nullable().optional(),
    contact_email: z.string().trim().min(1).max(320).nullable().optional(),
    contact_phone: z.string().trim().min(1).max(100).nullable().optional(),
    insurance_reference: z.string().trim().min(1).max(2000).nullable().optional(),
    contract_reference: z.string().trim().min(1).max(2000).nullable().optional(),
    scope: z.enum(["company", "supplier", "po"]).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().min(1).max(50000).optional(),
    source: z.string().trim().min(1).max(2000).optional(),
    change_note: z.string().trim().min(1).max(2000).optional(),
    parent_id: z.string().uuid().optional(),
    proposal_id: z.string().uuid().optional(),
    po_id: z.string().uuid().optional(),
    party_id: z.string().uuid().optional(),
    party_version: z.number().int().positive().max(2147483646).optional(),
    supplier_name: z.string().trim().min(1).max(200).optional(),
    number: z.string().trim().min(1).max(120).optional(),
    terms_id: z.string().uuid().optional(),
    status: z.enum(["draft", "reviewed", "approved"]).optional(),
    lines: z.array(line).min(1).max(100).optional(),
    order_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    needed_by: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
type Facts = z.infer<typeof facts>;
// Match the order field contract at mcp_project_purchase_orders_record (0041).
// supplier_name is only a review-time lookup hint; it is resolved before save.
const orderFields = new Set([
  "id",
  "request_id",
  "expected_version",
  "party_id",
  "party_version",
  "number",
  "terms_id",
  "status",
  "lines",
  "order_date",
  "needed_by",
  "reason",
]);
function validateOrderFields(p: Facts, reviewing: boolean) {
  const unexpected = Object.entries(p)
    .filter(
      ([key, value]) =>
        value !== undefined && !orderFields.has(key) && !(reviewing && key === "supplier_name"),
    )
    .map(([key]) => key);
  if (unexpected.length)
    throw new ToolError(
      `These facts do not apply to a purchase order: ${unexpected.join(", ")}. Remove them and review the order again. Nothing was saved.`,
    );
}
type Action =
  "party" | "terms" | "approve_company_terms" | "approve_terms" | "default_terms" | "order";
type Ledger = {
  parties: Array<{
    id: string;
    name: string;
    kind: "supplier" | "subcontractor" | "both";
    version: number;
    trade: string | null;
    contact_name: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    insurance_reference: string | null;
    contract_reference: string | null;
  }>;
  terms: Array<{
    id: string;
    title: string;
    body: string;
    scope: string;
    state: "proposed" | "approved";
    proposal_id: string | null;
    source: string;
    change_note: string | null;
    party_id: string | null;
    parent_id: string | null;
    po_id: string | null;
    approved_by: string | null;
  }>;
  default_terms_id: string | null;
  default_version: number | null;
  orders: Array<{
    id: string;
    number: string;
    party_id: string;
    versions: Array<{ version: number; status: string; terms_id: string }>;
  }>;
};
async function rpc<T>(sb: Sb, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (
    sb.rpc as unknown as (
      n: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: T; error: { message: string } | null }>
  )(name, args);
  if (error) dbError(error);
  return data;
}
function missing(action: Action, p: Facts): string[] {
  const out: string[] = [];
  const need = (ok: unknown, label: string) => {
    if (!ok) out.push(label);
  };
  if (action === "party") {
    need(p.name, "party name");
    need(p.kind, "supplier or subcontractor type");
    if (p.expected_version) {
      need(p.id, "party to revise");
      need(p.reason, "reason for party revision");
    }
  }
  if (action === "terms" || action === "approve_company_terms") {
    need(p.scope, "terms scope");
    need(p.title, "terms title");
    need(p.body?.trim(), "terms text");
    need(p.source, "terms source");
    if (p.scope === "company" && p.parent_id) need(p.change_note, "description of changes");
    if (p.scope && p.scope !== "company") {
      need(p.party_id, "project supplier");
      need(p.parent_id, "base terms version");
      need(p.change_note, "description of changes");
      if (p.scope === "po") need(p.po_id, "purchase order");
    }
  }
  if (action === "approve_terms") need(p.proposal_id, "proposed terms version");
  if (action === "default_terms") need(p.id, "approved company terms version");
  if (action === "order") {
    need(p.party_id, "project supplier");
    need(p.number, "purchase order number");
    need(p.lines?.length, "item or scope, quantity, unit and price");
    need(p.order_date, "order date");
    need(p.needed_by, "needed-by date");
    need(p.terms_id, "terms version");
    if (p.expected_version) {
      need(p.id, "purchase order to revise");
      need(p.reason, "reason for revision");
    }
  }
  return out;
}
function compareTerms(before: string, after: string) {
  const a = before.split("\n"),
    b = after.split("\n");
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  return {
    removed: a.slice(start, a.length - end).join("\n"),
    added: b.slice(start, b.length - end).join("\n"),
    unchanged_prefix_lines: start,
    unchanged_suffix_lines: end,
  };
}
const pageUrl = (job: string) => `https://app.meetathena.io/r/job/${job}/purchase-orders`;
const jobFields = {
  job_number: z.string().trim().min(1).max(40).optional(),
  company_id: z.string().trim().min(1).max(200).optional(),
};
const askJob = () =>
  guide(
    {
      ...text("Which job is this for? Nothing was saved."),
      structuredContent: { missing: ["job"], saved: false },
    },
    "Ask for the job number. Do not guess.",
  );
export const purchaseOrdersRead = defineTool({
  name: "purchase_orders_read",
  title: "Find project suppliers and purchase orders",
  description: "Reads project counterparties, purchase orders and terms versions for a job.",
  inputSchema: { ...jobFields },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "purchase_orders_read",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        if (!args.job_number) return askJob();
        const job = await resolveJob(sb, args.job_number, args.company_id, "full");
        const data = await rpc<Ledger>(sb, "mcp_project_purchase_orders_get", { _job: job.job_id });
        return guide(
          {
            ...text(
              `Purchase orders and project parties for ${job.job_number}. These are commitments, not posted costs or payments.\nProject records: ${pageUrl(job.job_id)}`,
            ),
            structuredContent: { ...data, records_url: pageUrl(job.job_id) } as never,
          },
          "Find the exact requested supplier or order by name or number. Ask if ambiguous. Show full selected terms and their parent when asked to compare, identifying versions and source; do not claim a redline file was stored or that a supplier accepted a variant. Draft and reviewed orders have not been issued or accepted. Contact, insurance and contract references are recorded evidence, not a compliance determination.",
        );
      },
    ),
});
export const purchaseOrderTermsRead = defineTool({
  name: "purchase_order_terms_read",
  title: "Read project purchase-order terms",
  description:
    "Reads terms and limited project party and order identifiers for the owner or contracts role without the financial ledger.",
  inputSchema: { ...jobFields },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "purchase_order_terms_read",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        if (!args.job_number) return askJob();
        const job = await resolveJob(sb, args.job_number, args.company_id);
        const data = await rpc<Ledger>(sb, "mcp_project_po_terms_get", { _job: job.job_id });
        return guide(
          {
            ...text(
              `Project terms for ${job.job_number}. Company terms are approved when explicitly recorded through company approval. Supplier/PO proposals are not effective until the owner approves a separate version.`,
            ),
            structuredContent: data as never,
          },
          "Use only the returned project identifiers and terms. Contracts may propose, not approve; the owner reviews and approves separately. Additional buy-in is not established. Do not infer issuance or expose financial ledger details.",
        );
      },
    ),
});

export const purchaseOrdersRecord = defineTool({
  name: "purchase_orders_record",
  title: "Review or save project party, terms or purchase order",
  description:
    "Reviews and after explicit confirmation saves a project party, supplier/PO terms proposal, company default or purchase order draft. approve_company_terms is a separate owner-only approval: saving it immediately records approved company-wide terms. Unapproved company terms cannot be saved. Never call an approval action when the user says save only or do not approve.",
  inputSchema: {
    ...jobFields,
    step: z.enum(["review", "save"]),
    action: z.enum([
      "party",
      "terms",
      "approve_company_terms",
      "approve_terms",
      "default_terms",
      "order",
    ]),
    facts,
    review_key: z.string().uuid().optional(),
    confirmed: z.boolean().optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: (args, ctx) =>
    run(
      "purchase_orders_record",
      ctx,
      { jobNumber: args.job_number, companyId: args.company_id },
      async (sb) => {
        if (!args.job_number) return askJob();
        if (args.action === "terms" && args.facts.scope === "company") {
          return guide(
            {
              ...text(
                "Nothing was saved or approved. Company terms cannot be stored unapproved in this workflow. Recording this company base would approve it for company-wide use, even without making it the default. I can keep the draft text in our conversation. Approval requires a separate owner instruction.",
              ),
              structuredContent: { saved: false, approval_required: true, scope: "company" },
            },
            "Respect save-only and do-not-approve instructions: do not call approve_company_terms or silently broaden supplier-only terms to company scope. Only after the owner explicitly authorizes company-wide approval, review approve_company_terms, disclose its approval effect, and ask for separate confirmation before saving. The confirmation flag is not proof of human approval.",
          );
        }
        if (args.action === "approve_company_terms" && args.facts.scope !== "company") {
          throw new ToolError("Company approval requires company-scoped terms. Nothing was saved.");
        }
        const termsOnly =
          args.action === "terms" ||
          args.action === "approve_terms" ||
          args.action === "approve_company_terms";
        const job = await resolveJob(
          sb,
          args.job_number,
          args.company_id,
          termsOnly ? undefined : "full",
        );
        const p: Facts = { ...args.facts };
        if (args.action === "order") validateOrderFields(p, args.step === "review");
        if (args.step === "review") {
          const state = await rpc<Ledger>(
            sb,
            termsOnly ? "mcp_project_po_terms_get" : "mcp_project_purchase_orders_get",
            {
              _job: job.job_id,
            },
          );
          if (args.action === "party" && p.expected_version && p.id) {
            const prior = state.parties.find((x) => x.id === p.id);
            if (!prior || prior.version !== p.expected_version)
              throw new ToolError("Party version changed; retrieve it and review again.");
            const fields = [
              "name",
              "kind",
              "trade",
              "contact_name",
              "contact_email",
              "contact_phone",
              "insurance_reference",
              "contract_reference",
            ] as const;
            Object.assign(
              p,
              Object.fromEntries(
                fields
                  .filter((field) => !Object.hasOwn(p, field))
                  .map((field) => [field, prior[field]]),
              ),
            );
          }
          if (p.supplier_name && p.party_id) {
            const party = state.parties.find((x) => x.id === p.party_id);
            if (!party || party.name.trim().toLowerCase() !== p.supplier_name.trim().toLowerCase())
              throw new ToolError(
                "The supplier name and selected project party do not match. Please choose one.",
              );
          }
          if (p.supplier_name && !p.party_id) {
            const hits = state.parties.filter(
              (x) => x.name.trim().toLowerCase() === p.supplier_name!.trim().toLowerCase(),
            );
            if (hits.length === 1) p.party_id = hits[0].id;
            else
              return guide(
                {
                  ...text(
                    hits.length
                      ? "More than one project supplier matches. Which one?"
                      : "That supplier is not on this project. Add or select a project party before creating the order.",
                  ),
                  structuredContent: { saved: false, matches: hits },
                },
                "Resolve the project party explicitly. Never invent one.",
              );
          }
          delete p.supplier_name;
          if (
            (args.action === "order" || (args.action === "terms" && p.scope !== "company")) &&
            p.party_id
          ) {
            const party = state.parties.find((x) => x.id === p.party_id);
            if (party) p.party_version = party.version;
          }
          if (args.action === "default_terms" && state.default_version !== null)
            p.expected_default_version = state.default_version;
          if (args.action === "order" && !p.terms_id && state.default_terms_id)
            p.terms_id = state.default_terms_id;
          const absent = missing(args.action, p);
          if (absent.length)
            return guide(
              {
                ...text(
                  `Before review I need: ${absent.join(", ")}. Nothing was saved.${args.action === "terms" && p.scope !== "company" && !p.parent_id ? " Supplier terms require an existing base version. If none exists, the owner must first review and explicitly approve a company-wide base; making it the default is a separate optional action. Do not create or approve it automatically." : ""}`,
                ),
                structuredContent: { saved: false, missing: absent },
              },
              "Ask only for the missing facts; never invent them. If company terms are unavailable to this project member, ask the company owner to prepare a job-scoped variant; do not disclose company-wide or another job’s terms.",
            );
          if (
            args.action === "party" &&
            !p.expected_version &&
            p.name &&
            state.parties.some((x) => x.name.trim().toLowerCase() === p.name!.trim().toLowerCase())
          )
            throw new ToolError("That project party already exists; review the existing record.");
          if (args.action === "order") {
            if (p.expected_version) {
              const existing = state.orders.find((x) => x.id === p.id);
              if (
                !existing ||
                existing.versions[0]?.version !== p.expected_version ||
                existing.party_id !== p.party_id ||
                existing.number !== p.number
              )
                throw new ToolError(
                  "Order identity or version changed; retrieve it and review again.",
                );
              if (["issued", "accepted"].includes(existing.versions[0].status))
                throw new ToolError("Issued or accepted orders cannot be revised here.");
            }
            const party = state.parties.find((x) => x.id === p.party_id);
            const terms = state.terms.find(
              (x) =>
                x.id === p.terms_id &&
                x.state === "approved" &&
                x.approved_by &&
                (x.scope === "company" ||
                  (x.party_id === p.party_id && (x.scope === "supplier" || x.po_id === p.id))),
            );
            if (!party || !terms)
              throw new ToolError(
                "Select a project supplier and applicable terms version. Nothing was saved.",
              );
            if (
              !p.expected_version &&
              state.orders.some(
                (x) => x.number.trim().toLowerCase() === p.number!.trim().toLowerCase(),
              )
            )
              throw new ToolError(
                "That PO number already exists; retrieve it before creating another.",
              );
            if (!p.expected_version && p.status && p.status !== "draft")
              throw new ToolError("New purchase orders begin as drafts.");
            for (const [label, value] of [
              ["order", p.order_date],
              ["needed-by", p.needed_by],
            ] as const) {
              if (
                value &&
                (Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ||
                  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
              )
                throw new ToolError(`Enter a valid ${label} date.`);
            }
            p.status = p.status ?? "draft";
            p.expected_version = p.expected_version ?? 0;
          }
          p.id = p.id ?? crypto.randomUUID();
          p.request_id = p.request_id ?? crypto.randomUUID();
          const selected = state.terms.find(
            (x) =>
              x.id ===
              (args.action === "default_terms"
                ? p.id
                : args.action === "approve_terms"
                  ? p.proposal_id
                  : p.terms_id),
          );
          if (
            args.action === "default_terms" &&
            (!selected || selected.scope !== "company" || !selected.approved_by)
          )
            throw new ToolError("Select an approved company terms version.");
          if (
            args.action === "approve_terms" &&
            (!selected || selected.state !== "proposed" || selected.scope === "company")
          )
            throw new ToolError("Select a proposed project terms version for owner review.");
          const party = state.parties.find((x) => x.id === (p.party_id ?? selected?.party_id));
          const company = (await memberCompanies(sb)).find((x) => x.id === job.company_id);
          const parent = state.terms.find(
            (x) =>
              x.id ===
              (p.parent_id ?? (args.action === "approve_terms" ? selected?.parent_id : undefined)),
          );
          const currentDefault = state.terms.find((x) => x.id === state.default_terms_id);
          const reviewKey = crypto.randomUUID();
          const review = await rpc<{ expires_at: string }>(
            sb,
            "mcp_project_purchase_orders_review",
            { _job: job.job_id, _action: args.action, _p: p, _review: reviewKey },
          );
          return guide(
            {
              ...text(
                `Review ${args.action.replaceAll("_", " ")} for ${company?.name ?? "your company"} · ${job.job_number} · ${job.name}${party ? ` · ${party.name}` : ""}:\n${JSON.stringify(p, null, 2)}${p.lines ? `\nLines: ${p.lines.map((l) => `${l.description}: ${l.quantity} ${l.unit} at ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(l.unit_price_cents / 100)} per ${l.unit}`).join("; ")}` : ""}${selected ? `\nSelected terms (${selected.title}, ${selected.scope}):\n${selected.body}` : ""}${parent ? `\nBase terms (${parent.title}):\n${parent.body}` : ""}${args.action === "default_terms" ? `\nCurrent default: ${currentDefault?.title ?? "none"} (version ${p.expected_default_version}).` : ""}\n${args.action === "approve_company_terms" ? "Approve and record these exact terms for company-wide use? This is approval now, not an unapproved draft. The company default is a separate action and is unchanged." : args.action === "approve_terms" ? "Approve this exact proposal for internal use? Confirm any other required buy-in separately." : args.action === "default_terms" ? "Set the displayed approved company terms as the default?" : args.action === "order" && p.status === "approved" ? "Internally approve this exact reviewed PO? This does not issue it." : "Is this correct?"} No party, terms version or order has been saved; the review is held temporarily.`,
              ),
              structuredContent: {
                saved: false,
                action: args.action,
                facts: p,
                review_key: reviewKey,
                review_expires_at: review.expires_at,
                selected_terms: selected ?? null,
                parent_terms: parent ?? null,
                comparison:
                  parent && (p.body ?? selected?.body)
                    ? compareTerms(parent.body, p.body ?? selected!.body)
                    : null,
              } as never,
            },
            "Show the facts, supplier name, prices in dollars and selected terms. approve_company_terms records company-wide approved terms immediately; it cannot save an unapproved draft. Never use it for save-only or do-not-approve instructions. Supplier/PO terms are proposals requiring separate owner approval; never infer additional buy-in. Ask for explicit confirmation, then save exactly these facts and review key. Internal approval is not issuance, acceptance, a cost or payment.",
          );
        }
        if (!args.confirmed || !args.review_key || !p.id || !p.request_id)
          throw new ToolError(
            "Review the exact facts and confirm before saving. Nothing was recorded.",
          );
        try {
          const result = await rpc<Record<string, unknown>>(
            sb,
            "mcp_project_purchase_orders_record",
            {
              _job: job.job_id,
              _action: args.action,
              _p: p,
              _review: args.review_key,
              _confirmed: args.confirmed,
            },
          );
          return guide(
            {
              ...text(
                `${result.already_applied ? "This request was previously recorded; current records may have changed. Read the project records before taking another action." : args.action === "approve_company_terms" ? `Approved company-wide terms for ${job.job_number}. The company default is unchanged.` : `Saved for ${job.job_number}.`} No purchase order was issued or accepted.\nProject records: ${pageUrl(job.job_id)}`,
              ),
              structuredContent: { saved: true, result } as never,
            },
            "If already_applied is true, explain that this was previously recorded and read the current state before claiming it is still current. Proposed terms are not effective until separately approved by an owner; approval does not establish other buy-in. Internal PO approval does not issue it, and a PO is not a posted cost or payment.",
          );
        } catch (e) {
          if (e instanceof ToolError) throw e;
          return guide(
            {
              ...text(
                "The save outcome is unknown. Read the project records before retrying the same confirmed request.",
              ),
              structuredContent: { saved: null, facts: p, review_key: args.review_key } as never,
            },
            "Do not generate a new request ID. Read to reconcile, then retry only these exact facts and request ID if needed.",
          );
        }
      },
    ),
});
