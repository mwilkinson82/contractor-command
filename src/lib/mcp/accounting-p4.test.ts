import { describe, expect, it } from "vitest";
import { dueBack, emailCardSpec, missingItems, overdueBack, transmittalNumber, transmittalFile } from "./accounting/transmittal";

describe("Phase 4 transmittals (D10 per job)", () => {
  it("next number T-007 after six", () => expect(transmittalNumber(7)).toBe("T-007"));
  it("for approval: due back 10 working days, 2027-03-10 → 2027-03-24", () => expect(dueBack("for_approval", "2027-03-10")).toBe("2027-03-24"));
  it("for record needs no return; contract days win", () => {
    expect(dueBack("for_record", "2027-03-10")).toBeNull();
    expect(dueBack("for_approval", "2027-03-10", 5)).toBe("2027-03-17");
  });
  it("item existence check", () => expect(missingItems([{ ref: "262726-001.0" }, { ref: "RFI-099" }], new Set(["262726-001.0"]))).toEqual(["RFI-099"]));
  it("T-006 is 23 days overdue on 2027-03-10", () => {
    expect(overdueBack("2027-02-15", null, "2027-03-10")).toBe(23);
    expect(overdueBack("2027-02-15", "2027-03-01", "2027-03-10")).toBe(0);
  });
  it("email card: real attachment chip, never sends, sent only after host confirms", () => {
    const s = emailCardSpec({ job_number: "2701", number: "T-007", to: "R. Chen", subject: "x", file_name: transmittalFile("2701", "T-007", "2027-03-10") }).join(" ");
    expect(s).toContain("2701-T-007-2027-03-10.pdf attached as a real file");
    expect(s).toContain("never sends");
    expect(s).toContain("host_confirmed true");
  });
});
