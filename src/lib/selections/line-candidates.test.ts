import { describe, expect, it } from "vitest";
import { classifyLine, suggestLines } from "./line-candidates";

const kind = (item: string, qty: number | null = 4, unit = "ea") => {
  const c = classifyLine({ line_no: 1, item, qty, unit });
  return "skip" in c ? `skip:${c.skip}` : c.candidate.kind;
};

describe("which estimate lines get Good, Better, Best", () => {
  it("offers what the customer sees and chooses, across trades", () => {
    expect(kind("Type G mono-point pendant")).toBe("decorative_lighting");
    expect(kind("Kitchen faucet")).toBe("finish");
    expect(kind("Quartz countertops", 42, "sf")).toBe("finish");
    expect(kind("LVP flooring", 900, "sf")).toBe("finish");
    expect(kind("6in recessed downlights")).toBe("lighting");
    expect(kind("Level 2 EV charger", 1)).toBe("equipment");
    expect(kind("Wall occupancy sensors")).toBe("controls");
  });

  it("leaves out code-required, rough-in, accessory and unquantified lines", () => {
    expect(kind("Self-powered LED exit sign")).toBe("skip:code_required");
    expect(kind("DC-1 emergency battery pack with integral heads")).toBe("skip:code_required");
    expect(kind("Washroom GFCI receptacle")).toBe("skip:code_required");
    expect(kind("20A single-pole panel breakers")).toBe("skip:rough_in");
    expect(kind("Branch-circuit wire and conduit by circuit", null, "ft")).toBe("skip:rough_in");
    expect(kind("Window OPEN-sign receptacle")).toBe("skip:rough_in");
    expect(kind("Tag 37 combi-oven direct connection", 1, "connection")).toBe("skip:rough_in");
    expect(kind("Black track rail installed length", 9, "ft")).toBe("skip:accessory");
    expect(kind("Globe lamps for rope pendants", 2)).toBe("skip:accessory");
    expect(kind("Type F 12x48 lay-in fixture", 0)).toBe("skip:no_quantity");
    expect(classifyLine({ line_no: 1, item: "Pendants", qty: 2, exclusion: "By owner" })).toEqual({
      skip: "not_a_choice",
    });
  });

  it("ranks decorative and finish lines first, then quantity, and splits out lines already on the board", () => {
    const r = suggestLines(
      [
        { line_no: 1, item: "Type E 24x48 lay-in LED fixtures", qty: 6, unit: "ea" },
        { line_no: 6, item: "Type B black rope pendant", qty: 1, unit: "ea" },
        { line_no: 5, item: "Type G mono-point pendant", qty: 6, unit: "ea" },
        { line_no: 3, item: "Type A black track heads", qty: 9, unit: "ea" },
        { line_no: 12, item: "Wall occupancy sensors", qty: 3, unit: "ea" },
      ],
      ["T-3"],
      3,
    );
    expect(r.suggested.map((c) => c.estimate_line_ref)).toEqual(["T-5", "T-6", "T-1"]);
    expect(r.on_board.map((c) => c.estimate_line_ref)).toEqual(["T-3"]);
  });
});
