/** Router search parsing decodes ?upload=1 to numeric 1; keep the existing upload intent. */
export function submittalRecordSearch(search: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") out[key] = value;
    else if (key === "upload" && value === 1) out.upload = "1";
  }
  return out;
}
