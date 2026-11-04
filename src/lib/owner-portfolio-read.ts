import { supabase } from "@/integrations/supabase/client";
import { accountingIO, readAccountingReport } from "@/lib/accounting-report-read";
import { jobMoneyFromReport, type JobMoneyRead } from "@/lib/owner-portfolio";

/** Money reads refresh every five minutes while the page is on screen. */
export const PORTFOLIO_MONEY_REFRESH_MS = 300_000;

/** Reads each job's accounting with the signed-in member's own client. A job that can't be read is reported, not zeroed. */
export async function readPortfolioMoney(
  jobIds: string[],
  asOf: string,
): Promise<Record<string, JobMoneyRead>> {
  const io = accountingIO(supabase);
  const entries = await Promise.all(
    jobIds.map(async (id): Promise<[string, JobMoneyRead]> => {
      try {
        return [
          id,
          { ok: true, money: jobMoneyFromReport(await readAccountingReport(io, id, { asOf })) },
        ];
      } catch (e) {
        return [
          id,
          {
            ok: false,
            reason: e instanceof Error ? e.message : "The job's records could not be read.",
          },
        ];
      }
    }),
  );
  return Object.fromEntries(entries);
}
