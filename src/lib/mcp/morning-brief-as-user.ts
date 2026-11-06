// Reads one member's morning brief on the server, for the daily email, without their sign-in.
// Every database function goes through mcp_brief_as_user, which runs it as that member, so job scope and
// money rules are the member's own. That SQL function only runs the few read functions the brief uses.
// Table reads are limited to the ones the brief makes, and the brief code filters each one by a job id from the
// member's own feed or by the member's own user id.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sb } from "./guard";
import type { BriefDoc } from "./morning-brief-pm";
import { briefJobsFromFeed, composePmBrief } from "./morning-brief-load";
import { briefSettingsFrom } from "./morning-brief";

export const BRIEF_AS_USER_TABLES = new Set(["mcp_jobs", "mcp_job_facts", "mcp_daily_reports", "mcp_submittals", "mcp_company_members"]);

export function briefClientAs(admin: SupabaseClient, userId: string): Sb {
  const client = {
    rpc(fn: string, args?: Record<string, unknown>) {
      return admin.rpc("mcp_brief_as_user", { _user: userId, _fn: fn, _args: args ?? {} });
    },
    from(table: string) {
      if (!BRIEF_AS_USER_TABLES.has(table)) throw new Error(`The morning brief email does not read ${table}.`);
      return admin.from(table);
    },
    auth: {
      getUser: async () => ({ data: { user: { id: userId } }, error: null }),
    },
  };
  return client as unknown as Sb;
}

/** The member's brief, or null when they have no jobs. */
export async function composeBriefFor(
  admin: SupabaseClient,
  userId: string,
  settings: { send_local: string; time_zone: string },
  now = new Date(),
): Promise<BriefDoc | null> {
  const feed = await admin.rpc("mcp_morning_brief_feed_for", { _user: userId });
  if (feed.error) throw new Error("Could not read the morning brief.");
  const jobs = briefJobsFromFeed((Array.isArray(feed.data) ? feed.data : []) as Parameters<typeof briefJobsFromFeed>[0]);
  if (!jobs.length) return null;
  const built = await composePmBrief(briefClientAs(admin, userId), {
    now,
    settings: briefSettingsFrom({ enabled: true, ...settings }),
    preloaded: { hasCompany: true, jobs },
    notices: false,
  });
  return built.doc;
}
