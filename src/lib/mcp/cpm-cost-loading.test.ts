// A CPM may be saved with activity IDs, logic and durations alone. It ties to
// the contract only once it is cost loaded; nothing spreads dollars onto it.
import { describe, expect, it } from "vitest";
import { LIVING_LABEL, NOT_COST_LOADED, checkSave, isCostLoaded, type Activity } from "./living";

const act = (id: string, value: number | null, extra: Partial<Activity> = {}): Activity => ({
  id,
  name: `Activity ${id}`,
  duration: 10,
  start: "2027-03-01",
  finish: "2027-03-12",
  predecessors: [],
  total_float: null,
  critical: null,
  pct_complete: 0,
  value,
  sov_line: null,
  cost_code: null,
  ...extra,
});

describe("CPM without cost loading", () => {
  it("saves a plain CPM with no values and no contract value, and leaves its values empty", () => {
    const acts = [
      act("A10", null),
      act("A20", null, { predecessors: [{ id: "A10", type: "FS", lag: 0 }] }),
    ];
    const r = checkSave("cpm", { activities: acts }, null, null);
    expect(r.ok).toBe(true);
    expect(r.tie).toBeFalsy();
    expect(acts.every((a) => a.value === null)).toBe(true);
    expect(isCostLoaded(acts)).toBe(false);
    // Zero is not a load.
    expect(isCostLoaded([act("A10", 0), act("A20", null)])).toBe(false);
  });

  it("treats any nonzero value as cost loaded, so the loaded total must tie to the contract", () => {
    const partial = [act("A10", 400_000), act("A20", null), act("A30", null)];
    expect(isCostLoaded(partial)).toBe(true);
    const r = checkSave("cpm", { activities: partial }, null, 1_400_000);
    expect(r.ok).toBe(false);
    expect(r.tie?.ties).toBe(false);
    expect(checkSave("cpm", { activities: partial }, null, null).ok).toBe(false);
    const full = [act("A10", 400_000), act("A20", 1_000_000), act("A30", null)];
    expect(checkSave("cpm", { activities: full }, null, 1_400_000).ok).toBe(true);
  });

  it("counts an owner-furnished value as a load too", () => {
    const acts = [
      act("A10", 25_000, { owner_furnished: true } as Partial<Activity>),
      act("A20", null),
    ];
    expect(isCostLoaded(acts)).toBe(true);
  });

  it("still ties a billing forecast", () => {
    expect(checkSave("billing_forecast", { billing: { months: [] } }, null, null).ok).toBe(false);
  });

  it("says plainly when billing or earned value from the schedule is unavailable", () => {
    expect(NOT_COST_LOADED).toMatch(/isn't cost loaded/);
    expect(NOT_COST_LOADED).toMatch(/isn't available/);
    expect(LIVING_LABEL.cpm).toBe("CPM");
  });
});
