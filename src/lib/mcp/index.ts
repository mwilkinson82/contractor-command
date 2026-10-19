import { auth, defineMcp } from "@lovable.dev/mcp-js";
import {
  answer,
  carryForward,
  intake,
  listOpenItems,
  nextQuestion,
  onboarding,
  report,
  resolveItem,
} from "./tools/workflow-tools";

// Vite inlines the stable ref; the runtime backend URL may be a proxy.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "athena",
  title: "Athena powered by ALP, construction agents",
  version: "0.4.0",
  instructions:
    "Athena powered by ALP, construction agents. Every tool takes the job_number and matches it exactly. The server keeps the state and decides the steps; relay its questions and reports as written. Athena is for contractors running their own construction company; never offer a consulting option or frame anything as consulting (ALP or otherwise). The job_number is required for every job tool: ask for it when creating a job and never call it optional. Never assume the job type, owner or client type, sector or pricing model; ask for each and leave out what the member does not say. Never answer a setup question for the member; ask each one and relay the server's numbering as written. Leave owner out of an item unless the member names someone; the server defaults it to the job's PM, or to the caller with their role. Job setup order: onboarding (company, once), intake create_job, intake scope (step 0), then contract, handoff and budget as the member has them, and next_question / answer one at a time. Use list_open_items and resolve_item to track items, and report for internal or client-facing output. For a two-week lookahead use intake section lookahead, then next_question / answer / report with the lookahead_id. At the start of a session, and always on report and list_open_items, the server puts a date sweep (overdue, due today, next 14 days) before the normal output; relay it first and keep every Precaution label. Record the job time zone and PM with intake section job_settings, and contract time clauses with intake section deadline. Every open item has an item_type (unknown, no, na_disposition, pending_document, deadline). Never invent missing data; leave it out so it is recorded as unknown.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
    requireOAuthClientClaim: true,
  }),
  tools: [onboarding, intake, nextQuestion, answer, report, carryForward, listOpenItems, resolveItem],
});
