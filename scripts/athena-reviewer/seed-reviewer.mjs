#!/usr/bin/env node
/**
 * Athena reviewer demo account + sample data (OpenAI plugin review).
 *
 * NOT a migration and NOT run by any build or deploy. Run by hand, once, only after Marshall approves:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ATHENA_REVIEWER_PASSWORD=... \
 *     node scripts/athena-reviewer/seed-reviewer.mjs [--dry-run]
 * The password lives only in the env var / secret manager; it is never written to the repo or logs.
 * Idempotent: re-running reuses the user, company and job.
 */
import { createClient } from "@supabase/supabase-js";

export const REVIEWER_EMAIL = "athena-review@alpcontractorcircle.com"; // must match src/lib/mcp/allowlist.ts
const COMPANY = "ALP Construction (Demo)";
const JOB = { job_number: "2601", name: "Riverside Medical Office – Electrical (Demo)", pm_name: "Sam Ortiz", pm_email: "sam.ortiz@example.com", pm_title: "Project Manager", time_zone: "America/New_York" };

const dry = process.argv.includes("--dry-run");
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ATHENA_REVIEWER_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
if (!dry && (!ATHENA_REVIEWER_PASSWORD || ATHENA_REVIEWER_PASSWORD.length < 16)) throw new Error("Set ATHENA_REVIEWER_PASSWORD (16+ chars) from the secret store.");

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const log = (...a) => console.log(dry ? "[dry-run]" : "", ...a);

async function findUser(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => x.email?.toLowerCase() === email);
    if (u || data.users.length < 200) return u ?? null;
  }
  return null;
}

let user = await findUser(REVIEWER_EMAIL);
if (!user) {
  log("create auth user", REVIEWER_EMAIL, "(email pre-confirmed, password sign-in, no MFA)");
  if (!dry) {
    const { data, error } = await sb.auth.admin.createUser({ email: REVIEWER_EMAIL, password: ATHENA_REVIEWER_PASSWORD, email_confirm: true, user_metadata: { full_name: "Athena Reviewer" } });
    if (error) throw error;
    user = data.user;
  }
} else log("auth user exists", user.id);
const uid = user?.id ?? "00000000-0000-0000-0000-000000000000";

let { data: co } = await sb.from("mcp_companies").select("id").eq("name", COMPANY).eq("created_by", uid).maybeSingle();
if (!co) {
  log("create company", COMPANY, "(is_test=true)");
  if (!dry) ({ data: co } = await sb.from("mcp_companies").insert({ name: COMPANY, agent_name: "Athena", company_role: "subcontractor", trades: ["electrical"], is_test: true, created_by: uid }).select("id").single());
}
const coId = co?.id ?? "(new)";
log("owner membership", uid, "->", coId);
if (!dry) {
  const { error } = await sb.from("mcp_company_members").upsert({ company_id: coId, user_id: uid, display_name: "Athena Reviewer", role: "owner" }, { onConflict: "company_id,user_id", ignoreDuplicates: true });
  if (error) throw error;
}
let { data: job } = dry ? { data: null } : await sb.from("mcp_jobs").select("id").eq("company_id", coId).eq("job_number", JOB.job_number).maybeSingle();
if (!job) {
  log("create job", JOB.job_number, JOB.name, "PM", JOB.pm_name);
  if (!dry) {
    const { error } = await sb.from("mcp_jobs").insert({ ...JOB, company_id: coId, user_id: uid });
    if (error) throw error;
  }
}
log("done. The reviewer pastes sample-subcontract.md in test case 1; intake builds the rest.");
