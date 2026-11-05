// Account page setup checklist reads. Pure so tests can run them with fakes; the server function is in
// account-setup.functions.ts.
import type { SetupProgress } from "@/lib/account-profile";
import { readCompanyWorkProfile, readWorkProfile, workProfileDone, workQuestionsLeft } from "@/lib/mcp/work-profile";

type CountResult = PromiseLike<{ count: number | null; error: unknown }>;
type RowsResult = PromiseLike<{ data: unknown[] | null; error: unknown }>;
export type JobsReader = {
  from: (t: "mcp_jobs") => {
    select: (
      c: string,
      o: { count: "exact"; head: true },
    ) => { eq: (k: string, v: string) => CountResult };
  };
};
export type CallLogReader = {
  from: (t: "mcp_call_log") => {
    select: (c: string) => { eq: (k: string, v: string) => { limit: (n: number) => RowsResult } };
  };
};

/** Null when either read fails, so the page leaves the two steps off instead of showing a wrong state. */
export async function readSetupProgress(
  member: JobsReader,
  admin: CallLogReader,
  userId: string,
  companyId: string,
): Promise<SetupProgress | null> {
  const [jobs, calls, work] = await Promise.all([
    member
      .from("mcp_jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId),
    admin.from("mcp_call_log").select("id").eq("user_id", userId).limit(1),
    readCompanyWorkProfile(member, companyId),
  ]);
  if (jobs.error || calls.error) return null;
  const profile = readWorkProfile(work.raw);
  return {
    connected: (calls.data?.length ?? 0) > 0,
    jobs: jobs.count ?? 0,
    work: work.available ? { done: workProfileDone(profile), left: workQuestionsLeft(profile) } : null,
  };
}
