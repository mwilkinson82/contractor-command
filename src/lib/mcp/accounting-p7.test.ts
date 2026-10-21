import { describe, expect, it } from "vitest";
import { mapProblems, type FieldMap } from "./accounting/form-map";

const ok: FieldMap = { form: "G702", edition: "1992", fields: ["g702.l3", "g702.l4", "g702.l5", "g702.l6", "g702.l7", "g702.l8"].map((v, i) => ({ field_id: `f${i}`, value: v as FieldMap["fields"][number]["value"] })) };
describe("Phase 7 form_map_save", () => {
  it("a complete map passes", () => expect(mapProblems(ok)).toEqual([]));
  it("form text in a field id is refused", () => expect(mapProblems({ ...ok, fields: [...ok.fields, { field_id: "APPLICATION AND CERTIFICATE FOR PAYMENT", value: "app.no" }] })[0]).toMatch(/never the form's text/));
  it("missing required values and duplicates are refused", () => {
    expect(mapProblems({ ...ok, fields: ok.fields.slice(1) }).join()).toContain("g702.l3");
    expect(mapProblems({ ...ok, fields: [...ok.fields, ok.fields[0]] }).join()).toContain("mapped twice");
  });
});
