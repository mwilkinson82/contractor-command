import { describe, expect, it } from "vitest";
import { submittalHistoryOrder } from "./submittal-history-order";

describe("immutable package build display order", () => {
  it("distinguishes four historical T-2 copies without changing their issued numbers or files", () => {
    const copies = ["c35511ef", "d915efa3", "343da664", "dbf1dd79"].map((id, i) => ({
      id,
      transmittal_number: 2,
      filename: "issued-T2.pdf",
      created_at: `2026-10-24T19:${String(11 + i).padStart(2, "0")}:33Z`,
    }));
    const input = [...copies].reverse(),
      before = JSON.stringify(input);
    const labels = submittalHistoryOrder(input);
    expect(copies.map((p) => labels.get(p.id))).toEqual([
      "Build 1 of 4",
      "Build 2 of 4",
      "Build 3 of 4",
      "Build 4 of 4",
    ]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("uses the original instant and a stable ID tie-breaker when clocks have different offsets", () => {
    const labels = submittalHistoryOrder([
      { id: "b", created_at: "2026-10-24T15:11:33-04:00" },
      { id: "a", created_at: "2026-10-24T19:11:33Z" },
    ]);
    expect(labels.get("a")).toBe("Build 1 of 2");
    expect(labels.get("b")).toBe("Build 2 of 2");
  });
});
