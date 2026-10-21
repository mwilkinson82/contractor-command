// Phase 7: licensed form maps. When a company holds its own license for the official AIA forms, it can map the fields of
// its licensed form to Athena's values. Athena stores ONLY the field map (field id -> value key), never the form, its
// text or its layout. Without a map Athena uses its own G702/G703-format layout with the D4 footer.
export const VALUE_KEYS = [
  "g702.l1", "g702.l2", "g702.l3", "g702.l4", "g702.l5a", "g702.l5b", "g702.l5", "g702.l6", "g702.l7", "g702.l8", "g702.l9",
  "app.no", "app.period_to", "app.date", "job.number", "job.name", "owner.name", "contractor.name", "architect.name",
  "g703.a", "g703.b", "g703.c", "g703.d", "g703.e", "g703.f", "g703.g", "g703.pct", "g703.h", "g703.i",
] as const;
export type ValueKey = (typeof VALUE_KEYS)[number];
export type FieldMap = { form: "G702" | "G703"; edition: string; fields: { field_id: string; value: ValueKey }[] };

/** Problems that block the save. Long strings are refused so form text can't be stored as a "field id". */
export function mapProblems(m: FieldMap): string[] {
  const p: string[] = [];
  const seen = new Set<string>();
  for (const f of m.fields) {
    if (!/^[A-Za-z0-9_.\-[\]]{1,64}$/.test(f.field_id)) p.push(`Field id "${f.field_id.slice(0, 40)}" isn't a form field id. Store only field ids, never the form's text.`);
    if (!(VALUE_KEYS as readonly string[]).includes(f.value)) p.push(`${f.field_id}: unknown value ${f.value}.`);
    if (seen.has(f.field_id)) p.push(`${f.field_id} is mapped twice.`);
    seen.add(f.field_id);
  }
  if (!/^\d{4}$/.test(m.edition)) p.push("Edition is the form's year, like 1992.");
  const need = m.form === "G702" ? ["g702.l3", "g702.l4", "g702.l5", "g702.l6", "g702.l7", "g702.l8"] : ["g703.c", "g703.g", "g703.i"];
  const have = new Set(m.fields.map((f) => f.value as string));
  const miss = need.filter((k) => !have.has(k));
  if (miss.length) p.push(`The map is missing ${miss.join(", ")}.`);
  return p;
}

export const FORM_MAP_RULE = "Licensed form maps hold only field ids and value keys. The company supplies its own licensed form; the host fills it. Athena never stores, copies or reproduces the form.";
