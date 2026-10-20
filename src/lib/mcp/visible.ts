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
  "HOW TO SHOW THIS (for the assistant, don't repeat to the member):",
  "- Contract terms: show the clauses exactly as written with their section numbers first. Then ask: \"Do you want me to summarize this legal text so you know what it means in plain English?\" Summarize only if they say yes.",
  "- Show tables and cards as a styled visual by default, never as an opt-in: white card background, light gray panels behind the text, blue for buttons and highlights, minimal and clean. Don't mention the colors.",
  "- Lead with the visual, then at most 3 short lines of text. At most one plain-English caveat line, only if it changes what they should do.",
  "- Write for contractor office staff and owners. No technical notes: nothing about artifacts, sharing settings, tools, code, files or colors.",
  "- Keep everything private. Never publish, share or create a public link unless the member asks for it in this chat.",
].join("\n");

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
