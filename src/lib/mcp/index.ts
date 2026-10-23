import "./widget-bridge";
import { auth, defineMcp } from "@lovable.dev/mcp-js";
import { ATHENA_VERSION } from "./server-info-branding";
import { ATHENA_ROUTE_LINE, GREETING_RULE } from "./greeting";
import { EMAIL_DRAFT_ONLY_RULE } from "./email-safety";
import { REFUSAL_RULE, secureTool } from "./security";
import { emailConfirmSend, emailDraft } from "./tools/email-tools";
import { gettingStarted } from "./tools/getting-started-tool";
import { projectRecordSearch, submittalLog, submittalsImport, submittalsList } from "./tools/submittal-tools";
import { submittalChase } from "./tools/submittal-chase-tool";
import { submittalPackage, submittalDelivery } from "./tools/submittal-package-tools";
import { CHASE_SERVER_RULE } from "./submittal-chase";
import { SUBMITTAL_SERVER_RULE } from "./submittals";
import { PROJECT_RECORD_RULE } from "./project-record";
import { GETTING_STARTED_RULE } from "./getting-started";
import { PRIVATE_CHAT_SHARE_RULE } from "./private-chat-sharing";
import { pmEvening, pmMeeting, pmMorning, pmMorningMeeting } from "./tools/flow-tools";
import { athenaHello, morningBrief, morningBriefSettings } from "./tools/morning-brief-tools";
import {
  answer,
  carryForward,
  intake,
  listOpenItems,
  lookaheadList,
  lookaheadGet,
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
  fieldBoard,
  superintendentActivity,
  superintendentView,
} from "./tools/superintendent-tools";
import {
  drawingSetImport,
  drawingMarkup,
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

/** All Athena tools, in tools/list order. */
export const ATHENA_TOOLS = [onboarding, intake, nextQuestion, answer, report, contractTerms, carryForward, listOpenItems, lookaheadList, lookaheadGet, resolveItem, cpmActivities, livingReportGet, livingReportSave, fileShare, fileShareRevoke, lookaheadPdfTool, reportPageLink, reportPageShare, reportPageShareRevoke, teamList, teamInvite, teamUpdateMember, teamRemoveMember, teamAddSeats, setCurrentCompany, drawingSetImport, drawingMarkup, estimateIntake, estimateDocReview, estimateTakeoffSave, estimateTakeoffGet, estimateTakeoffExport, estimateGapAnalysis, estimateBidCheck, estimateItemMark, estimateBuild, estimateStatus, estimatePricing, estimateRateSources, estimateGeneralConditions, estimateRequirements, estimateBidSummary, superintendentView, fieldBoard, superintendentActivity, dailyReportDraft, dailyReportSave, dailyReportGet, fieldPayApp, fieldScheduleFeed, fieldProductionRates, progressPhotoSave, progressPhotos, dailyReminder, dailyReminderRun, pmMeeting, pmMorning, pmMorningMeeting, pmEvening, athenaHello, morningBrief, morningBriefSettings, emailDraft, emailConfirmSend, submittalLog, submittalsList, submittalsImport, projectRecordSearch, submittalChase, submittalPackage, submittalDelivery, gettingStarted];

export default defineMcp({
  name: "athena",
  title: "Athena powered by ALP, construction agents",
  version: ATHENA_VERSION,
  instructions:
    REFUSAL_RULE +
    PRIVATE_CHAT_SHARE_RULE +
    " Athena powered by ALP, construction agents. " +
    GREETING_RULE +
    " " +
    ATHENA_ROUTE_LINE +
    " Drawing imports from Google Drive or Dropbox → drawing_set_import with drawing.source_url and sheets in PDF page order; upload bytes through drawing.content_base64 when the connected AI must authenticate the download. Mark up a stored drawing → drawing_markup, never ask for a re-upload. To analyze new findings, use operation prepare, inspect the returned original sheet, then save supplied annotations. Coordinates are normalized 0..1 from the top-left of that image. Unlocated findings remain in the key; never guess positions, quantities or claim a review when no findings were established. " +
    ' Use dates, logic, float, and amounts from the tool result exactly. If a forecast total does not equal the contract, show "Doesn\'t tie: off by $X" and do not draw the chart. Show each tool result as written. Do not offer a consulting option. Do not assume the job type, owner, client type, sector, or pricing model. The job number is required when creating a job. Ask each setup question. Do not answer it for the member. Pass each contract clause exactly as written, one clause per entry, with its section number. Do not summarize a clause unless the member asks. End every SOV reply with the delivery question from the result, word for word. ' +
    EMAIL_DRAFT_ONLY_RULE +
    " Pass confirmed true only after the member says yes. Show money with cents. Do not invent missing data. Do not add a date sweep unless the result includes one. If the member has not named a job, call list_open_items with no job number. How many / list lookaheads → lookahead_list. Show / give the lookahead or its items → lookahead_get; its reply contains the items directly.  When someone says Athena, good morning, Hey Athena, good morning, Good morning Athena, Morning Athena, Athena at the start or mid-sentence, Athina what's on my hitlist this morning, Athina, Athen, Atena, hitlist, morning briefing, what's on my plate today, overdue, or today's deadlines on my jobs, and the message is not about a submittal, call athena_hello or morning_brief even when that is the whole message. Do not answer those in plain text. Athena leads that brief. Always keep the heading From your inbox and calendar. If you can read Gmail and Calendar, replace the placeholder rows with emails that came in overnight, unanswered emails that need a reply, and today's meetings. If you cannot, keep the placeholder rows and write no error text of your own.  The brief includes every job in every company, grouped by company when there is more than one. Then keep the job side: schedule, notices, submittals due, overdue items, and what happened yesterday versus what is due today. When they name a job and want that job's morning meeting, call athena_morning_hitlist with the job number. When they say morning meeting, PM morning, or start the morning meeting, call pm_morning, which is a real tool. When they say set my morning briefing to 6am, or ask to see their morning briefing time, call morning_brief_settings and show the setting. Nothing is sent. On the first reply after the member's briefing time, and when they say Hey Athena, good morning, the morning card leads. Show it first. It links to /today. It shows once per local day. That once-a-day limit is the proactive card only. When the member asks for the morning brief, build and return the full brief every time, including From your inbox and calendar. Do not say it was already shown and do not point at an earlier brief. Always keep the heading From your inbox and calendar. If you can read Gmail and Calendar, replace the placeholder rows with overnight emails, unanswered emails, and today's meetings, followed by the job items. If you cannot, keep the placeholder rows and write no error text of your own. Use only the connected inbox and calendar. Do not invent a message or a meeting. Nothing is emailed. When someone says run my PM meeting, start the PM meeting, or hold the project meeting, call pm_meeting even if they do not name Athena. That is the job meeting on the schedule, not a calendar appointment. Do not build a generic meeting widget. A construction PM meeting or evening wrap-up is pm_meeting or pm_evening for a job: schedule progress, lookahead, subs and crews, change orders, billing, and the IOR. The morning brief is morning_brief. This month's planned bill and realistic bill are the plan and realistic arguments on pm_meeting stage accounting. Do not call living_report_save for those two figures. Schedule percent complete comes from the saved CPM. If it is missing, ask for it and pass percent_complete. If no job was given for pm_meeting, pm_morning, or pm_evening, call that tool with no job number. It opens the only job or the most recently updated job, and shows the Which job card only when it cannot tell. morning_brief covers every visible job and does not ask which job. When a tool result says the card is shown, that card is the whole reply: do not add text after it. On the morning brief card, fill the From your inbox and calendar rows from the member's mail and calendar before that closing. On a which-job or picker card, wait for the user's pick. Show the contract terms card only: risk clauses are red cards, incomplete terms sit on the card, and the summary question is the card action, with no prose after the card. Ask the owner yes or no before a team change. Do not send a payment link." +
    ESTIMATE_SERVER_RULE +
    FIELD_SERVER_RULE +
    SUBMITTAL_SERVER_RULE +
    " Collect each required piece with submittal_log package_items, then submittal_package upload_piece to store received files, and build to create the company cover and package. Use submittal_delivery draft to save the exact recipient, subject, body and package link before asking yes. Approval is separate from sending. Only after a successful connected email send, record the provider message id and sent time with submittal_delivery record_sent. Do not claim submission complete from a status or approval alone. Packages use the existing revision transmittal number. Renew or turn off a submittal package link with submittal_package renew_link or revoke; retain all originals. " +
    PROJECT_RECORD_RULE +
    CHASE_SERVER_RULE +
    GETTING_STARTED_RULE,
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
