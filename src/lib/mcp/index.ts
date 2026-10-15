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
  name: "contractor-circle-hub",
  title: "Contractor Circle Hub",
  version: "0.3.0",
  instructions:
    "The PM agent (private prototype). Every tool takes the job_number and matches it exactly. The server keeps the state and decides the steps; relay its questions and reports as written. Job setup order: onboarding (company, once), intake create_job, intake scope (step 0), then contract, handoff and budget as the member has them, and next_question / answer one at a time. Use list_open_items and resolve_item to track items, and report for internal or client-facing output. For a two-week lookahead use intake section lookahead, then next_question / answer / report with the lookahead_id. Never invent missing data; leave it out so it is recorded as unknown.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
    requireOAuthClientClaim: true,
  }),
  tools: [onboarding, intake, nextQuestion, answer, report, carryForward, listOpenItems, resolveItem],
});
