// First-chat card: start with @Athena. Hey Athena is only the bonus, after the memory line is saved.
// The flag is one row per user. A missing migration fails open (no card, no throw).
import { htmlBlock } from "./cards/markdown";
import { renderHtml } from "./cards/html";
import type { CardModel } from "./cards/model";
import {
  MEMORY_ASK,
  MEMORY_BONUS,
  MEMORY_HOST_LINES,
  MEMORY_LINE,
  MEMORY_WAIT,
  START_AT_EXAMPLES,
  START_BACKUP,
  START_EXAMPLES,
  START_HABIT,
  START_HEADLINE,
  START_HOSTS,
  START_MEMORY_OFFER,
  START_POINTS,
} from "../athena-start-copy";

export const GETTING_STARTED_GUIDANCE = [
  "Show the getting-started card first. Its headline is @Athena, let's get started. Every Try one line starts with @Athena. Hey Athena stays only on the bonus line, and it works after the memory line is saved.",
  `Ask first. The card asks: ${MEMORY_ASK} Save nothing in that reply.`,
  `Only after the member says yes, save this exact line in the member's own AI: ${MEMORY_LINE}.`,
  ...MEMORY_HOST_LINES,
  "If the member says no, save nothing.",
  `Keep teaching the one habit: ${START_HABIT} The memory line is the bonus so plain Hey Athena also works.`,
].join(" ");

export const GETTING_STARTED_RULE =
  " When the member says Hey Athena, let's get started, Athena, let's get started, let's get going, getting started, @Athena let's get started, or Hey Athena, getting started, call getting_started and show that card first. Never start that reply with a which-job picker, and never ask Which job's morning hitlist? Do not call athena_morning_hitlist, pm_morning, or morning_brief for that phrase. No jobs: first-job setup, or company setup when there is no company. Jobs already on file stay on that card: the @Athena example lines, the offer to save When I say Athena, always use the Athena connector and how to remove it, then the morning meeting. One job: name it on the card. More than one job: the job list sits inside that same card. On a member's first tool call, show the getting-started card before the rest of the reply. Good morning Athena and Hey Athena, what's on my plate today? call athena_hello or morning_brief. Keep teaching the one habit: start every message with @Athena. Ask first. Save nothing in that reply. Only after the member says yes, save the line. ChatGPT: ask ChatGPT to remember it in saved memory. Claude: save it in memory or project instructions. Grok Bot: save it in memory. If the member says no, save nothing. Do not answer the setup questions for the member.";

/** What the host reads when it is time to save. saved stays false until the member says yes. */
export function memoryOffer() {
  return {
    line: MEMORY_LINE,
    ask: MEMORY_ASK,
    habit: START_HABIT,
    save_only_after_yes: true,
    saved: false,
    hosts: {
      chatgpt: MEMORY_HOST_LINES[0],
      claude: MEMORY_HOST_LINES[1],
      grok_bot: MEMORY_HOST_LINES[2],
    },
  };
}

export function gettingStartedCard(): CardModel {
  return {
    state: "result",
    show_state: false,
    title: START_HEADLINE,
    job: START_HOSTS,
    sections: [
      { heading: "Your work", kind: "list", rows: START_POINTS.map((line) => ({ cells: [line] })) },
      { heading: "Try one", kind: "list", rows: START_EXAMPLES.map((ask) => ({ cells: [ask] })) },
      { heading: "One habit", kind: "list", rows: [{ cells: [START_HABIT] }] },
      { heading: "Backup", kind: "list", rows: [{ cells: [START_BACKUP] }] },
      {
        heading: "Bonus",
        kind: "list",
        rows: [{ cells: [MEMORY_LINE] }, { cells: [MEMORY_BONUS] }, { cells: [MEMORY_WAIT] }],
      },
      { heading: "If you say yes", kind: "list", rows: MEMORY_HOST_LINES.map((line) => ({ cells: [line] })) },
    ],
    next_move: MEMORY_ASK,
  };
}

/** Readable text for a host that does not paint ui://athena/card.html. Same words as the card. */
export function plainGettingStarted(card: CardModel = gettingStartedCard()): string {
  const lines: string[] = [card.title];
  if (card.job) lines.push(card.job, "");
  if (card.ask?.prompt) lines.push(card.ask.prompt, "");
  for (const section of card.sections ?? []) {
    lines.push(section.heading);
    for (const row of section.rows) {
      const line = row.cells.filter(Boolean).join(" ");
      if (line) lines.push(line);
    }
    lines.push("");
  }
  if (card.next_move) lines.push(`Next move: ${card.next_move}`);
  return lines.join("\n").trim();
}

export function firstJobCard(company: boolean): CardModel {
  if (!company) {
    return {
      state: "ask",
      show_state: false,
      title: "Let's set up your company",
      ask: { prompt: "What is the company name?" },
      sections: [{ heading: "Why", kind: "list", rows: [{ cells: ["Jobs belong to a company. The company name is the first save."] }] }],
      next_move: "Send the company name.",
    };
  }
  return {
    state: "ask",
    show_state: false,
    title: "Let's set up your first job",
    ask: { prompt: "What is the job number, and what should we call the job?" },
    sections: [{ heading: "Why", kind: "list", rows: [{ cells: ["The job number is required. The morning meeting and the boards start from that job."] }] }],
    next_move: "Send the job number and the name.",
  };
}

export function firstJobGuidance(company: boolean): string {
  return company
    ? "Ask for the job number and the job name. Do not invent them. Record the job with intake section create_job. The scope question is next. Do not assume the job type."
    : "Ask for the company name. Do not invent it. Record it with onboarding action save_company. Then ask for the job number and the job name.";
}

type MemberDb = {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, ids: string[]) => Promise<{ data: unknown; error: { message?: string } | null }>;
      then: Promise<{ data: unknown; error: { message?: string } | null }>["then"];
    };
  };
};

export async function memberJobs(sb: MemberDb): Promise<{ company: boolean; jobs: { job_number: string; name: string | null }[] }> {
  const companies = await sb.from("mcp_companies").select("id");
  if (companies.error) throw new Error(companies.error.message ?? "database error");
  const ids = ((companies.data ?? []) as { id: string }[]).map((c) => c.id);
  if (!ids.length) return { company: false, jobs: [] };
  const jobs = await sb.from("mcp_jobs").select("job_number, name").in("company_id", ids);
  if (jobs.error) throw new Error(jobs.error.message ?? "database error");
  return { company: true, jobs: (jobs.data ?? []) as { job_number: string; name: string | null }[] };
}

export type StartedJob = { job_number: string; name: string | null };

/**
 * The get-started card for a member who already has jobs.
 * The title stays the habit. A job list, when there is more than one job, is a section on this card.
 */
export function startedWithJobsCard(jobs: StartedJob[]): CardModel {
  const base = gettingStartedCard();
  const one = jobs.length === 1 ? jobs[0] : null;
  const label = (job: StartedJob) => `${job.job_number}${job.name ? ` (${job.name})` : ""}`;
  const jobsRows = one
    ? [{ cells: [`Open it on ${label(one)}.`], tone: "action" as const }]
    : [
        ...jobs.map((job) => ({ cells: [label(job)], tone: "action" as const })),
        { cells: ["Name the job for the morning meeting."], tone: "action" as const },
      ];
  return {
    ...base,
    title: "Hey Athena, let's get started",
    ask: null,
    sections: [
      ...(base.sections ?? []),
      { heading: "@Athena", kind: "list", rows: START_AT_EXAMPLES.map((line) => ({ cells: [line] })) },
      { heading: "Memory", kind: "list", rows: [{ cells: [START_MEMORY_OFFER], tone: "action" }] },
      { heading: "Morning meeting", kind: "list", rows: jobsRows },
    ],
    next_move: one ? `The morning meeting is on ${one.job_number}.` : "Name the job and I will open the morning meeting.",
  };
}

/** No jobs opens setup. Jobs already on file stay on the get-started card. The morning meeting is not opened here. */
export async function branchGettingStarted<T>(sb: MemberDb, morning: (jobNumber?: string) => Promise<T>, setup: (company: boolean) => T): Promise<T> {
  const found = await memberJobs(sb);
  if (!found.jobs.length) return setup(found.company);
  void morning;
  return startedWithJobsCard(found.jobs) as T;
}

export function renderGettingStarted(card: CardModel = gettingStartedCard()): string {
  return `${plainGettingStarted(card)}\n\n${htmlBlock(renderHtml(card))}`;
}

type TextBlock = { type: string; text?: string };
type TextRes = { content?: TextBlock[]; structuredContent?: Record<string, unknown> };
type Rpc = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** True only when this call inserted the user's first-run row. */
export async function claimGettingStarted(sb: Rpc): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("mcp_getting_started_claim");
    if (error) return false;
    return !!data && typeof data === "object" && (data as { show?: boolean }).show === true;
  } catch {
    return false;
  }
}

/**
 * Puts the start card on the first tool result for this user.
 * Card-first tools keep their reply text and carry the card on structuredContent
 * so the widget paints it above the tool card.
 */
export async function attachGettingStarted<R>(sb: Rpc, result: R, opts?: { prepend?: boolean }): Promise<R> {
  const res = result as unknown as TextRes;
  const first = res?.content?.find((c) => c.type === "text" && typeof c.text === "string");
  if (!first?.text) return result;
  const sc = { ...(res.structuredContent ?? {}) };
  if ("getting_started" in sc) return result;
  const show = await claimGettingStarted(sb);
  if (!show) return result;
  const card = gettingStartedCard();
  const prior = Array.isArray(sc.assistant_guidance) ? (sc.assistant_guidance as string[]) : [];
  const structuredContent = {
    ...sc,
    getting_started: card,
    memory_offer: memoryOffer(),
    assistant_guidance: prior.includes(GETTING_STARTED_GUIDANCE) ? prior : [...prior, GETTING_STARTED_GUIDANCE],
  };
  const content =
    opts?.prepend === false
      ? res.content
      : res.content!.map((c) => (c === first ? { ...c, text: `${renderGettingStarted(card)}\n\n${first.text}` } : c));
  return { ...(res as object), content, structuredContent } as R;
}

/**
 * Puts the getting-started card, with the memory ask, in front of a guided result.
 * The host saves the line only after a later yes. This reply does not save it.
 */
export function withMemoryOffer<R>(result: R): R {
  const res = result as unknown as TextRes;
  const first = res?.content?.find((c) => c.type === "text" && typeof c.text === "string");
  if (!first?.text) return result;
  const card = gettingStartedCard();
  const sc = { ...(res.structuredContent ?? {}) };
  const prior = Array.isArray(sc.assistant_guidance) ? (sc.assistant_guidance as string[]) : [];
  const assistant_guidance = prior.includes(GETTING_STARTED_GUIDANCE) ? prior : [GETTING_STARTED_GUIDANCE, ...prior];
  const content = first.text.includes(MEMORY_LINE)
    ? res.content
    : res.content!.map((c) => (c === first ? { ...c, text: `${renderGettingStarted(card)}\n\n${first.text}` } : c));
  return {
    ...(res as object),
    content,
    structuredContent: {
      ...sc,
      getting_started: card,
      memory_offer: memoryOffer(),
      assistant_guidance,
    },
  } as R;
}
