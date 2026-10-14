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
  version: "0.2.0",
  instructions:
    "PM two-week lookahead workflow (private prototype). The server keeps the state and decides the steps; relay its questions and reports to the user as written. Order: onboarding (once), intake, optionally carry_forward from last week, then next_question / answer one at a time until done, then report. Use list_open_items and resolve_item to track items. Never invent missing data; leave it out so it is recorded as unknown.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
    requireOAuthClientClaim: true,
  }),
  tools: [onboarding, intake, nextQuestion, answer, report, carryForward, listOpenItems, resolveItem],
});
