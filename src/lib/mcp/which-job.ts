/** The which-job card asks a question that matches the tool the member just called. */

export const WHICH_JOB_ASK = {
  list_open_items: "Which job should I list open items for?",
  pm_meeting: "Which job's project meeting?",
  pm_morning: "Which job's morning hitlist?",
  athena_morning_hitlist: "Which job's morning hitlist?",
  pm_evening: "Which job's evening wrap-up?",
  submittal_log: "Which job should I log this submittal on?",
  submittals_list: "Which job's submittal log?",
  submittals_import: "Which job should I import this submittal log onto?",
  project_record_search: "Which job's project record?",
} as const;

export type WhichJobTool = keyof typeof WHICH_JOB_ASK;

export function whichJobAsk(tool: string): string {
  return tool in WHICH_JOB_ASK ? WHICH_JOB_ASK[tool as WhichJobTool] : WHICH_JOB_ASK.list_open_items;
}

export function isWhichJobText(text: string): boolean {
  if (/No job named/i.test(text)) return true;
  return Object.values(WHICH_JOB_ASK).some((q) => text.includes(q));
}
