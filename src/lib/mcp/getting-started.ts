// Context-aware guidance on the existing first-use surface. Entry reads saved work;
// only the existing first-run flag is claimed. It never creates or resets a job.
import { isUuid, jobHomePath, PAGE_ORIGIN } from "../report-pages";
import { htmlBlock } from "./cards/markdown";
import { renderHtml } from "./cards/html";
import type { CardModel, CardSection } from "./cards/model";
import {
  CONNECTOR_ROUTE,
  COST_CODE_ASK,
  COST_CODE_ROUTE,
  DOCUMENT_ASK,
  DOCUMENT_ROUTE,
  MEMORY_ASK,
  MEMORY_HOST_LINES,
  MEMORY_LINE,
  NAVIGATION_LINE,
  START_BACKUP,
  START_EXAMPLES,
  START_HABIT,
  START_HEADLINE,
  START_HOSTS,
  START_POINTS,
} from "../athena-start-copy";

export const GETTING_STARTED_GUIDANCE = [
  "Show the onboarding card once, with its useful next step or saved jobs first. These are choices, not instructions to execute every suggestion.",
  "Greeting, getting started, back, cancel or repeated entry never authorizes company/job creation, reset, imports, mapping or any unrelated write. On back or cancel, stop the pending setup and show choices; retain saved work.",
  "Start a job only after the member explicitly requests creation and supplies the required company, job number and name. Check existing jobs first; resume a matching record rather than create a duplicate. Ask when the company or job is ambiguous.",
  `Ask about existing data without blocking their chosen task: ${DOCUMENT_ASK} ${COST_CODE_ASK}`,
  "Use only routes actually available in this host. Attachments must be readable here; another service needs a working connected tool or authorized signed-in browser. Never promise universal login or access. If access fails, say what was not read and offer a user-provided export or pasted text. Do not retry a denied download.",
  "For supplied documents, inspect the accessible file and name it before claiming review. Continue the requested extraction without an extra approval step. For requested contract/spec uploads, use file_upload begin for the existing private browser file picker, or from_url only for a genuinely fetchable allowed file; never send large base64 in one tool call. Use project_documents list/read/search to reuse saved sources before requesting another upload; keep physical-page/offset continuation and source identity. Existing file_upload prepare_readable can prepare an already stored source when needed, without reupload. Use the existing contract extraction/verification path and intake contract_clauses/contract_terms for exact cited clauses, submittals_import for requested specification requirements, and drawing_set_import only for requested drawings. List existing drawings with drawing_sets_list first. Keep unread, absent and already supplied distinct; never say missing merely because onboarding has not checked.",
  "For supplied cost codes, preserve the member's codes and descriptions. Review the provided list with them; use the existing intake budget path only for an explicitly requested job budget/SOV save with the required data. Do not invent a company code import, parsing pipeline, account mapping or a new integration.",
  "Route a selected choice through current tools: show job list -> jobs_list; project board or job dashboard -> report_page_link with page home; what needs attention -> list_open_items; PM meeting -> pm_meeting; lookahead -> lookahead_get; field board -> field_board. Carry the selected job and company; ask if ambiguous. Do not call them merely because they appear on this card.",
  `${START_HABIT} ${START_BACKUP} Do not claim a wake word, guaranteed host routing, mandatory manual selection, or control over host composer predictions.`,
  "Host memory is optional and never the primary onboarding task. Save nothing in that reply. Only after the member explicitly requests it and the host supports it, offer the preference below. If the member says no, save nothing.",
].join(" ");

export const GETTING_STARTED_RULE =
  " Entry intent takes priority over greeting and proactive morning-brief rules: for Hey Athena, let's get started, let's get started, or a simple get-started request, call getting_started. When the member asks to get started, asks how Athena works, asks how to supply existing project documents or company cost codes, call getting_started (focus documents or cost_codes for those questions). Show one concise onboarding card with the saved jobs or first-job empty state and a clear next choice. Do not open a morning meeting, run suggestions, create records or reset setup merely from a greeting or getting started. Existing jobs are resumed, never recreated. First use is guidance, not an instruction to create a job. On back/cancel, stop pending setup and preserve saved work. " +
  GETTING_STARTED_GUIDANCE;

/** A host preference is available on request, without claiming it was saved. */
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

const list = (heading: string, lines: readonly string[], framed = false): CardSection => ({
  heading,
  kind: "list",
  framed,
  rows: lines.map((line) => ({ cells: [line] })),
});
const choices = (lines: readonly string[]): CardSection => ({
  heading: "Try asking",
  kind: "chips",
  rows: lines.map((line) => ({ cells: [line] })),
});
const bringExisting = () =>
  list("Bring what you already have", [
    "Have a contract, specifications or a schedule? Ask “How do I bring my documents?”",
    COST_CODE_ASK,
  ]);
const workingTogether = () =>
  list("A saved job, not a new chat every time", [START_POINTS[0], NAVIGATION_LINE]);

/** Compact introduction used only as the first-run lead on another requested tool. */
export function gettingStartedCard(): CardModel {
  return {
    presentation: "onboarding",
    state: "result",
    show_state: false,
    title: START_HEADLINE,
    job: START_HOSTS,
    sections: [
      list("Start here", [START_POINTS[0]], true),
      choices(START_EXAMPLES),
      bringExisting(),
    ],
    next_move: "Choose a task in your own words. Your requested result follows below.",
  };
}

export function plainGettingStarted(card: CardModel = gettingStartedCard()): string {
  const lines = [card.title, ...(card.job ? [card.job, ""] : [])];
  if (card.ask?.prompt) lines.push(card.ask.prompt, "");
  for (const section of card.sections ?? []) {
    lines.push(
      section.heading,
      ...section.rows.map((row) => row.cells.filter(Boolean).join(" ")),
      "",
    );
  }
  if (card.next_move) lines.push(`Next move: ${card.next_move}`);
  return lines.join("\n").trim();
}

export function firstJobCard(company: boolean): CardModel {
  return {
    presentation: "onboarding",
    state: "result",
    show_state: false,
    title: "Your first job starts here.",
    job: "No saved jobs yet. Start with one useful task.",
    sections: [
      list(
        "Start a job",
        [
          company
            ? "Tell me “start a job” with its job number and name. We will build its saved record together."
            : "Tell me “start a job” and your company name. Then we will add the job number and name.",
        ],
        true,
      ),
      choices(["Start a job", "How do I bring my documents?", "What can Athena show me?"]),
      bringExisting(),
      workingTogether(),
    ],
    next_move:
      "Start a job, or tell me where your existing project information lives. You can begin without all the documents.",
  };
}

export function firstJobGuidance(company: boolean): string {
  return (
    (company
      ? "If they choose to start a job, ask for its number and name; use intake section create_job only after their explicit request. The scope question follows; never assume job type."
      : "If they choose to start a job, ask for the company name; use onboarding action save_company only for the requested company. Then ask for the job number and name.") +
    " " +
    GETTING_STARTED_GUIDANCE
  );
}

type Company = { id: string; name?: string | null };
export type StartedJob = {
  id?: string;
  job_number: string;
  name: string | null;
  company_id?: string;
  company_name?: string | null;
};
type Query = PromiseLike<{ data: unknown; error: { message?: string } | null }> & {
  in: (
    col: string,
    ids: string[],
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};
type MemberDb = { from: (table: string) => { select: (cols: string) => Query } };

export async function memberJobs(sb: MemberDb): Promise<{ company: boolean; jobs: StartedJob[] }> {
  const companies = await sb.from("mcp_companies").select("id, name");
  if (companies.error) throw new Error(companies.error.message ?? "database error");
  const rows = (companies.data ?? []) as Company[];
  if (!rows.length) return { company: false, jobs: [] };
  const jobs = await sb
    .from("mcp_jobs")
    .select("id, job_number, name, company_id")
    .in(
      "company_id",
      rows.map((c) => c.id),
    );
  if (jobs.error) throw new Error(jobs.error.message ?? "database error");
  return {
    company: true,
    jobs: ((jobs.data ?? []) as StartedJob[])
      .map((job) => ({
        ...job,
        ...(job.company_id
          ? { company_name: rows.find((c) => c.id === job.company_id)?.name ?? null }
          : {}),
      }))
      .sort(
        (a, b) =>
          (a.company_name ?? "").localeCompare(b.company_name ?? "") ||
          a.job_number.localeCompare(b.job_number),
      ),
  };
}

export function startedWithJobsCard(jobs: StartedJob[]): CardModel {
  const one = jobs.length === 1 ? jobs[0] : null;
  const shown = jobs
    .slice(0, 5)
    .map(
      (job) =>
        `${job.job_number}${job.name ? ` · ${job.name}` : ""}${job.company_name ? ` · ${job.company_name}` : ""}`,
    );
  if (jobs.length > 5)
    shown.push(`${jobs.length - 5} more saved jobs. Ask “show my job list” for all of them.`);
  return {
    presentation: "onboarding",
    state: "result",
    show_state: false,
    title: "Pick up where you left off.",
    job: one
      ? "Your saved job is ready. Choose what to open."
      : `${jobs.length} saved jobs. Choose the job and the task.`,
    sections: [
      {
        heading: one ? "Your saved job" : "Your saved jobs",
        kind: "list",
        framed: true,
        rows: shown.map((line, index) => ({
          cells: [line],
          ...(index < 5 && isUuid(jobs[index]?.id)
            ? { href: `${PAGE_ORIGIN}${jobHomePath(jobs[index].id!)}` }
            : {}),
        })),
      },
      choices(["See what needs attention", "Open a job dashboard", "Bring in project documents"]),
      list("Open a live view when you need it", [
        "Ask for the PM meeting, lookahead or field board. Athena uses the selected job's saved records; missing information stays unknown.",
      ]),
      bringExisting(),
      workingTogether(),
    ],
    next_move: one
      ? `Try “What needs attention on job ${one.job_number}?”`
      : "Name a saved job and ask what needs attention, or show the full job list.",
  };
}

export type OnboardingFocus = "overview" | "documents" | "cost_codes";
export function sourceGuidanceCard(
  focus: Exclude<OnboardingFocus, "overview">,
  found: { company: boolean; jobs: StartedJob[] },
): CardModel {
  const codes = focus === "cost_codes";
  return {
    presentation: "onboarding",
    state: "result",
    show_state: false,
    title: codes ? "Start with your own cost codes." : "Bring the work you already have.",
    job:
      found.jobs.length === 1
        ? `For job ${found.jobs[0].job_number} · ${found.jobs[0].name ?? "Saved job"}`
        : "Use the same saved job as you add information.",
    sections: [
      list(
        codes ? "Your existing list" : "Supply a document",
        [codes ? COST_CODE_ROUTE : DOCUMENT_ROUTE],
        true,
      ),
      list("Choose an available route", [CONNECTOR_ROUTE]),
      list("Already supplied it?", [
        codes
          ? "Name the code list already available in this chat and the job you want to review. Keep your existing codes and descriptions; add missing information when you have it."
          : "Name the file and the job, and say what you want extracted or reviewed. Athena can list, read or search saved contracts and specifications before asking for another upload. Unread information stays unknown.",
      ]),
      list("Not ready yet?", [
        "You can start or resume a job without every file or code. Add them when available; keep the gaps visible.",
      ]),
      list("One useful question", [codes ? COST_CODE_ASK : DOCUMENT_ASK]),
    ],
    next_move: codes
      ? "Tell me whether you have a code list and where it lives."
      : "Tell me the job and where the files live, or name the file you already supplied.",
  };
}

export async function branchGettingStarted<T>(
  sb: MemberDb,
  morning: (jobNumber?: string) => Promise<T>,
  setup: (company: boolean) => T,
): Promise<T> {
  const found = await memberJobs(sb);
  void morning; // Getting started never starts a meeting as a side effect.
  return found.jobs.length ? (startedWithJobsCard(found.jobs) as T) : setup(found.company);
}
export function renderGettingStarted(card: CardModel = gettingStartedCard()): string {
  return `${plainGettingStarted(card)}\n\n${htmlBlock(renderHtml(card))}`;
}

type TextBlock = { type: string; text?: string };
type TextRes = { content?: TextBlock[]; structuredContent?: Record<string, unknown> };
type Rpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};
export async function claimGettingStarted(sb: Rpc): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("mcp_getting_started_claim");
    return (
      !error && !!data && typeof data === "object" && (data as { show?: boolean }).show === true
    );
  } catch {
    return false;
  }
}
export async function attachGettingStarted<R>(
  sb: Rpc,
  result: R,
  opts?: { prepend?: boolean },
): Promise<R> {
  const res = result as unknown as TextRes;
  const first = res?.content?.find((c) => c.type === "text" && typeof c.text === "string");
  if (!first?.text || "getting_started" in (res.structuredContent ?? {})) return result;
  // Explicit onboarding already contains the complete contextual card.
  if ((res.structuredContent?.card as CardModel | undefined)?.presentation === "onboarding")
    return result;
  if (!(await claimGettingStarted(sb))) return result;
  const card = gettingStartedCard();
  const sc = res.structuredContent ?? {};
  const prior = Array.isArray(sc.assistant_guidance) ? (sc.assistant_guidance as string[]) : [];
  return {
    ...res,
    content:
      opts?.prepend === false
        ? res.content
        : res.content!.map((c) =>
            c === first ? { ...c, text: `${renderGettingStarted(card)}\n\n${first.text}` } : c,
          ),
    structuredContent: {
      ...sc,
      getting_started: card,
      assistant_guidance: [...prior, GETTING_STARTED_GUIDANCE],
    },
  } as R;
}
