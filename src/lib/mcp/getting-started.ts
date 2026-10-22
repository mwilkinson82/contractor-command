// First-chat card: say Hey Athena. @Athena is the backup.
// The flag is one row per user. A missing migration fails open (no card, no throw).
import { htmlBlock } from "./cards/markdown";
import { renderHtml } from "./cards/html";
import type { CardModel } from "./cards/model";
import { START_BACKUP, START_EXAMPLES, START_HEADLINE, START_HOSTS, START_POINTS } from "../athena-start-copy";

export const GETTING_STARTED_GUIDANCE =
  "Show the getting-started card first. Its headline example is Hey Athena, let's get started. @Athena is only the backup.";

export const GETTING_STARTED_RULE =
  " When the member says Hey Athena, let's get started, Athena, let's get started, let's get going, getting started, or Hey Athena, getting started, call getting_started and show that card. Let's get started runs guided onboarding: first job setup for a new member, and the morning meeting for a member who already has jobs. On a member's first tool call, show the getting-started card before the rest of the reply. That card's headline example is Hey Athena, let's get started. Good morning Athena and Hey Athena, what's on my plate today? call athena_hello or morning_brief. @Athena is only the backup. Do not answer the setup questions for the member.";

export function gettingStartedCard(): CardModel {
  return {
    state: "result",
    show_state: false,
    title: START_HEADLINE,
    job: START_HOSTS,
    sections: [
      { heading: "Your work", kind: "list", rows: START_POINTS.map((line) => ({ cells: [line] })) },
      { heading: "Try one", kind: "list", rows: START_EXAMPLES.map((ask) => ({ cells: [ask] })) },
      { heading: "Backup", kind: "list", rows: [{ cells: [START_BACKUP] }] },
    ],
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

/** No jobs opens setup. One job opens that morning meeting. More than one opens the which-job card. */
export async function branchGettingStarted<T>(sb: MemberDb, morning: (jobNumber?: string) => Promise<T>, setup: (company: boolean) => T): Promise<T> {
  const found = await memberJobs(sb);
  if (!found.jobs.length) return setup(found.company);
  if (found.jobs.length === 1) return morning(found.jobs[0].job_number);
  return morning();
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
    assistant_guidance: prior.includes(GETTING_STARTED_GUIDANCE) ? prior : [...prior, GETTING_STARTED_GUIDANCE],
  };
  const content =
    opts?.prepend === false
      ? res.content
      : res.content!.map((c) => (c === first ? { ...c, text: `${renderGettingStarted(card)}\n\n${first.text}` } : c));
  return { ...(res as object), content, structuredContent } as R;
}
