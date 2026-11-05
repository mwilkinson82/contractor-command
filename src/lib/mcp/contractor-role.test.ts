import { describe, expect, it } from "vitest";
import { estimateRoleFor, parseContractorRole, roleOutcome, roleQuestionText } from "./contractor-role";

describe("contractor role", () => {
  it("reads the four roles from their values and from plain words", () => {
    expect(parseContractorRole("general_contractor")).toBe("general_contractor");
    expect(parseContractorRole("prime_trade")).toBe("prime_trade");
    expect(parseContractorRole("2")).toBe("prime_trade");
    expect(parseContractorRole("We're the GC")).toBe("general_contractor");
    expect(parseContractorRole("Electrical prime, we self-perform")).toBe("prime_trade");
    expect(parseContractorRole("I'm not the general contractor, I'm the electrical prime")).toBe("prime_trade");
    expect(parseContractorRole("not the GC, we're a sub")).toBe("subcontractor");
    expect(parseContractorRole("Subcontractor to the GC")).toBe("subcontractor");
    expect(parseContractorRole("sub to a sub")).toBe("sub_tier");
    expect(parseContractorRole("second tier")).toBe("sub_tier");
    expect(parseContractorRole("not sure")).toBeNull();
    expect(parseContractorRole("")).toBeNull();
  });

  it("files a prime trade contractor as prime and self-performing, not as the GC and not as a sub", () => {
    const out = roleOutcome("prime_trade");
    expect(out.gate).toBe("no");
    expect(out.position).toBe("prime");
    expect(out.flags).toMatchObject({ is_gc: "no", is_sub: "no", prime_contract: "yes", self_perform: "yes" });
    expect(roleOutcome("general_contractor").flags).toMatchObject({ is_gc: "yes", is_sub: "no", prime_contract: "yes" });
    expect(roleOutcome("subcontractor").flags).toMatchObject({ is_gc: "no", is_sub: "yes", prime_contract: "no" });
    // A sub may or may not self-perform; setup's own self-perform question still asks.
    expect(roleOutcome("subcontractor").flags.self_perform).toBeUndefined();
    expect(roleOutcome("sub_tier").position).toBe("sub_sub");
  });

  it("maps only the general contractor to the GC estimate", () => {
    expect(estimateRoleFor("general_contractor")).toBe("gc");
    expect(estimateRoleFor("prime_trade")).toBe("self_performer");
    expect(estimateRoleFor("sub_tier")).toBe("self_performer");
  });

  it("asks all four answers and doesn't read prime as GC", () => {
    const q = roleQuestionText({ position: "prime", companyRole: "Electrical contractor" });
    expect(q).toContain("1. General contractor");
    expect(q).toContain("2. Prime trade contractor, self-performing");
    expect(q).toContain("3. Subcontractor to the GC");
    expect(q).toContain("4. Sub-tier");
    expect(q).toContain("general contractor or a prime trade contractor");
    expect(q).toContain('"Electrical contractor"');
    expect(roleQuestionText()).not.toContain("job record");
  });
});
