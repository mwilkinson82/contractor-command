// Builds card results from Athena's real renderers and job 2701 fixture data (fictional, no backend calls),
// then writes one host page per card that loads ui://athena/native-card.html the way an MCP Apps host does.
// Run through scripts/card-screenshots/run.sh.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import clauses2701 from "../../src/lib/mcp/__fixtures__/job-2701-clauses.json";
import { attachAthenaCard } from "../../src/lib/mcp/cards/attach";
import { claudeCardReply } from "../../src/lib/mcp/cards/claude-reply";
import { nativeCardHtml } from "../../src/lib/mcp/cards/native";
import { emailCardHtml } from "../../src/lib/mcp/cards/email-card";
import { draftKey } from "../../src/lib/mcp/email-safety";
import { clauseLine, missingNotices, missingNoticeNote, SUMMARY_OFFER } from "../../src/lib/mcp/contract-clauses";
import { contractValueLine } from "../../src/lib/mcp/contract-value";
import { presentBrief } from "../../src/lib/mcp/morning-brief";
import { job2701BriefCard } from "../../src/lib/mcp/morning-brief-2701";
import { buildSov, money, sovLineRows, sovSummaryText } from "../../src/lib/mcp/sov";
import { contractTermsCard, sovCard } from "../../src/lib/mcp/cards/structured";
import type { ClauseRow } from "../../src/lib/mcp/contract-clauses";
import { HOST_DISPLAY_BLOCK } from "../../src/lib/mcp/visible";

type Result = Record<string, unknown>;
const out = process.argv[2] ?? "artifacts/card-screenshots";
const JOB = "2701 – Harbor Point Medical Office Building – Electrical";
const BRAND = { company_name: "ALP Construction", logo_url: null, license_number: null, contact_name: null, contact_phone: null, website: null };

// Same ten lines as sov.test.ts: Exhibit B lump sum that ties to $1,400,000.00.
const SOV_2701 = [
  ["26.01", "Mobilization, bonds and general conditions", 70000], ["26.02", "Submittals and engineering", 20000],
  ["26.03", "Service entrance and switchgear", 210000], ["26.04", "Emergency generator and transfer switches", 180000],
  ["26.05", "Panelboards, transformers and feeders", 185000], ["26.06", "Branch circuit rough-in and devices", 255000],
  ["26.07", "Lighting fixtures and controls", 205000], ["26.08", "Site lighting, testing and closeout", 70000],
  ["27.01", "Low-voltage pathways", 90000], ["28.01", "Fire alarm system", 115000],
].map(([item_no, description, scheduled_value]) => ({ item_no: item_no as string, description: description as string, scheduled_value: scheduled_value as number }));

/** The display block rides on every live result; the Claude pass must remove it. */
const withHouseStyle = (r: Result): Result => {
  const sc = (r.structuredContent ?? {}) as Result;
  const prior = Array.isArray(sc.assistant_guidance) ? sc.assistant_guidance : [];
  return { ...r, structuredContent: { ...sc, assistant_guidance: [HOST_DISPLAY_BLOCK, ...prior] } };
};

// Mirrors the contract_terms and report handlers: text from the same helpers, card from the structured rows.
function contractTerms(): Result {
  const cl = clauses2701 as ClauseRow[];
  const missing = missingNotices(cl).map((m) => `Missing: ${m.label} (${missingNoticeNote(true)})`);
  const text = [
    `${JOB}\nCONTRACT CLAUSES (exact contract text)`,
    contractValueLine(1400000, "SOV", true),
    "Substantial completion: 2027-06-30",
    ...cl.map((c) => `- ${clauseLine(c)}`),
    ...missing.map((m) => `- ${m}`),
    "",
    SUMMARY_OFFER,
  ].join("\n");
  const card = contractTermsCard({
    job: JOB,
    clauses: cl,
    valueDisplay: contractValueLine(1400000, "SOV", true),
    completion: "2027-06-30",
    missing,
    flags: [{ flag: "has_retainage", value: "ON" }, { flag: "has_lds", value: "ON" }, { flag: "beneficial_use", value: "OFF" }, { flag: "notice_requirements", value: "ON" }],
    askSummary: true,
    boardLinks: [],
  });
  return attachAthenaCard("contract_terms", { content: [{ type: "text", text }], structuredContent: { card } });
}

function sovReport(): Result {
  const sov = buildSov(SOV_2701, 0, null);
  const text = sovSummaryText(`2701 – `, sov, BRAND, "Exhibit B", [], "internal", "lines");
  const card = sovCard({
    job: JOB,
    rows: sovLineRows(sov),
    divisions: sov.summary.divisions.map((d) => ({ division: d.division, title: d.title, scheduled_value_display: money(d.scheduled_value), pct_of_contract: d.pct_of_contract })),
    fee: null,
    totalDisplay: money(sov.summary.contract_total),
    basis: "Exhibit B",
    audience: "internal",
    view: "lines",
  });
  return attachAthenaCard("report", { content: [{ type: "text", text }], structuredContent: { card, sov: { line_items: sovLineRows(sov) } } });
}

function morningBrief(): Result {
  return attachAthenaCard("morning_brief", presentBrief(job2701BriefCard("pm").card) as Result);
}

/** Minimal MCP Apps host: answers ui/initialize, sends the tool result, sizes the frame. */
/** Minimal MCP Apps host: answers ui/initialize, sends the tool result, sizes the frame. For the email card it
 *  also answers tools/call and ui/message like a host that supports both, and records every message the view sent
 *  in window.__hostLog so the screenshot run can print the approve sequence. */
function hostPage(title: string, result: Result, viewHtml = nativeCardHtml(), interactive = false): string {
  // Escape "<" so the view's own </script> cannot close this page's script.
  const view = JSON.stringify(viewHtml).replace(/</g, "\\u003c");
  const params = JSON.stringify(result).replace(/</g, "\\u003c");
  const caps = interactive ? '{serverTools:{},message:{}}' : "{}";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;padding:24px;background:#F3F4F6;font:14px system-ui}iframe{display:block;width:100%;border:0;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08)}@media (max-width:480px){body{padding:12px}}</style></head>
<body${interactive ? ' data-interact="send"' : ""}><iframe id="card" sandbox="allow-scripts"></iframe><script>
var frame=document.getElementById("card"), result=${params}; window.__hostLog=[];
function reply(id,res){frame.contentWindow.postMessage({jsonrpc:"2.0",id:id,result:res},"*")}
window.addEventListener("message",function(e){
  if(e.source!==frame.contentWindow)return; var m=e.data||{}; window.__hostLog.push(m);
  if(m.method==="ui/initialize")reply(m.id,{protocolVersion:"2026-01-26",hostInfo:{name:"athena-screenshot-host",version:"1"},hostCapabilities:${caps},hostContext:{theme:"light",displayMode:"inline"}});
  else if(m.method==="ui/notifications/initialized")frame.contentWindow.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:result},"*");
  else if(m.method==="ui/notifications/size-changed"){frame.style.height=m.params.height+"px";document.body.dataset.ready="1"}
  else if(m.method==="tools/call")setTimeout(function(){reply(m.id,{content:[{type:"text",text:"ok"}],structuredContent:{draft_key:"D0FIXTURE",delivery_id:"11111111-1111-4111-8111-111111111111",send_confirmed:true}})},400);
  else if(m.method==="ui/message")reply(m.id,{});
});
frame.srcdoc=${view};
</script></body></html>`;
}

// Fictional submittal chase email on job 2701: what email_draft returns, signed as the job's PM.
function emailDraft(): Result {
  const draft = {
    to: "dana.ortiz@example-electrical.test",
    cc: ["pm@example-alp.test"],
    subject: "Submittal 26 24 16-001 rev 1 – switchgear product data due 2026-10-31",
    body: "Hi Dana,\n\nThe switchgear product data (submittal 26 24 16-001, rev 1) is due back to us by Friday 2026-10-31 under §5.1. We need it to hold the 2026-11-19 underground inspection.\n\nPlease send the stamped set to this address, or tell me today if the date is at risk.\n\nThanks,\nElena Brooks\nProject Manager\nALP Construction",
    link: "https://app.meetathena.io/f/9hqX2yLw3T0dM8sVbA1cRfEuZp7kNjG4oWiH5tQyBe0",
    attachment: null,
  };
  return {
    content: [{ type: "text", text: `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}` }],
    structuredContent: { draft, signature: "Elena Brooks, Project Manager, ALP Construction", draft_key: draftKey({ ...draft, cc: draft.cc, link: draft.link, attachment: null }), sent: false, requires_confirm: true, send_allowed: true, job_number: "2701", company_id: "ALP Construction" },
  };
}

mkdirSync(out, { recursive: true });
const cards: [string, Result][] = [
  ["contract-terms", contractTerms()],
  ["sov", sovReport()],
  ["morning-brief", morningBrief()],
];
writeFileSync(join(out, "email-draft.host.html"), hostPage("email-draft", emailDraft(), emailCardHtml(), true));
console.log("email-draft");
for (const [name, raw] of cards) {
  const result = withHouseStyle(raw);
  const claude = claudeCardReply(result) ?? result;
  writeFileSync(join(out, `${name}.host.html`), hostPage(name, claude));
  // What Claude reads next to the card: review this for leftover display orders.
  const text = ((claude.content as { type: string; text?: string }[]) ?? []).map((b) => b.text ?? "").join("\n\n");
  writeFileSync(join(out, `${name}.claude.md`), `${text}\n`);
  console.log(name);
}
