import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  renderReportBody,
  renderReportDocument,
  reportGoneHtml,
  type PagePayload,
} from "./report-pages";
import { renderSubmittalRecordBody, type SubmittalRecordPayload } from "./submittal-record-page";
import { renderHtml } from "./mcp/cards/html";

import { fileUploadCardHtml } from "./mcp/cards/file-upload-card";
import { drawingCardHtml } from "./mcp/cards/drawing-card";
import { takeoffCardHtml } from "./mcp/cards/takeoff-card";
import { uploadPage } from "./mcp/file-upload";
import { goneHtml } from "./mcp/file-share";

const long = "Synthetic reference " + "LONGREFERENCE".repeat(16);
const common = { company: long, job_number: "SYN-001", job_name: long };
const today = "2026-11-01";
const report = {
  found: true,
  scope: "full",
  version: 4,
  data_date: today,
  updated_by_name: long,
  contract_total: 9000000000000,
  data: {
    activities: [
      {
        id: "SYN-A1",
        name: long,
        start: "2026-11-02",
        finish: "2026-11-12",
        duration: 8,
        total_float: 0,
        critical: true,
        pct_complete: 25,
      },
    ],
    billing: {
      billed_to_date: 1234567890.12,
      payments_received: 1234567.89,
      months: [{ month: "2026-11", amount: 2345678901.12, kind: "forecast" }],
    },
    totals: { direct_cost: 9000000000000 },
    e_holds: [
      {
        description: long,
        amount: 1234567890.12,
        cost_code: "26.0100",
        status: "Open",
        owner: long,
      },
    ],
  },
};
const submittal: SubmittalRecordPayload = {
  ...common,
  page: "submittal",
  number: "SYN-001",
  today,
  current: {
    id: "synthetic-submittal",
    number: "SYN-001",
    revision: 1,
    transmittal_number: 1,
    spec_section: "26 24 16",
    submittal_type: "shop_drawing",
    title: long,
    status: "submitted",
    ball_in_court: "architect_engineer",
    ball_in_court_name: long,
    package_items: [
      {
        id: "synthetic-piece",
        kind: "shop_drawing",
        status: "received",
        required: true,
        source_party: long,
        file_ref: null,
        chase_name: long,
        chase_email: "synthetic-long-reference-for-viewport@example.invalid",
      },
    ],
  },
  packages: [
    {
      id: "synthetic-package",
      submittal_id: "synthetic-submittal",
      revision: 1,
      filename: long + ".pdf",
      path: "synthetic",
      created_at: today,
    },
  ],
  events: [
    {
      id: "synthetic-event",
      occurred_at: today,
      actor: "synthetic",
      kind: "note",
      title: long,
      summary: long,
    },
  ],
};
const payloads: Record<string, PagePayload> = {
  ior: { ...common, page: "ior", report },
  schedule: { ...common, page: "schedule", report },
  lookahead: {
    ...common,
    page: "lookahead",
    report,
    today,
    lookahead: { id: "synthetic", start_date: today, end_date: "2026-11-14" },
    items: [{ id: "synthetic", action: long, owner: long, due: "2026-11-03", type: "inspection" }],
  },
  payapp: { ...common, page: "payapp", report },
  briefing: {
    ...common,
    page: "briefing",
    today,
    items: [{ action: long, owner: long, due: "2026-11-02" }],
  },
  portfolio: {
    page: "portfolio",
    company: long,
    money: true,
    jobs: [
      {
        job_id: "synthetic",
        job_number: "SYN-001",
        name: long,
        pm: long,
        cpm: { version: 3, contract_total: 9000000000000 },
      },
    ],
  },
  field: {
    ...common,
    page: "field",
    scope: "full",
    today,
    activities: report.data.activities,
    assignments: [],
    materials: [],
    items: [{ id: "synthetic", action: long, owner: long, due: today }],
  },
  daily: {
    ...common,
    page: "daily",
    found: true,
    report_date: today,
    weather: long,
    manpower: long,
    issues: long,
    lines: [{ work: long, qty: 123456.5, unit: "linear feet", crew: 8, hours: 40 }],
  },
  photos: {
    ...common,
    page: "photos",
    photos: [
      {
        id: "synthetic",
        taken_on: today,
        area: long,
        work: long,
        url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'%3E%3Crect width='800' height='600' fill='%23e5e7eb'/%3E%3C/svg%3E",
      },
    ],
  },
  items: {
    ...common,
    page: "items",
    items: [{ id: "synthetic", action: long, owner: long, next_action: long, due: today }],
  },
  submittals: { ...common, page: "submittals", today, submittals: [submittal.current] },
};
const docs: Record<string, string> = Object.fromEntries(
  Object.entries(payloads).map(([name, p]) => [name, renderReportDocument(p)]),
);
const document = (body: string) =>
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">${body}</body></html>`;
docs["submittal-detail"] = document(renderSubmittalRecordBody(submittal));
for (const purpose of ["rfi", "rfc"] as const)
  docs[purpose + "-detail"] = document(
    renderSubmittalRecordBody({
      ...submittal,
      current: {
        ...submittal.current,
        package_purpose: purpose,
        request_details: {
          condition: long,
          question: long,
          references: [{ kind: "drawing", citation: long }],
          recipient_name: long,
          due_date: today,
        },
      },
    }),
  );
docs["change-detail"] = document(
  renderSubmittalRecordBody({
    ...submittal,
    current: {
      ...submittal.current,
      package_purpose: "change_order",
      change_order_details: {
        state: "priced",
        record_version: 1,
        origin: "contractor",
        condition: long,
        scope: long,
        references: [],
        lines: [
          { category: "material", description: long, source: long, amount_cents: 123456789012 },
        ],
        total_cents: 123456789012,
      },
    },
  }),
);
docs["shared-ior"] = renderReportDocument({
  ...common,
  page: "ior",
  report,
  shared: true,
  expires_at: "2100-01-01T00:00:00Z",
});
docs["shared-unavailable"] = reportGoneHtml();
docs["native-card"] = renderHtml({
  state: "result",
  title: long,
  job: long,
  kpis: [{ label: "Contract", value: "$9,000,000,000,000.00" }],
  sections: [
    {
      heading: "Scope",
      kind: "table",
      columns: ["Description", "Quantity", "Amount"],
      rows: [{ cells: [long, "1234567.50", "$9,000,000,000,000.00"] }],
    },
  ],
});
docs["native-wide-card"] = renderHtml({
  state: "result",
  title: "Synthetic financial continuation",
  sections: [
    {
      heading: "All columns",
      kind: "table",
      scroll: true,
      columns: ["Description", "Quantity", "Amount", "History"],
      rows: [{ cells: [long, "1234567.50", "$9,000,000,000,000.00", long] }],
    },
  ],
});

// Minimal synthetic host: initialization/result delivery only. No backend or tool execution.
const host = (html: string, structuredContent: unknown, meta?: unknown) =>
  html.replace(
    "<head>",
    `<head><script>
window.addEventListener("message", event => {
 const m = event.data;
 if (m && m.method === "tools/call") {
  const args = m.params && m.params.arguments;
  window.__syntheticToolCalls = (window.__syntheticToolCalls || []).concat(m.params);
  const fixture = ${JSON.stringify(structuredContent).replaceAll("<", "\\u003c")};
  if (m.params.name !== "file_upload" || args.action !== "resume" || !fixture.upload_context) throw Error("Fixture permits only the selected upload's synthetic resume read");
  window.postMessage({jsonrpc:"2.0",id:m.id,result:{structuredContent:{upload_context:fixture.upload_context}}},"*");
 }
 if (m && m.method === "ui/initialize") {
  window.postMessage({jsonrpc:"2.0",id:1,result:{hostCapabilities:{serverTools:{}},hostContext:{availableDisplayModes:["inline"]}}},"*");
  setTimeout(() => window.postMessage({jsonrpc:"2.0",method:"ui/notifications/tool-result",params:${JSON.stringify({ structuredContent, _meta: meta, content: [{ type: "image", mimeType: "image/png", data: png }] }).replaceAll("<", "\\u003c")}},"*"),0);
 }
});</script>`,
  );
const syntheticId = "00000000-0000-4000-8000-000000000001";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAMgAAACWCAIAAAAUvlBOAAABmElEQVR4nO3SQQkAIADAQPv3FB+WsIRDkIMLsMfGXBuuG88L+JKxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIvEAWkxN/Nz9BHAAAAAAElFTkSuQmCC";
const image = "data:image/png;base64," + png;
docs["file-upload-card"] = host(fileUploadCardHtml(), {
  upload_context: {
    company_id: syntheticId,
    job_number: "SYN-001",
    upload_id: syntheticId,
    filename: long + ".pdf",
    purpose: "spec",
    upload_url: "https://app.meetathena.io/r/file-upload/" + "x".repeat(43),
    expires_at: "2100-01-01T00:00:00Z",
  },
});
docs["file-upload-list"] = host(fileUploadCardHtml(), {
  company_id: syntheticId,
  job_number: "SYN-001",
  upload_recovery_view: true,
  documents: [{ id: syntheticId, filename: long + ".pdf", kind: "spec" }],
  pending_uploads: [
    {
      upload_id: syntheticId,
      filename: long + ".pdf",
      bytes_received: true,
      received_via: "object",
      expired: false,
    },
  ],
});
docs["drawing-card"] = host(drawingCardHtml("https://synthetic.invalid"), {
  source: { id: "synthetic", company_id: syntheticId, job_id: syntheticId },
  card: {
    title: long,
    job: long,
    kpis: [{ label: "Markup version", value: "2" }],
    sections: [{ heading: "Drawing record", rows: [{ cells: [long] }] }],
  },
});
const line = {
  id: "synthetic-line",
  line_no: 1,
  item: long,
  unit: "EA",
  qty: 1234,
  status: "unlocated",
};
const engine = {
  lines: [line],
  summary: { lines: [line] },
  geometry: [],
  calibrations: [],
  passes: [],
  exports: [],
  gaps: [],
};
const takeoff = {
  space: { width: 800, height: 600, unit: "px" },
  context: {
    company_id: syntheticId,
    job_id: syntheticId,
    job_number: "SYN-001",
    source_id: "synthetic-source",
    sheet: "SYN-1",
  },
  card: { title: long, job: long, kpis: [{ label: "Lines", value: "1" }], sections: [] },
  engine,
  available_sources: [
    { id: "synthetic-source", filename: long + ".pdf", revision: 1, sheets: ["SYN-1"] },
  ],
};
docs["takeoff-selection"] = host(takeoffCardHtml(), takeoff);
docs["takeoff-sheet"] = host(
  takeoffCardHtml(),
  {
    ...takeoff,
    source: {
      id: "synthetic-source",
      filename: long + ".pdf",
      page: 1,
      sheet: "SYN-1",
      revision: 1,
      content_hash: "synthetic",
    },
  },
  { "athena/takeoffView": { preview: image } },
);
docs["upload-entry"] = uploadPage({
  filename: long + ".pdf",
  purpose: "Specification",
  until: "12:00 PM",
});
docs["upload-received"] = uploadPage({
  filename: long + ".pdf",
  purpose: "Specification",
  until: "12:00 PM",
  done: true,
});
docs["file-unavailable"] = goneHtml();

if (process.env.ATHENA_RESPONSIVE_ARTIFACTS) {
  mkdirSync(process.env.ATHENA_RESPONSIVE_ARTIFACTS, { recursive: true });
  for (const [name, html] of Object.entries(docs))
    writeFileSync(join(process.env.ATHENA_RESPONSIVE_ARTIFACTS, `${name}.html`), html);
  writeFileSync(
    join(process.env.ATHENA_RESPONSIVE_ARTIFACTS, "cases.json"),
    JSON.stringify(Object.keys(docs)),
  );
}

describe("responsive generated report sources", () => {
  it.each(Object.keys(payloads))(
    "keeps %s in the same scoped surface for signed-in and shared rendering",
    (name) => {
      const body = renderReportBody(payloads[name]);
      expect(body).toContain('class="ath-report-surface"');
      expect(docs[name]).toContain(body);
      expect(body).toContain("SYN-001");
      expect(body).not.toContain("overflow-x:hidden");
    },
  );
  it("retains full amounts and focusable local table scroll regions", () => {
    expect(docs.ior).toContain("$1,234,567,890.12");
    expect(docs.ior).toContain('aria-label="IOR detail table" tabindex="0"');
    expect(docs.payapp).toContain('aria-label="Monthly billing" tabindex="0"');
    expect(docs.lookahead).toContain('aria-label="Lookahead calendar" tabindex="0"');
    expect(docs.schedule).toContain('aria-label="Schedule table and timeline"');
    expect(docs["submittal-detail"]).toContain(long + ".pdf");
  });
});
