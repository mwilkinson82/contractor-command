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
  return line.split(/(?<=[.!?])\s+(?=[A-Z"(])/);
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
export const CHART_PALETTE_RULE = "- Draw each chart from the chart data in the result.";
/** 0.8.3 money rule. */
export const MONEY_CENTS_RULE =
  "- Show money with cents exactly as given, e.g. $1,400,000.00. Never round and never drop the .00.";
/** 0.8.3 date sweep rule. */
export const DATE_SWEEP_RULE =
  "- Show a date sweep only when this result includes one or the member asks for open items. Do not add one to an SOV or another reply.";

/** Exact summary offer (same text as contract-clauses SUMMARY_OFFER). */
export const SUMMARY_OFFER_TEXT =
  "Do you want me to summarize this legal text so you know what it means in plain English?";

/** Short imperatives on every result. No palette, no layout recipe, no internal-guidance label. */
export const HOST_DISPLAY_BLOCK = [
  "Show each result as written.",
  `Show contract clauses word for word, section numbers first, wording unchanged. Then ask exactly: "${SUMMARY_OFFER_TEXT}"`,
  "Fold any missing or partial notices into one line before that question.",
  MONEY_CENTS_RULE,
  DATE_SWEEP_RULE,
  "Show the SOV with line no., cost code, division, description, scheduled value, and percent of total.",
  "Call email_draft and show the email card in that same reply. If the address is missing, leave To blank and ask. Never guess an address.",
  "Pass confirmed true only after the member says yes.",
  "Do not invent missing data.",
  "Never publish, share or create a public link unless the member asks.",
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
  "List all 3 sharing options below, numbered 1, 2 and 3, exactly as written. Never recommend one.";
/**
 * 0.8.10: attachments. Athena returns no files; the host builds the file and the host's email tool must carry it.
 * ChatGPT's Gmail/Outlook email action has no attachment field (drafts and sends go out bare), Claude's Gmail
 * create_draft takes base64 attachments, Grok Bot attaches to a Gmail draft. Never claim an attachment that isn't there.
 */
export const EMAIL_ATTACHMENT_RULE =
  "Only say a file is attached if your email tool actually attached it. Otherwise call file_share and put a link to the file in the email body (app.meetathena.io/f/).";
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
  'The first line of the card itself is the literal label "To:" followed by the address. Never put To: outside the card.';
/** 0.8.7: report sov always comes with a bar chart of scheduled value by line, in the fixed palette. */
export const SOV_CHART_RULE =
  "Draw the bar chart from the chart data in this result, under the table and before the delivery question.";
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
export function sovRequiredTop(
  rows: { item_no: string; cost_code: string | null; scheduled_value_display: string }[],
  toLine: string,
): string {
  const data = rows
    .map(
      (r) => `${r.item_no}${r.cost_code ? ` (${r.cost_code})` : ""} ${r.scheduled_value_display}`,
    )
    .join("; ");
  return [
    `Draw the bar chart from the chart data under the table. Data: ${data}.`,
    `Show "To:" as the first line inside the card itself: ${toLine}. If there is no address, leave To blank and ask.`,
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
  "End every SOV reply with the delivery question above, word for word, as three numbered options. Do not skip it, shorten it, or replace it.";

/** Hidden guidance on report sov results. Instruction text only: Athena sends nothing and stores no file. */
export const SOV_DELIVERY_BLOCK = [
  `Right after the line-item SOV table, ask exactly:\n${SOV_DELIVERY_ASK}`,
  SOV_DELIVERY_REQUIRED,
  "- Never ask for, type or store a password.",
  "- Never replace the cost code with the item number.",
  "- Show money with cents. Never drop the .00.",
  "- If an address is missing, leave To blank and ask in the same reply. Never guess an address.",
  `- Attachments: ${EMAIL_ATTACHMENT_RULE}`,
  "- Show the email_draft card, then send only after a separate yes and email_confirm_send.",
  `- If the member says "not now", leave the SOV in the chat and add an open item to deliver it within ${SOV_NOT_NOW_DAYS} days.`,
].join("\n");
/** 0.8.8: one guidance block for every audience. */
export const SOV_DELIVERY_BLOCK_CLIENT = SOV_DELIVERY_BLOCK;
export const sovDeliveryBlock = (_audience: "internal" | "client") => SOV_DELIVERY_BLOCK;

/** 0.8.23: no style line is added to visible text. Server-rendered pages carry their own layout. */
export function withStyleLine<R>(r: R): R {
  return r;
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
    const c = line.match(INTERNAL_CODE_RE) ?? line.match(SNAKE_RE);
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
