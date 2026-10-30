/** Complete text is the primary response; old cached viewers may still consume HTML. */
export const READ_RESPONSE_GUIDANCE =
  "Return the complete supplied text as ordinary Markdown in the conversation. Use standard Markdown links. Do not replace it with generated widgets, interactive tables, metric components, search controls, HTML artifacts, or host-only link tokens. The structured HTML, when present, is compatibility data for an already-open older viewer; do not open another embedded app for it. If a viewer fails, keep every source row and the complete text visible. Preserve Unknown, dates, currency and source limitations. Never invent controls, missing values, or a successful render.";

export const TEXT_READ_TOOLS = new Set([
  "jobs_list",
  "report_page_link",
  "accounting_report",
  "billing_evidence_read",
]);
