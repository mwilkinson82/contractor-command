// Builds card results from Athena's real renderers and job 2701 fixture data (fictional, no backend calls),
// then writes one host page per card that loads ui://athena/native-card.html the way an MCP Apps host does.
// Run through scripts/card-screenshots/run.sh.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import clauses2701 from "../../src/lib/mcp/__fixtures__/job-2701-clauses.json";
import { attachAthenaCard } from "../../src/lib/mcp/cards/attach";
import { claudeCardReply } from "../../src/lib/mcp/cards/claude-reply";
import { nativeCardHtml } from "../../src/lib/mcp/cards/native";
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
function hostPage(title: string, result: Result): string {
  // Escape "<" so the view's own </script> cannot close this page's script.
  const view = JSON.stringify(nativeCardHtml()).replace(/</g, "\\u003c");
  const params = JSON.stringify(result).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;padding:24px;background:#F3F4F6;font:14px system-ui}iframe{display:block;width:100%;border:0;border-radius:12px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.08)}@media (max-width:480px){body{padding:12px}}</style></head>
<body><iframe id="card" sandbox="allow-scripts"></iframe><script>
var frame=document.getElementById("card"), result=${params};
window.addEventListener("message",function(e){
  if(e.source!==frame.contentWindow)return; var m=e.data||{};
  if(m.method==="ui/initialize")frame.contentWindow.postMessage({jsonrpc:"2.0",id:m.id,result:{protocolVersion:"2026-01-26",hostInfo:{name:"athena-screenshot-host",version:"1"},hostCapabilities:{},hostContext:{theme:"light",displayMode:"inline"}}},"*");
  else if(m.method==="ui/notifications/initialized")frame.contentWindow.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:result},"*");
  else if(m.method==="ui/notifications/size-changed"){frame.style.height=m.params.height+"px";document.body.dataset.ready="1"}
});
frame.srcdoc=${view};
</script></body></html>`;
}

mkdirSync(out, { recursive: true });
const cards: [string, Result][] = [
  ["contract-terms", contractTerms()],
  ["sov", sovReport()],
  ["morning-brief", morningBrief()],
];
for (const [name, raw] of cards) {
  const result = withHouseStyle(raw);
  const claude = claudeCardReply(result) ?? result;
  writeFileSync(join(out, `${name}.host.html`), hostPage(name, claude));
  // What Claude reads next to the card: review this for leftover display orders.
  const text = ((claude.content as { type: string; text?: string }[]) ?? []).map((b) => b.text ?? "").join("\n\n");
  writeFileSync(join(out, `${name}.claude.md`), `${text}\n`);
  console.log(name);
}
