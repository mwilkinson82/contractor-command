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

export function splitGuidance(text: string): { visible: string; guidance: string[] } {
  const guidance: string[] = [];
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (!GUIDANCE_RE.test(line)) {
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

/** How the host should show every Athena result. Goes in assistant_guidance on every tool result (guard.run), never in the visible text. */
export const HOST_DISPLAY_BLOCK = [
  "HOUSE STYLE (for the assistant; don't repeat to the member):",
  "- Athena supplies the data; you do all the formatting. Never say Athena built, drew or rendered anything.",
  "- Contract and notice terms: always show them as white cards, never as plain text or a plain table. One card per clause: section number and heading, days, and who it goes to, then the exact clause text word for word in a light gray panel inside the card. Section numbers first, wording unchanged. After the cards, ask exactly: \"Do you want me to summarize this legal text so you know what it means in plain English?\" Summarize only if they say yes.",
  "- Nothing before or between the clause cards: no preview, no summary, no \"tightest clock\" or \"key deadline\" line. The offer wording is exact; don't reword, shorten or add to it.",
  "- In Claude, build any artifact only from the data already in this chat. Never call Athena (or any tool) from inside an artifact.",
  "- Visual first, by default (never an opt-in): put tables and cards in white cards with light gray panels behind any text. Minimal and clean.",
  "- Colors: blue #2563EB is the only accent, for buttons and the one item that needs action. Charts, bars and KPI numbers use blue #2563EB for the main series and gray for everything secondary. Never orange, terracotta, red or the host's default chart palette. Don't mention colors.",
  "- Warnings: no red and no amber. Mark the one item that needs action in blue #2563EB; everything else stays dark or gray text.",
  "- After the visual, at most 3 short lines of text, and at most one plain-English caveat line, only if it changes what they should do.",
  "- Write for contractor office staff and owners. No technical notes: nothing about artifacts, canvas, sharing settings, code, files, tools or colors.",
  "- Keep everything private. Never publish, share or create a public link unless the member asks for it in this chat.",
].join("\n");

/** Job setup: where the job lives. Exact member-facing wording; the host asks it, never Athena's visible text. */
export const JOB_SOFTWARE_ASK =
  "Is this job already set up in your project software? Which one do you use: Overwatch, Buildertrend, Procore, or something else?";
export const JOB_SOFTWARE_TOOL_FOLLOWUP = "Do you want me to create the job there, or is it already set up?";
export const JOB_SOFTWARE_NONE_FOLLOWUP =
  "No problem. I can build the schedule of values and the CPM schedule right here in chat, or as an Excel file you can keep. Which would you like?";

/** Hidden guidance on job-setup next_question results. Instruction text only: no new field, nothing stored by Athena. */
export const JOB_SETUP_SOFTWARE_BLOCK = [
  "JOB SETUP: WHERE THIS JOB LIVES (for the assistant; don't repeat to the member):",
  `- Ask once per job, right after the contract and SOV basics are recorded and before the CPM schedule step. Ask exactly: "${JOB_SOFTWARE_ASK}"`,
  `- If they name a tool, ask exactly: "${JOB_SOFTWARE_TOOL_FOLLOWUP}"`,
  `- If they say none or not sure, say exactly: "${JOB_SOFTWARE_NONE_FOLLOWUP}"`,
  "- If the member says yes, create it in their tool: use your browser (or the member's browser) to open the tool, have the MEMBER sign in themselves (never ask for or type a password), then create the job and build the SOV, the CPM schedule, cost loading and billing there from Athena's job data. Confirm each screen with the member before saving anything.",
  "- If the job already exists there: open it, compare it to Athena's SOV and schedule, and list the differences. Don't overwrite anything without a yes.",
  "- If there's no tool, or you have no browser: offer to build it in chat (tables and charts) or in Excel (an SOV sheet, a schedule sheet and a cost-loaded billing forecast). Work through the choice with the member one question at a time.",
  "- Athena only supplies the job data; you do the building. Never say Athena created, built or set up anything.",
  "- Athena has no field for this answer yet, so keep it in this chat (the tool name, or chat or Excel) and use the same place for every later step. Don't record it in job settings, an open item or a setup answer.",
  "- Keep it plain: one question at a time, no technical notes.",
].join("\n");

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
    const g = line.match(GUIDANCE_RE);
    if (g) bad.push(`instruction: "${g[0]}" in: ${line.trim().slice(0, 160)}`);
    const c = line.match(INTERNAL_CODE_RE) ?? line.match(SNAKE_RE);
    if (c) bad.push(`code: "${c[0]}" in: ${line.trim().slice(0, 160)}`);
  }
  return bad;
}
