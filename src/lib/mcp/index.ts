import { auth, defineMcp } from "@lovable.dev/mcp-js";
import { ATHENA_VERSION } from "./server-info-branding";
import { GREETING_RULE } from "./greeting";
import { EMAIL_DRAFT_ONLY_RULE } from "./email-safety";
import { REFUSAL_RULE, secureTool } from "./security";
import { emailConfirmSend, emailDraft } from "./tools/email-tools";
import { pmEvening, pmMeeting, pmMorning } from "./tools/flow-tools";
import {
  answer,
  carryForward,
  intake,
  listOpenItems,
  nextQuestion,
  onboarding,
  report,
  resolveItem,
  contractTerms,
} from "./tools/workflow-tools";
import { cpmActivities, livingReportGet, livingReportSave } from "./tools/living-tools";
import { fileShare, fileShareRevoke, lookaheadPdfTool } from "./tools/file-tools";
import { reportPageLink, reportPageShare, reportPageShareRevoke } from "./tools/report-page-tools";
import { setCurrentCompany, teamAddSeats, teamInvite, teamList, teamRemoveMember, teamUpdateMember } from "./tools/team-tools";
import { ESTIMATE_SERVER_RULE } from "./estimating";
import { FIELD_SERVER_RULE } from "./superintendent";
import {
  dailyReminder,
  dailyReminderRun,
  dailyReportDraft,
  dailyReportGet,
  dailyReportSave,
  fieldPayApp,
  fieldProductionRates,
  fieldScheduleFeed,
  progressPhotoSave,
  progressPhotos,
  superintendentActivity,
  superintendentView,
} from "./tools/superintendent-tools";
import {
  estimateBidCheck,
  estimateBuild,
  estimateDocReview,
  estimateGapAnalysis,
  estimateIntake,
  estimateItemMark,
  estimateStatus,
  estimateTakeoffExport,
  estimateTakeoffGet,
  estimateTakeoffSave,
} from "./tools/estimate-tools";
import { estimateBidSummary, estimateGeneralConditions, estimatePricing, estimateRateSources, estimateRequirements } from "./tools/estimate-bid-tools";

// Vite inlines the stable ref; the runtime backend URL may be a proxy.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

/** All 56 Athena tools, in tools/list order. */
export const ATHENA_TOOLS = [onboarding, intake, nextQuestion, answer, report, contractTerms, carryForward, listOpenItems, resolveItem, cpmActivities, livingReportGet, livingReportSave, fileShare, fileShareRevoke, lookaheadPdfTool, reportPageLink, reportPageShare, reportPageShareRevoke, teamList, teamInvite, teamUpdateMember, teamRemoveMember, teamAddSeats, setCurrentCompany, estimateIntake, estimateDocReview, estimateTakeoffSave, estimateTakeoffGet, estimateTakeoffExport, estimateGapAnalysis, estimateBidCheck, estimateItemMark, estimateBuild, estimateStatus, estimatePricing, estimateRateSources, estimateGeneralConditions, estimateRequirements, estimateBidSummary, superintendentView, superintendentActivity, dailyReportDraft, dailyReportSave, dailyReportGet, fieldPayApp, fieldScheduleFeed, fieldProductionRates, progressPhotoSave, progressPhotos, dailyReminder, dailyReminderRun, pmMeeting, pmMorning, pmEvening, emailDraft, emailConfirmSend];

export default defineMcp({
  name: "athena",
  title: "Athena powered by ALP, construction agents",
  version: ATHENA_VERSION,
  instructions:
    REFUSAL_RULE +
    " Athena powered by ALP, construction agents. " +
    GREETING_RULE +
    ' Use dates, logic, float, and amounts from the tool result exactly. If a forecast total does not equal the contract, show "Doesn\'t tie: off by $X" and do not draw the chart. Show each tool result as written. Do not offer a consulting option. Do not assume the job type, owner, client type, sector, or pricing model. The job number is required when creating a job. Ask each setup question. Do not answer it for the member. Pass each contract clause exactly as written, one clause per entry, with its section number. Do not summarize a clause unless the member asks. End every SOV reply with the delivery question from the result, word for word. ' +
    EMAIL_DRAFT_ONLY_RULE +
    " Pass confirmed true only after the member says yes. Show money with cents. Do not invent missing data. Do not add a date sweep unless the result includes one. If the member has not named a job, call list_open_items with no job number. Ask the owner yes or no before a team change. Do not send a payment link." +
    ESTIMATE_SERVER_RULE +
    FIELD_SERVER_RULE,
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
    requireOAuthClientClaim: true,
  }),
  // Browser-based MCP clients send an Origin header; the SDK 403s any origin not listed here
  // before auth (no log row). Cursor's web agents (www.cursor.com) were blocked. Exact origins only.
  allowedOrigins: ["https://www.cursor.com", "https://cursor.com"],
  // 0.8.23: refusal is the first instruction. Tool descriptions stay one sentence. secureTool only records signals.
  tools: ATHENA_TOOLS.map(secureTool),
});
