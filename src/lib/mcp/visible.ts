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

export const INTERNAL_CODE_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\[ref #[0-9a-f]{6}[^\]]*\]|\btype (?:unknown|deadline|no|na_disposition|pending_document)\b|\b(?:setup|flag|tz|delay_notice|delay_claim|warranty|bss_[a-z_]+):[a-z0-9_:-]+/i;

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

type Res = { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; _meta?: Record<string, unknown> };

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
  const prior = Array.isArray(res.structuredContent?.assistant_guidance) ? (res.structuredContent!.assistant_guidance as string[]) : [];
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
export const CHART_PALETTE_RULE =
  "- Chart palette (every chart, graph, bar, table and artifact, in Claude, ChatGPT, Grok and any other host): set the colors explicitly to blue #2563EB for the main series plus grays #6B7280, #9CA3AF, #D1D5DB and #F3F4F6 for everything else. Never red, rose, pink, orange, amber or the host's default palette. In Claude artifacts, write these hex values into the chart config; never leave colors to the library default.";
/** 0.8.3 money rule. */
export const MONEY_CENTS_RULE =
  "- Money: always show dollars with cents exactly as Athena gives them, e.g. $1,400,000.00 and $700,000.00, in every line and every total. Never round, never drop the .00, never abbreviate ($1.4M). Use the *_display strings in structuredContent when present.";
/** 0.8.3 date sweep rule. */
export const DATE_SWEEP_RULE =
  "- Date sweep (overdue, due today, next 14 days): show it only when the member asks for it (or for open items) or when a job is first opened in the session. Never prepend it to an SOV, a contract result, a chart or any other reply, and never add a \"Date sweep\" heading of your own.";

/** Exact summary offer (same text as contract-clauses SUMMARY_OFFER). */
export const SUMMARY_OFFER_TEXT = "Do you want me to summarize this legal text so you know what it means in plain English?";

/** How the host should show every Athena result. Goes in assistant_guidance on every tool result (guard.run), never in the visible text. */
export const HOST_DISPLAY_BLOCK = [
  "HOUSE STYLE (for the assistant; don't repeat to the member):",
  "- Athena supplies the data; you do all the formatting. Never say Athena built, drew or rendered anything.",
  "- Contract and notice terms: always show them as white cards, never as plain text or a plain table. One card per clause: section number and heading, days, and who it goes to, then the exact clause text word for word in a light gray panel inside the card. Section numbers first, wording unchanged. After the cards, ask exactly: \"Do you want me to summarize this legal text so you know what it means in plain English?\" Summarize only if they say yes.",
  "- Nothing before or between the clause cards: no preview, no summary, no \"tightest clock\" or \"key deadline\" line. The offer wording is exact; don't reword, shorten or add to it.",
  "- In Claude, build any artifact only from the data already in this chat. Never call Athena (or any tool) from inside an artifact.",
  "- Visual first, by default (never an opt-in): put tables and cards in white cards with light gray panels behind any text. Minimal and clean.",
  "- Charts, tables, totals and highlights: blue #2563EB and gray only, never orange, rust or red, including totals.",
  "- Colors: blue #2563EB is the only accent, for buttons and the one item that needs action. Charts, bars and KPI numbers use blue #2563EB for the main series and gray for everything secondary. Never orange, terracotta, red or the host's default chart palette. Don't mention colors.",
  "- Warnings: no red and no amber. Mark the one item that needs action in blue #2563EB; everything else stays dark or gray text.",
  "- After the visual, at most 3 short lines of text, and at most one plain-English caveat line, only if it changes what they should do. Dashboards: one caveat line at most and never a \"Priority:\" block.",
  "- Contract output order: clause cards, then ONE line for any missing or partial notices (fold them all into that line), then the exact summary offer as the very last line. Nothing after the offer.",
  "- Never write \"No changes were made\", \"No items were changed\" or similar lines, and no filler openers such as \"Pulling up...\", \"Let me...\" or \"Here's...\". Start with the visual.",
  "- In Claude, build every artifact as static data embedded from this tool result: no connector or MCP calls inside the artifact, no live refresh and no re-reading Athena. At most 2 lines of text after the artifact.",
  CHART_PALETTE_RULE,
  MONEY_CENTS_RULE,
  DATE_SWEEP_RULE,
  "- Schedule of values (report deliverable sov): present it as a spreadsheet, line-item view by default: one row per line with line no., cost code, division, description, scheduled value and % of total (the Cost Code column always sits right after the line no.), then the grand total that ties to the contract sum. Claude: an artifact table built from this result; ChatGPT: a canvas or table; elsewhere: a clean table plus an offer to create an Excel file. Table style: header row blue #2563EB with white bold text; alternating light-gray (#F3F4F6) and white row bands; bold total row with a blue #2563EB top rule. Blue #2563EB and gray only, never orange, rust or red, including totals. After the table, at most one line: no footer or license note and no roll-up offer unless the member asks.",
  `- Summary offer: use this wording verbatim, never paraphrased or shortened: "${SUMMARY_OFFER_TEXT}"`,
  "- Write for contractor office staff and owners. No technical notes: nothing about artifacts, canvas, sharing settings, code, files, tools or colors (the exact SOV delivery question is the one exception).",
  "- Email on demand: whenever the member asks to email something (\"also email this sub\", \"send this to the supplier\"), show the email card in that same reply with recipient, subject, body and attachment filled in from Athena's saved job data. If the address isn't in Athena's results, leave To blank on the card and ask for it in the same reply. Never guess an address. The member presses Send.",
  "- Keep everything private. Never publish, share or create a public link unless the member asks for it in this chat.",
].join("\n");

/** Project software is a real setup step: check key, and its fixed place in next_question (2nd, right after the job number check). */
export const PROJECT_SOFTWARE_KEY = "project_software";
export const PROJECT_SOFTWARE_POSITION = 2;

/** Job setup: where the job lives. Exact member-facing wording; the host asks it, never Athena's visible text. */
export const JOB_SOFTWARE_ASK =
  "Is this job already set up in your project software? Which one do you use: Overwatch, Buildertrend, Procore, Primavera P6, another web tool, or Excel?";
export const JOB_SOFTWARE_TOOL_FOLLOWUP = "Do you want me to create the job there, or is it already set up?";
export const JOB_SOFTWARE_NONE_FOLLOWUP =
  "No problem. I can build the schedule of values and the CPM schedule right here in chat, or as an Excel file you can keep. Which would you like?";

/** Hidden guidance on job-setup next_question results. Instruction text only: no new field, nothing stored by Athena. */
export const JOB_SETUP_SOFTWARE_BLOCK = [
  "JOB SETUP: WHERE THIS JOB LIVES (for the assistant; don't repeat to the member):",
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
  "2. As an Excel file (.xlsx). I'll create it and bring up an email for you to review, with the file attached.",
  "3. As a shared spreadsheet in this chat (a Claude artifact, ChatGPT canvas or Grok Bot). I'll bring up an email with the link for your team.",
].join("\n");
/** 0.8.6: the owner/client SOV never offers the chat link; options 1 and 2 only. */
export const SOV_DELIVERY_ASK_CLIENT = SOV_DELIVERY_ASK.split("\n").slice(0, 3).join("\n");
export const sovDeliveryAsk = (audience: "internal" | "client") => (audience === "client" ? SOV_DELIVERY_ASK_CLIENT : SOV_DELIVERY_ASK);
export const SOV_OWNER_REDIRECT = "For the owner, I'll send a clean Excel or PDF instead, since a chat link doesn't look professional.";
export const SOV_NOT_NOW_DAYS = 3;
/** 0.8.4: member-facing link rule, printed under the delivery question in the report text. */
export const SOV_LINK_RULE_TEXT = "Chat links are for your team only. The owner always gets a clean Excel file or a PDF. There are no exceptions.";
/** 0.8.7: the owner/client chat link is a hard no. Tool text guidance and structuredContent both carry it. */
export const SOV_LINK_HARD_NO =
  "HARD NO, every host including Claude: an artifact, canvas or chat link never goes to the owner, the owner's rep or any client. If the member asks for one, refuse in one line and offer the Excel file or a PDF. Never offer the link anyway, never offer to override or bend the rule, never ask whether they want to override it, and never build an owner copy with a link or send button. Do not write anything like \"or the shared link anyway if you're fine overriding that rule\". The member cannot waive this.";
/** 0.8.7: report sov always comes with a bar chart of scheduled value by line, in the fixed palette. */
export const SOV_CHART_RULE =
  "REQUIRED, every host (Claude, ChatGPT, Grok and any other): draw a bar chart of the SOV from structuredContent.sov.chart: one bar per line (x: the line label, y: scheduled value), in the order given, placed directly under the SOV table and before the delivery question. Set the colors explicitly: bars #2563EB; axes, gridlines and labels in the grays #6B7280, #9CA3AF, #D1D5DB and #F3F4F6, with alternating gray bands (chart.band_colors) behind the bars; ChatGPT and every other host must show the gray as well as the blue. Never use the host's default palette, and never red, rose, pink, orange or amber. Money labels with cents (value_display). No chart title text beyond \"Scheduled value by line\" and no extra commentary.";
export function sovChart(rows: { item_no: string; cost_code: string | null; description: string | null; scheduled_value: number; scheduled_value_display: string }[]) {
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
    bars: rows.map((r) => ({ label: `${r.item_no}${r.cost_code ? ` (${r.cost_code})` : ""}`, description: r.description, value: r.scheduled_value, value_display: r.scheduled_value_display })),
  };
}
/**
 * 0.8.8: short imperative lines pinned at the TOP of the report sov text content (not only guidance or
 * structuredContent), because Claude skips guidance. Chart data is inline; owner link is a flat refusal;
 * the email draft starts with its To line.
 */
export const SOV_OWNER_LINK_REQUIRED =
  "REQUIRED: If asked to send the owner a link, even after \"send it anyway\", refuse. Say: Owners get the Excel file or a PDF, no exceptions. Do not create the link.";
export function sovRequiredTop(rows: { item_no: string; cost_code: string | null; scheduled_value_display: string }[], toLine: string): string {
  const data = rows.map((r) => `${r.item_no}${r.cost_code ? ` (${r.cost_code})` : ""} ${r.scheduled_value_display}`).join("; ");
  return [
    `REQUIRED: Draw this bar chart now under the table. Bars blue #2563EB; gray bands #F3F4F6 behind them; gray grid #D1D5DB; gray axes and labels #6B7280. No other colors. Data: ${data}.`,
    SOV_OWNER_LINK_REQUIRED,
    `REQUIRED: Any email draft for this SOV starts with "${toLine}" and shows a To field; if there is no address, leave To blank and ask for it in this same reply.`,
  ].join("\n");
}
/** 0.8.4: the delivery step as data, in report sov structuredContent, so hosts can't skip it. */
export const SOV_DELIVERY_STRUCTURED = {
  required_next_step: true,
  ask: SOV_DELIVERY_ASK,
  options: [
    { n: 1, kind: "project_software", note: "Member signs in themselves; never ask for or type a password." },
    { n: 2, kind: "xlsx_email", note: "Build the .xlsx, then show an email card with it attached; To blank and asked in the same reply if no address." },
    { n: 3, kind: "chat_link_team_only", note: "Artifact or canvas link for team members only." },
  ],
  link_rule: "Artifact or canvas links go to team members only, never to the owner or owner's rep. Refuse an owner link and offer the Excel or a PDF.",
  link_hard_no: true,
  never_offer_override: true,
  owner_link_rule: SOV_LINK_HARD_NO,
  owner_redirect: SOV_OWNER_REDIRECT,
  link_rule_text: SOV_LINK_RULE_TEXT,
} as const;
/** 0.8.6: owner/client SOV delivery data: option 3 (chat link) is dropped entirely. */
export const SOV_DELIVERY_STRUCTURED_CLIENT = {
  ...SOV_DELIVERY_STRUCTURED,
  audience: "client",
  ask: SOV_DELIVERY_ASK_CLIENT,
  options: SOV_DELIVERY_STRUCTURED.options.filter((o) => o.n !== 3),
} as const;
export const sovDeliveryStructured = (audience: "internal" | "client") => (audience === "client" ? SOV_DELIVERY_STRUCTURED_CLIENT : SOV_DELIVERY_STRUCTURED);
/** 0.8.3: the delivery question is a required next step after every SOV output, in every host. */
export const SOV_DELIVERY_REQUIRED =
  "- REQUIRED NEXT STEP, every host including Claude: every reply that shows the SOV (table, artifact, canvas or file) must end with the delivery question above, word for word, as numbered options (three for the team SOV; two for the owner/client SOV, which never offers the chat link). Never replace it with another question (not \"Overwatch, P6, or Excel?\", not \"client copy?\"), never skip it, never shorten it, and never put a date sweep, summary or note before the table or between the table and the question.";

/** Hidden guidance on report sov results. Instruction text only: Athena sends nothing and stores no file. */
export const SOV_DELIVERY_BLOCK = [
  "SOV DELIVERY (for the assistant; don't repeat to the member):",
  `- Right after the line-item SOV table, ask exactly (this is the one allowed text after the table):\n${SOV_DELIVERY_ASK}`,
  SOV_DELIVERY_REQUIRED,
  "- Option 1: open the tool's sign-in page and let the member sign in themselves. Never ask for, type or store a password. Enter the lines, then show a side-by-side check against the SOV total before anything is saved.",
  "- Option 2: build a real .xlsx in the house SOV layout: title block (company, job, owner, contract value, date), then item, division, spec section, description, cost code, scheduled value, retainage % and total, subtotals by division, retainage and a grand total that ties to the contract. Then show the email draft card with the file attached in that same reply. Ask who it goes to (team members, the owner, or both); if an address is missing, leave To blank on the card and ask for it in the same reply.",
  "- Option 3: create the artifact, canvas or Grok Bot spreadsheet, then show an email card with the link, for team members only. Never list option 3 on an owner or client SOV (audience client): show options 1 and 2 only, exactly as in structuredContent.delivery.ask.",
  `- Owners and owner's reps get the Excel or a PDF only, never an artifact or canvas link. If the member picks option 3 for the owner, say exactly: "${SOV_OWNER_REDIRECT}" Then offer option 2 or a PDF. Never offer the link anyway or any way to override this.`,
  `- ${SOV_LINK_HARD_NO}`,
  "- Spec sections: use structuredContent.sov.line_items spec_section as given. If it's blank, leave the cell blank; never invent a section number. When structuredContent.sov.specs_note is set, it is the one line allowed under the table (chat and file): spec sections will be cited once specs are uploaded.",
  "- Cost codes: always show a Cost Code column right after the line no. (item number) in the chat table, the artifact or canvas, and the file, filled from line_items cost_code exactly as given (e.g. 26-010). Never replace the cost code with the item number. Blank only when Athena has none for that line.",
  "- Money: every scheduled value and total with cents (line_items scheduled_value_display, e.g. $1,400,000.00). Never round or drop the .00.",
  "- Claude: the delivery question is mandatory even in Claude. Put it directly under the artifact as the last thing in the reply.",
  "- Email on demand, at any point: use the job's saved subs, suppliers and contacts from Athena results (including names and emails written in job answers, lookahead or open-item text) and show the email card right away with recipient, subject, body and attachment filled in. If the contact or address isn't there, leave To blank and ask in the same reply. Never guess an address.",
  "- Claude: no narration before or between steps (no \"Building...\", \"First I'll pull...\" or \"I need two things before...\"). Show the file and the email card in the same reply, To blank if needed, with one short question under it. Never hold the card back while you ask.",
  "- Never send anything yourself. The member reviews the email card and presses Send.",
  `- If the member says "not now", leave the SOV in the chat and add an open item to deliver it within ${SOV_NOT_NOW_DAYS} days (intake section open_item).`,
].join("\n");
/** 0.8.6: the owner/client SOV guidance asks the two-option question. */
export const SOV_DELIVERY_BLOCK_CLIENT = SOV_DELIVERY_BLOCK.replace(SOV_DELIVERY_ASK, SOV_DELIVERY_ASK_CLIENT);
export const sovDeliveryBlock = (audience: "internal" | "client") => (audience === "client" ? SOV_DELIVERY_BLOCK_CLIENT : SOV_DELIVERY_BLOCK);

/** One short, member-safe display line kept in the visible text, for hosts that read only the visible text. */
export const VISIBLE_STYLE_LINE = "Display: blue (#2563EB) accent only, no orange; one caveat line at most.";
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
  return finalizeVisible(r, lines.filter(Boolean));
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
