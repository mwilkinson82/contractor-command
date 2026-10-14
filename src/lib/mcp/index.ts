import { auth, defineMcp } from "@lovable.dev/mcp-js";
import {
  buildHitList,
  getQuestions,
  runGapAnalysis,
  startLookahead,
  submitAnswers,
  submitLookahead,
} from "./tools/lookahead";

// Vite inlines the stable ref; the runtime backend URL may be a proxy.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "contractor-circle-hub",
  title: "Contractor Circle Hub",
  version: "0.1.0",
  instructions:
    "PM two-week lookahead agent (private prototype). Start with start_lookahead, then submit_lookahead, get_questions stage by stage, submit_answers, run_gap_analysis and build_hit_list. The tools store nothing, so pass the lookahead text and answers into each call.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
    requireOAuthClientClaim: true,
  }),
  tools: [startLookahead, submitLookahead, getQuestions, submitAnswers, runGapAnalysis, buildHitList],
});
