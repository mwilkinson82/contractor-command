import { ALERT_COLOR, ALERT_PALETTE_RULE } from "./alert-color";
import { EMAIL_TOPIC_RE, emailRules } from "./email-safety";
// What the PM reads vs. what only the assistant needs.
// Tool results' visible text is what a PM should read. Steps for the assistant (which tool to call next,
// what to ask, how to present it) and internal codes go in structuredContent.assistant_guidance,
// never in the visible text. splitGuidance is the last pass on every result.

/** Host-directed phrasing. Any visible sentence matching this is moved to guidance. */
export const GUIDANCE_RE = new RegExp(
  [
    String.raw`\brelay\b`,
    String.raw`\bverbatim\b`,
    String.raw`\bword for word\b`,
    String.raw`\b(?:ask|tell|remind) the member\b`,
    String.raw`\bask (?:these|them|each|who)\b`,
    String.raw`\bone at a time\b`,
    String.raw`\b(?:call|use|run|with) (?:the )?(?:intake|answer|report|next_question|list_open_items|resolve_item|carry_forward|onboarding|contract_terms)\b`,
    String.raw`\bintake section\b`,
    String.raw`\bsection "?[a-z_]+"? ?\(`,
    String.raw`\bcheck_key\b`,
    String.raw`\blookahead_id\b`,
    String.raw`\bjob_number\b`,
    String.raw`\bstructured ?content\b`,
    String.raw`\bthe host\b`,
    String.raw`\bemail card\b`,
    String.raw`\bshown first\b`,
    String.raw`\bkeep every\b`,
    String.raw`\bnever (?:invent|guess|assume|answer)\b`,
    String.raw`\bput (?:these|the|this) .{0,60}\babove\b`,
    String.raw`\boutput (?:the )?(?:open )?items\b`,
    String.raw`^Next: (?:intake|next_question|report|answer|call|create|resolve)`,
    String.raw`\banswer with (?:response|detail)\b`,
    String.raw`\b(?:detail|response) "[a-z]`,
    String.raw`\banswer action\b`,
    String.raw`\bdue_date\b`,
    String.raw`\bpass the name\b`,
  ].join("|"),
  "im",
);

/** Internal reference codes that a PM doesn't need in running text. */
/** snake_case field keys and codes (case-sensitive, so IANA zones like America/New_York pass). */
export const SNAKE_RE = /(?<![A-Za-z/])[a-z]+(?:_[a-z0-9]+)+\b/;

export const INTERNAL_CODE_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\[ref #[0-9a-f]{6}[^\]]*\]|\btype (?:unknown|deadline|no|na_disposition|pending_document)\b|\b(?:setup|flag|tz|delay_notice|delay_claim|warranty|bss_[a-z_]+):[a-z0-9_:-]+/i;

function sentences(line: string): string[] {
  // Split on sentence ends followed by a capital, keeping list markers and labels intact.
  // "1. Header" is one item. Splitting on that marker left a blank "1." in the live Gantt spec
  // once the rest of the line (it says "word for word") moved to guidance.
  return line.split(/(?<!\d[.!?])(?<=[.!?])\s+(?=[A-Z"(])/);
}

/** 0.8.8: lines that start with "REQUIRED:" are pinned host directives and are never moved into guidance. */
export const REQUIRED_LINE_RE = /^REQUIRED:/;

export function splitGuidance(text: string): { visible: string; guidance: string[] } {
  const guidance: string[] = [];
  const out: string[] = [];
  for (const line of text.split("\n")) {
    // 0.8.8: pinned REQUIRED lines stay at the top of the visible text (Claude skips guidance it can't see there).
    if (!GUIDANCE_RE.test(line) || REQUIRED_LINE_RE.test(line)) {
      out.push(line);
      continue;
    }
    const parts = sentences(line);
    const keep: string[] = [];
    for (const s of parts) (GUIDANCE_RE.test(s) ? guidance : keep).push(s.trim());
    const k = keep.join(" ").trim();
    if (k && !/^[-*]\s*$/.test(k)) out.push(/^\s+/.test(line) ? line.match(/^\s+/)![0] + k : k);
  }
  const visible = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return { visible, guidance: guidance.filter(Boolean) };
}

type Res = {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

/** Last pass on a tool result: visible text keeps only what a PM reads; the rest becomes hidden guidance. */
export function finalizeVisible<R>(r: R, extra: string[] = []): R {
  const res = r as unknown as Res;
  if (!res?.content?.length) return r;
  const guidance = [...extra];
  const content = res.content.map((c) => {
    if (c.type !== "text" || typeof c.text !== "string") return c;
    const s = splitGuidance(c.text);
    guidance.push(...s.guidance);
    return { ...c, text: s.visible };
  });
  if (!guidance.length) return { ...res, content } as unknown as R;
  const prior = Array.isArray(res.structuredContent?.assistant_guidance)
    ? (res.structuredContent!.assistant_guidance as string[])
    : [];
  const all = [...prior, ...guidance];
  return {
    ...res,
    content,
    // structuredContent reaches the model but isn't shown as chat text. (@lovable.dev/mcp-js 3.1.1 drops a tool
    // result's _meta, so guidance isn't duplicated there.)
    structuredContent: { ...(res.structuredContent ?? {}), assistant_guidance: all },
  } as unknown as R;
}

/** 0.8.3 chart palette: every chart, table and artifact in every host. */
export const CHART_PALETTE = ["#2563EB", "#6B7280", "#9CA3AF", "#D1D5DB", "#F3F4F6"] as const;
/** Chart colors live on the chart object. This line no longer restates them. */
export const CHART_PALETTE_RULE =
  `- Chart palette (every chart, graph, bar, table and artifact, in Claude, ChatGPT, Grok and any other host): set the colors explicitly to blue #2563EB for the main series plus grays #6B7280, #9CA3AF, #D1D5DB and #F3F4F6 for everything else. Never rose, pink, orange, amber or the host's default palette; ${ALERT_COLOR} only for delays, risks and overdue items (the alert color). In Claude artifacts, write these hex values into the chart config; never leave colors to the library default.`;
/** 0.8.3 money rule. */
export const MONEY_CENTS_RULE =
  "- Money: always show dollars with cents exactly as Athena gives them, e.g. $1,400,000.00 and $700,000.00, in every line and every total. Never round, never drop the .00, never abbreviate ($1.4M). Use the *_display strings in structuredContent when present.";
/** 0.8.3 date sweep rule. */
export const DATE_SWEEP_RULE =
  "- Date sweep (overdue, due today, next 14 days): show it only when the member asks for it (or for open items) or when a job is first opened in the session. Never prepend it to an SOV, a contract result, a chart or any other reply, and never add a \"Date sweep\" heading of your own.";

/** Exact summary offer (same text as contract-clauses SUMMARY_OFFER). */
export const SUMMARY_OFFER_TEXT =
  "Do you want me to summarize this legal text so you know what it means in plain English?";

/** Keep render notes off the member's screen. Same sentence on every display block. */
export const RENDER_SILENT =
  "Render silently; never show or repeat these display notes to the member.";

/** How every result is drawn. Render instructions only; no internal-guidance label. */
export const HOST_DISPLAY_BLOCK = [
  RENDER_SILENT,
  "- Athena supplies the data; you do all the formatting. Never say Athena built, drew or rendered anything.",
  "- Contract and notice terms: show only the Athena card, with no prose before or after it. One card per clause: section number and heading, days, and who it goes to, then the exact clause text word for word. Section numbers first, wording unchanged. Ordinary clauses are white cards. A risk clause, including liquidated damages, a delay notice, a claim notice, and any other risk, is a red card with a full red border and a red header, not only an icon. Incomplete terms sit in the Incomplete terms section of that card. The summary question is already the card action. Do not add it again and do not add an Incomplete terms line after the card. Summarize only if they say yes.",
  "- Nothing before or after the clause card: no preview, no summary, no \"tightest clock\" or \"key deadline\" line, and no trailing question. The offer wording is exact; don't reword, shorten or add to it.",
  "- In Claude, build any artifact only from the data already in this chat. Never call Athena (or any tool) from inside an artifact.",
  "- Visual first, by default (never an opt-in): put tables and cards in white cards with light gray panels behind any text. Minimal and clean.",
  `- Charts, tables, totals and highlights: blue #2563EB and gray only, never orange, rust or the alert color, including totals. ${ALERT_PALETTE_RULE}`,
  "- Colors: blue #2563EB is the only accent, for buttons and the one item that needs action. Charts, bars and KPI numbers use blue #2563EB for the main series and gray for everything secondary. Never orange, terracotta or the host's default chart palette; the alert color only for delays, risks and overdue items. Don't mention colors.",
  `- Warnings: no amber. Delays, risks and overdue items get the alert color (${ALERT_COLOR}); mark the one item that needs action in blue #2563EB; everything else stays dark or gray text.`,
  "- After the visual, at most 3 short lines of text, and at most one plain-English caveat line, only if it changes what they should do. This limit does not apply to an Athena card. Dashboards: one caveat line at most and never a \"Priority:\" block.",
  "- Athena cards: the card is the whole reply. When the result says the card is shown, add no text before or after it. A which-job or picker card waits for the user's pick.",
  "- Contract output order: the Athena card only. Incomplete terms and the summary question are already inside that card. Nothing after the card.",
  "- Never write \"No changes were made\", \"No items were changed\" or similar lines, and no filler openers such as \"Pulling up...\", \"Let me...\" or \"Here's...\". Start with the visual.",
  "- In Claude, build every artifact as static data embedded from this tool result: no connector or MCP calls inside the artifact, no live refresh and no re-reading Athena. At most 2 lines of text after the artifact.",
  CHART_PALETTE_RULE,
  MONEY_CENTS_RULE,
  DATE_SWEEP_RULE,
  "- Schedule of values (report deliverable sov): present it as a spreadsheet, line-item view by default: one row per line with line no., cost code, division, description, scheduled value and % of total (the Cost Code column always sits right after the line no.), then the grand total that ties to the contract sum. Claude: an artifact table built from this result; ChatGPT: a canvas or table; elsewhere: a clean table plus an offer to create an Excel file. Table style: header row blue #2563EB with white bold text; alternating light-gray (#F3F4F6) and white row bands; bold total row with a blue #2563EB top rule. Blue #2563EB and gray only, never orange, rust or the alert color, including totals. After the table, at most one line: no footer or license note and no roll-up offer unless the member asks.",
  `- Summary offer: use this wording verbatim, never paraphrased or shortened: "${SUMMARY_OFFER_TEXT}"`,
  "- Write for contractor office staff and owners. No technical notes: nothing about artifacts, canvas, sharing settings, code, files, tools or colors (the exact SOV delivery question is the one exception).",
  "- Email on demand: whenever the member asks to email something (\"also email this sub\", \"send this to the supplier\"), show the email card in that same reply with recipient, subject, body and attachment filled in from Athena's saved job data. If the address isn't in Athena's results, leave To blank on the card and ask for it in the same reply. Never guess an address. Call email_draft for the card; never send in the same reply. Send only after a separate yes and email_confirm_send.",
  "- Keep everything private. Never publish, share or create a public link unless the member asks for it in this chat.",
].join("\n");

/** Project software is a real setup step: check key, and its fixed place in next_question (2nd, right after the job number check). */
export const PROJECT_SOFTWARE_KEY = "project_software";
export const PROJECT_SOFTWARE_POSITION = 2;

/** Job setup: where the job lives. Exact member-facing wording; the host asks it, never Athena's visible text. */
export const JOB_SOFTWARE_ASK =
  "Is this job already set up in your project software? Which one do you use: Overwatch, Buildertrend, Procore, Primavera P6, another web tool, or Excel?";
export const JOB_SOFTWARE_TOOL_FOLLOWUP =
  "Do you want me to create the job there, or is it already set up?";
export const JOB_SOFTWARE_NONE_FOLLOWUP =
  "No problem. I can build the schedule of values and the CPM schedule right here in chat, or as an Excel file you can keep. Which would you like?";

/** Hidden guidance on job-setup next_question results. Instruction text only: no new field, nothing stored by Athena. */
export const JOB_SETUP_SOFTWARE_BLOCK = [
  `- next_question returns this as setup question 2 (ref project-software), right after the job number check and before the gates; ask it then, once per job. Ask exactly: "${JOB_SOFTWARE_ASK}"`,
  `- If they name a tool, ask exactly: "${JOB_SOFTWARE_TOOL_FOLLOWUP}"`,
  `- If they say none or not sure, say exactly: "${JOB_SOFTWARE_NONE_FOLLOWUP}"`,
  "- If the member says yes, create it in their tool: use your browser (or the member's browser) to open the tool, have the MEMBER sign in themselves (never ask for or type a password), then create the job and build the SOV, the CPM schedule, cost loading and billing there from Athena's job data. Confirm each screen with the member before saving anything.",
  "- Primavera P6: big contracts often require a P6 schedule. If the member picks P6, offer (a) to generate an XER file from Athena's SOV and contract dates for them to import into P6, or (b) if you have desktop control of their computer (for example ChatGPT desktop), to build the schedule directly in P6 with them watching. The member opens and signs in to P6 themselves.",
  "- If the job already exists there: open it, compare it to Athena's SOV and schedule, and list the differences. Don't overwrite anything without a yes.",
  "- If there's no tool, or you have no browser: offer to build it in chat (tables and charts) or in Excel (an SOV sheet, a schedule sheet and a cost-loaded billing forecast). Work through the choice with the member one question at a time.",
  "- Athena only supplies the job data; you do the building. Never say Athena created, built or set up anything.",
  "- Record the answer with answer check_key project_software (tool name in detail), and keep it in this chat too; use the same place for every later step. Don't record it in job settings or an open item.",
  "- Keep it plain: one question at a time, no technical notes.",
].join("\n");

/** 0.8.2 SOV delivery step. Exact member-facing wording; the host asks it right after the line-item SOV. */
export const SOV_DELIVERY_ASK = [
  "Where do you want this SOV to live?",
  "1. In your project software (Overwatch, Buildertrend, Procore, or another tool). I'll enter it there through the browser after you sign in.",
  "2. As an Excel file (.xlsx) or a PDF. I'll create it and bring up an email for you to review, with the file attached (or a link to it if your email can't carry files from here).",
  "3. As a shared link (a Claude artifact, ChatGPT canvas or Grok Bot spreadsheet that anyone with the link can open). I'll bring up an email with the link.",
].join("\n");
/** 0.8.8: every audience (owner, client, CM or team) gets the same three options; the client alias stays for callers. */
export const SOV_DELIVERY_ASK_CLIENT = SOV_DELIVERY_ASK;
export const sovDeliveryAsk = (_audience: "internal" | "client") => SOV_DELIVERY_ASK;
export const SOV_NOT_NOW_DAYS = 3;
/** 0.8.9: second bar color; SOV bars alternate blue and this gray. */
export const SOV_ALT_GRAY = "#9CA3AF";
/** 0.8.9: pinned at the top of every SOV and report result: list all three options, never recommend one. */
export const SHARE_OPTIONS_REQUIRED =
  "REQUIRED: When this is shared with the team or the owner (any audience), list all 3 sharing options below, numbered 1, 2 and 3, word for word, and let the member pick. Never recommend, pre-select or offer only one (not just a Google Sheets link, not just a PDF).";
/**
 * 0.8.10: attachments. Athena returns no files; the host builds the file and the host's email tool must carry it.
 * ChatGPT's Gmail/Outlook email action has no attachment field (drafts and sends go out bare), Claude's Gmail
 * create_draft takes base64 attachments, Grok Bot attaches to a Gmail draft. Never claim an attachment that isn't there.
 */
export const EMAIL_ATTACHMENT_RULE =
  "REQUIRED: Only say a file is attached if your email tool actually attached it. If your email tool can't attach files (ChatGPT's email today), put a link to the file in the email body instead (a canvas or file shared as anyone with the link, or a Google Drive or OneDrive link), and say so in one line under the card. Best link: call Athena's file_share with the file you built and use the app.meetathena.io/f/ link it returns (opens for anyone with it, 30 days). Never send an email that says \"attached\" without the file.";
export const EMAIL_ATTACHMENT_STRUCTURED = {
  never_claim_missing_attachment: true,
  attach_when_supported:
    "Use the email tool's attachments field when it has one (Claude Gmail create_draft attachments, base64, 25 MB total; Grok Bot Gmail draft attachment).",
  fallback_when_unsupported:
    "ChatGPT Gmail/Outlook email action has no attachments field: put a link to the file in the body (canvas or file shared as anyone with the link, or a Drive/OneDrive link) and tell the member in one line. Or save a draft and tell the member to attach the downloaded file in Gmail before sending.",
  share_link_tool: "file_share",
  share_link_how:
    "Call file_share with job_number, kind, filename and content_base64 (the bytes of the file you built). Put the returned link in the email body. Works in every host.",
  rule: EMAIL_ATTACHMENT_RULE,
} as const;
/** 0.8.9: email cards carry a literal To: label. 0.8.10: as the first line inside the card. */
export const EMAIL_TO_LABEL_REQUIRED =
  'REQUIRED: Inside every email card, the first line of the card itself is the literal label "To:" followed by the address (or blank and ask in this same reply), above Subject. Never put To: outside the card, above or below it.';
/** 0.8.7: report sov always comes with a bar chart of scheduled value by line, in the fixed palette. */
/** Opens the SOV presentation guidance (table and chart styling). Claude's card replaces it. */
export const SOV_PRESENTATION_LEAD = "Present the SOV as a spreadsheet";
export const SOV_CHART_RULE =
  "REQUIRED, every host (Claude, ChatGPT, Grok and any other): draw a bar chart of the SOV from structuredContent.sov.chart: one bar per line (x: the line label, y: scheduled value), in the order given, placed directly under the SOV table and before the delivery question. Set the colors explicitly: bars #2563EB; axes, gridlines and labels in the grays #6B7280, #9CA3AF, #D1D5DB and #F3F4F6, with alternating gray bands (chart.band_colors) behind the bars; ChatGPT and every other host must show the gray as well as the blue. Never use the host's default palette, and never the alert color, rose, pink, orange or amber. Money labels with cents (value_display). No chart title text beyond \"Scheduled value by line\" and no extra commentary. Bars alternate blue #2563EB and gray #9CA3AF (chart.bars[].color).";
export function sovChart(
  rows: {
    item_no: string;
    cost_code: string | null;
    description: string | null;
    scheduled_value: number;
    scheduled_value_display: string;
  }[],
) {
  return {
    required: true,
    type: "bar",
    title: "Scheduled value by line",
    x_label: "SOV line",
    y_label: "Scheduled value",
    bar_color: CHART_PALETTE[0],
    palette: [...CHART_PALETTE],
    // 0.8.8: gray is part of every chart, not optional: alternating gray bands behind the bars, gray grid, axes and labels.
    band_colors: ["#F3F4F6", "#FFFFFF"],
    grid_color: "#D1D5DB",
    axis_color: "#6B7280",
    label_color: "#6B7280",
    total_bar_color: "#9CA3AF",
    // 0.8.9: bars alternate blue #2563EB and gray #9CA3AF (odd lines blue, even lines gray), each bar carries its color.
    alternating_bar_colors: [CHART_PALETTE[0], SOV_ALT_GRAY],
    bars: rows.map((r, i) => ({
      label: `${r.item_no}${r.cost_code ? ` (${r.cost_code})` : ""}`,
      description: r.description,
      value: r.scheduled_value,
      value_display: r.scheduled_value_display,
      color: i % 2 === 0 ? CHART_PALETTE[0] : SOV_ALT_GRAY,
    })),
  };
}
/**
 * 0.8.8: short imperative lines pinned at the TOP of the report sov text content (not only guidance or
 * structuredContent), because Claude skips guidance. Chart data is inline;
 * the email draft starts with its To line.
 */
export function sovRequiredTop(rows: { item_no: string; cost_code: string | null; scheduled_value_display: string }[], toLine: string): string {
  const data = rows.map((r) => `${r.item_no}${r.cost_code ? ` (${r.cost_code})` : ""} ${r.scheduled_value_display}`).join("; ");
  return [
    `REQUIRED: Draw this bar chart now under the table. Bars alternate blue #2563EB and gray #9CA3AF (1st bar blue, 2nd gray, 3rd blue, and so on; each bar's color is in structuredContent.chart.bars[].color); gray bands #F3F4F6 behind them; gray grid #D1D5DB; gray axes and labels #6B7280. No other colors. Data: ${data}.`,
    `REQUIRED: Any email card for this SOV shows the literal label "To:" as the first line inside the card itself (not above or below it): ${toLine}. If there is no address, leave To: blank and ask for it in this same reply.`,
    SHARE_OPTIONS_REQUIRED,
    EMAIL_ATTACHMENT_RULE,
  ].join("\n");
}
/** 0.8.4: the delivery step as data, in report sov structuredContent, so hosts can't skip it. */
export const SOV_DELIVERY_STRUCTURED = {
  required_next_step: true,
  ask: SOV_DELIVERY_ASK,
  options: [
    {
      n: 1,
      kind: "project_software",
      note: "Member signs in themselves; never ask for or type a password.",
    },
    {
      n: 2,
      kind: "xlsx_or_pdf_email",
      note: "Build a real .xlsx or PDF, then show an email card with it attached; if the email tool can't attach files (ChatGPT), put a link to the file in the body instead (see attachments). To blank and asked in the same reply if no address.",
    },
    {
      n: 3,
      kind: "shared_link",
      note: "Claude artifact, ChatGPT canvas or Grok Bot spreadsheet shared as 'anyone with the link', then an email card with the link. Any audience: owner, client, CM or team.",
    },
  ],
  list_all_options: true,
  never_recommend_one: true,
  link_rule:
    "Shared links are fine for any audience (owner, client, CM or team). Set sharing to anyone with the link.",
  attachments: EMAIL_ATTACHMENT_STRUCTURED,
} as const;
/** 0.8.8: owner/client SOV delivery data: same three options as the team SOV. */
export const SOV_DELIVERY_STRUCTURED_CLIENT = {
  ...SOV_DELIVERY_STRUCTURED,
  audience: "client",
} as const;
export const sovDeliveryStructured = (audience: "internal" | "client") =>
  audience === "client" ? SOV_DELIVERY_STRUCTURED_CLIENT : SOV_DELIVERY_STRUCTURED;
/** 0.8.3: the delivery question is a required next step after every SOV output, in every host. */
export const SOV_DELIVERY_REQUIRED =
  "- REQUIRED NEXT STEP, every host including Claude: every reply that shows the SOV (table, artifact, canvas or file) must end with the delivery question above, word for word, as three numbered options, for every audience (owner, client, CM or team). Never replace it with another question (not \"Overwatch, P6, or Excel?\", not \"client copy?\"), never skip it, never shorten it, and never put a date sweep, summary or note before the table or between the table and the question.";

/** Hidden guidance on report sov results. Instruction text only: Athena sends nothing and stores no file. */
export const SOV_DELIVERY_BLOCK = [
  RENDER_SILENT,
  `- Right after the line-item SOV table, ask exactly (this is the one allowed text after the table):\n${SOV_DELIVERY_ASK}`,
  SOV_DELIVERY_REQUIRED,
  "- Option 1: open the tool's sign-in page and let the member sign in themselves. Never ask for, type or store a password. Enter the lines, then show a side-by-side check against the SOV total before anything is saved.",
  "- Option 2: build a real .xlsx (or a PDF if the member wants one) in the house SOV layout: title block (company, job, owner, contract value, date), then item, division, spec section, description, cost code, scheduled value, retainage % and total, subtotals by division, retainage and a grand total that ties to the contract. Then show the email draft card with the file attached in that same reply. Ask who it goes to (team members, the owner, or both); if an address is missing, leave To blank on the card and ask for it in the same reply.",
  "- Option 3: create the Claude artifact, ChatGPT canvas or Grok Bot spreadsheet, set sharing to anyone with the link, then show an email card with the link. This is fine for any audience: owner, owner's rep, client, CM or team.",
  "- Spec sections: use structuredContent.sov.line_items spec_section as given. If it's blank, leave the cell blank; never invent a section number. When structuredContent.sov.specs_note is set, it is the one line allowed under the table (chat and file): spec sections will be cited once specs are uploaded.",
  "- Cost codes: always show a Cost Code column right after the line no. (item number) in the chat table, the artifact or canvas, and the file, filled from line_items cost_code exactly as given (e.g. 26-010). Never replace the cost code with the item number. Blank only when Athena has none for that line.",
  "- Money: every scheduled value and total with cents (line_items scheduled_value_display, e.g. $1,400,000.00). Never round or drop the .00.",
  "- Claude: the delivery question is mandatory even in Claude. Put it directly under the artifact as the last thing in the reply.",
  "- Email on demand, at any point: use the job's saved subs, suppliers and contacts from Athena results (including names and emails written in job answers, lookahead or open-item text) and show the email card right away with recipient, subject, body and attachment filled in. If the contact or address isn't there, leave To blank and ask in the same reply. Never guess an address.",
  "- Claude: no narration before or between steps (no \"Building...\", \"First I'll pull...\" or \"I need two things before...\"). Show the file and the email card in the same reply, To blank if needed, with one short question under it. Never hold the card back while you ask.",
  `- Attachments: ${EMAIL_ATTACHMENT_RULE.replace(/^REQUIRED: /, "")} Claude: pass the file in the Gmail draft's attachments. ChatGPT: its email action can't attach files, so call file_share and put its link in the body.`,
  "- Never send anything in the same reply. Show the email_draft card, ask the yes/no confirm question, and send only after a separate yes and email_confirm_send.",
  `- If the member says "not now", leave the SOV in the chat and add an open item to deliver it within ${SOV_NOT_NOW_DAYS} days (intake section open_item).`,
].join("\n");
/** 0.8.8: one guidance block for every audience. */
export const SOV_DELIVERY_BLOCK_CLIENT = SOV_DELIVERY_BLOCK;
export const sovDeliveryBlock = (_audience: "internal" | "client") => SOV_DELIVERY_BLOCK;

export const VISIBLE_STYLE_LINE = "Display: blue (#1E5FED) accent only, no orange; one caveat line at most.";
const FOOTER_MARK = "\n---\nAthena powered by ALP";

/** Puts VISIBLE_STYLE_LINE just above the Athena footer of the first text block (or at its end). */
export function withStyleLine<R>(r: R): R {
  const res = r as unknown as Res;
  if (!res?.content?.length) return r;
  let done = false;
  const content = res.content.map((c) => {
    if (done || c.type !== "text" || typeof c.text !== "string" || c.text.includes(VISIBLE_STYLE_LINE)) return c;
    done = true;
    const i = c.text.lastIndexOf(FOOTER_MARK);
    const text = i >= 0 ? `${c.text.slice(0, i)}\n${VISIBLE_STYLE_LINE}${c.text.slice(i)}` : `${c.text}\n\n${VISIBLE_STYLE_LINE}`;
    return { ...c, text };
  });
  return { ...res, content } as unknown as R;
}

/** Attach guidance explicitly (preferred over writing it into the text). */
export function guide<R>(r: R, ...lines: string[]): R {
  const extra = lines.filter(Boolean);
  // P0: any result that talks about an email carries the draft-only rule (no same-reply send, separate confirm).
  const body = ((r as unknown as Res)?.content ?? [])
    .map((c) => (typeof c.text === "string" ? c.text : ""))
    .join("\n");
  if (EMAIL_TOPIC_RE.test(body) || extra.some((l) => EMAIL_TOPIC_RE.test(l))) {
    for (const rule of emailRules()) if (!extra.includes(rule)) extra.push(rule);
  }
  return finalizeVisible(r, extra);
}

/** Visible-text check used by tests: returns the offending fragments. */
export function visibleProblems(text: string): string[] {
  const bad: string[] = [];
  for (const line of text.split("\n")) {
    if (REQUIRED_LINE_RE.test(line)) continue;
    const g = line.match(GUIDANCE_RE);
    if (g) bad.push(`instruction: "${g[0]}" in: ${line.trim().slice(0, 160)}`);
    const prose = line.replace(/\[[^\]]*\]\(https?:\/\/[^)]+\)/g, " ").replace(/https?:\/\/\S+/g, " ");
    const c = prose.match(INTERNAL_CODE_RE) ?? prose.match(SNAKE_RE);
    if (c) bad.push(`code: "${c[0]}" in: ${line.trim().slice(0, 160)}`);
  }
  return bad;
}

/** 0.8.9: the same three sharing options for a setup report, for every audience. */
export const REPORT_SHARE_ASK = [
  "If you want to share this report, where should it go?",
  "1. In your project software (Overwatch, Buildertrend, Procore, or another tool). I'll enter it there through the browser after you sign in.",
  "2. As a PDF or Word file. I'll create it and bring up an email for you to review, with the file attached (or a link to it if your email can't carry files from here).",
  "3. As a shared link (a Claude artifact, ChatGPT canvas or Grok Bot document that anyone with the link can open). I'll bring up an email with the link.",
].join("\n");
export const REPORT_SHARE_STRUCTURED = {
  required_next_step: true,
  list_all_options: true,
  never_recommend_one: true,
  ask: REPORT_SHARE_ASK,
  options: [
    { n: 1, kind: "project_software" },
    { n: 2, kind: "pdf_or_docx_email" },
    { n: 3, kind: "shared_link" },
  ],
  attachments: EMAIL_ATTACHMENT_STRUCTURED,
};
