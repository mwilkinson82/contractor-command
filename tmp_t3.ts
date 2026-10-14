import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { activeNa, itemLine, ITEM_COLS, renderSetupReport, resolveJob } from "@/lib/mcp/jobs";
const s = JSON.parse(readFileSync(process.env.HOME + "/.cache/lovable-auth/session.json", "utf8"));
const env = Object.fromEntries(readFileSync(".env", "utf8").split("\n").filter(Boolean).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const sb: any = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { global: { headers: { Authorization: `Bearer ${s.session.access_token}` } }, auth: { persistSession: false } });
const CO = "cbd6fce1-3b52-409c-9317-42019cad936e";
const step = process.argv[2];
const rpc = async (fn: string, a: any) => { const r = await sb.rpc(fn, a); return r.error ? `ERROR: ${r.error.message}` : r.data; };
const job = await resolveJob(sb, "2417", CO);
const find = async (tag: string) => (await sb.from("mcp_open_items").select("id,status,resolution").eq("job_id", job.job_id).ilike("action", `%${tag}%`)).data;
if (step === "1") {
  const base = { section: "owner_disruptions", category: "Owner Disruptions", kind: "general", severity: "high", accountable: "Dana PM", needed_by: "2026-10-16", source: "member_answer", tool: "intake",
    detail: "No notice sent yet.", cost_effect: "INTERNAL: est. $18k crew standby", time_effect: "3 days", cash_effect: "INTERNAL: delays Nov pay app", next_action: "INTERNAL STRATEGY: hold notice until owner confirms new date" };
  for (const [ck, act] of [["test:od:notice", "Delay notice: utility shutdown denied (due Oct 16)"], ["test:od:copyA", "Delay notice: utility shutdown denied (due Oct 16) [TEST COPY A]"], ["test:od:copyB", "Delay notice: utility shutdown denied (due Oct 16) [TEST COPY B]"]])
    console.log("add", JSON.stringify(await rpc("mcp_add_item", { _job: job.job_id, _f: { ...base, check_key: ck, action: act } })));
  console.log("\nWHEN mark_na:", JSON.stringify(await rpc("mcp_mark_na", { _job: job.job_id, _scope: "section", _target: "owner_disruptions", _reason: "owner handles shutdowns" })));
  const nc: any = await rpc("mcp_next_check", { _job: job.job_id });
  console.log("\nTHEN-1 next_question:", JSON.stringify(nc && { key: nc.key, label: nc.label, section: nc.section }));
  const nas = await activeNa(sb, job.job_id);
  const { data } = await sb.from("mcp_open_items").select(ITEM_COLS).eq("job_id", job.job_id).eq("status", "open").order("needed_by", { nullsFirst: false }).limit(200);
  console.log(`\nTHEN-2/3 list_open_items (filtered to this item):\n${data.filter((i: any) => i.section === "owner_disruptions").map((i: any) => "- " + itemLine(i, nas)).join("\n")}`);
  console.log(`\nTHEN-3 due-date sweep (open, needed by <= 2026-10-16):\n${data.filter((i: any) => i.needed_by && i.needed_by <= "2026-10-16").map((i: any) => `- ${i.needed_by}: ${i.action}`).join("\n")}`);
  for (const aud of ["internal", "client"] as const) {
    const r = await renderSetupReport(sb, job, aud);
    console.log(`\nTHEN-4 report ${aud} (relevant lines):\n` + r.split("\n").filter((l) => /utility shutdown|N\/A — needs|Data through|INTERNAL/i.test(l)).join("\n"));
  }
  const [orig] = (await find("due Oct 16)")).filter((x: any) => true);
  const o = (await sb.from("mcp_open_items").select("id").eq("job_id", job.job_id).eq("check_key", "test:od:notice").single()).data.id;
  console.log("\nTHEN-5 resolve na:", await rpc("mcp_resolve_item", { _item: o, _kind: "na", _evidence: null, _stated_by: null, _stated_on: null, _reason: null, _approval: null, _billing: null, _collection: null }));
  console.log("THEN-5 resolve verified without evidence:", await rpc("mcp_resolve_item", { _item: o, _kind: "verified", _evidence: null, _stated_by: null, _stated_on: null, _reason: null, _approval: null, _billing: null, _collection: null }));
  console.log("THEN-5 waive by PM (no decision right):", await rpc("mcp_resolve_item", { _item: o, _kind: "waive", _evidence: null, _stated_by: null, _stated_on: null, _reason: "owner handles shutdowns", _approval: null, _billing: null, _collection: null }));
  const a = (await sb.from("mcp_open_items").select("id").eq("job_id", job.job_id).eq("check_key", "test:od:copyA").single()).data.id;
  console.log("THEN-5 copy A verified with sent notice:", JSON.stringify(await rpc("mcp_resolve_item", { _item: a, _kind: "verified", _evidence: "Delay notice sent 2026-10-15 by certified mail to owner's rep per §8.3 (TEST)", _stated_by: null, _stated_on: null, _reason: null, _approval: null, _billing: null, _collection: null })));
}
if (step === "2") {
  const b = (await sb.from("mcp_open_items").select("id").eq("job_id", job.job_id).eq("check_key", "test:od:copyB").single()).data.id;
  console.log("THEN-5 copy B waived by owner:", JSON.stringify(await rpc("mcp_resolve_item", { _item: b, _kind: "waive", _evidence: null, _stated_by: null, _stated_on: null, _reason: "Owner decision: owner handles shutdowns and gave written relief (TEST)", _approval: null, _billing: null, _collection: null })));
  const { data } = await sb.from("mcp_open_items").select("check_key,status,resolution").eq("job_id", job.job_id).like("check_key", "test:od:%");
  console.log("end state:", JSON.stringify(data));
  const ev = await sb.from("mcp_item_events").select("event,note").in("item_id", (await sb.from("mcp_open_items").select("id").like("check_key", "test:od:copyB")).data.map((x: any) => x.id));
  console.log("copy B events:", JSON.stringify(ev.data));
}
if (step === "3") {
  console.log("finance resolve 2417-R:", JSON.stringify(await rpc("mcp_resolve_job", { _company: CO, _job_number: "2417-R" })));
  console.log("finance reads restricted job rows:", JSON.stringify((await sb.from("mcp_jobs").select("job_number,restricted").eq("job_number", "2417-R")).data));
}
