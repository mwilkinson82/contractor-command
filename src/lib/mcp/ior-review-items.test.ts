import { describe, expect, it } from "vitest";
import { readIorModel } from "../ior-model";
import { iorReviewItems, iorReviewKey, syncIorReviewItems } from "./ior-review-items";
import type { Sb } from "./guard";

// Fictional IOR: one live risk, one closed at $0, one with no review date.
const data = (exposures: Record<string, unknown>[]) => ({
  ior_model: {
    original_contract: 3200000,
    original_cost_budget: 2720000,
    cost_growth: 0,
    actual_cost_to_date: 0,
    phase: "Middle",
    percent_complete: 60,
    change_orders: [],
    exposures,
  },
});
const lighting = {
  title: "Lighting allowance overrun",
  short: "Lighting",
  category: "allowance_overrun",
  response: "offset",
  dollar_risk: 22000,
  probability: 90,
  hold: "E",
  owner: "Dana (PM)",
  opened: "2026-02-20",
  next_review: "2026-03-20",
  next_move: "Price the swap to LED troffers",
};
const eliminated = {
  ...lighting,
  title: "Electrician no-show",
  short: "Electrician",
  dollar_risk: 0,
  response: "eliminate",
};
const undated = { ...lighting, title: "Owner finish picks", short: "Finishes", next_review: null };

describe("IOR risk reviews as open items", () => {
  it("opens one item per live risk, due on its next review date", () => {
    const { model } = readIorModel(data([lighting, eliminated, undated]));
    const items = iorReviewItems(model!);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      check_key: "ior_review:lighting-allowance-overrun:2026-03-20",
      action: "Review the IOR risk: Lighting ($19,800 held)",
      needed_by: "2026-03-20",
      accountable: "Dana (PM)",
    });
    expect(items[0].detail).toContain("Next move: Price the swap to LED troffers");
  });

  it("keys each review to its date, so a new review date is a new item", () => {
    expect(iorReviewKey(lighting, "2026-04-03")).toBe(
      "ior_review:lighting-allowance-overrun:2026-04-03",
    );
  });

  type Call = { fn: string; args: Record<string, unknown> };
  const fakeSb = (rows: { id: string; check_key: string; status: string }[]) => {
    const calls: Call[] = [];
    const query = {
      select: () => query,
      eq: () => query,
      like: () => Promise.resolve({ data: rows, error: null }),
    };
    const sb = {
      from: () => query,
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve({ data: { existing: false }, error: null });
      },
    } as unknown as Sb;
    return { sb, calls };
  };

  it("adds the missing review and closes reviews the IOR no longer calls for", async () => {
    const { sb, calls } = fakeSb([
      { id: "old", check_key: "ior_review:lighting-allowance-overrun:2026-03-06", status: "open" },
      { id: "elec", check_key: "ior_review:electrician-no-show:2026-03-10", status: "open" },
    ]);
    const r = await syncIorReviewItems(sb, "job-1", data([lighting, eliminated]));
    expect(r).toEqual({ opened: 1, closed: 2 });
    const add = calls.find((c) => c.fn === "mcp_add_item")!;
    expect(add.args._job).toBe("job-1");
    expect(add.args._f).toMatchObject({
      check_key: "ior_review:lighting-allowance-overrun:2026-03-20",
      needed_by: "2026-03-20",
      internal_only: true,
      source: "ior",
    });
    const closed = calls.filter((c) => c.fn === "mcp_resolve_item").map((c) => c.args._item);
    expect(closed).toEqual(["old", "elec"]);
  });

  it("never reopens a review the member already closed", async () => {
    const { sb, calls } = fakeSb([
      {
        id: "done",
        check_key: "ior_review:lighting-allowance-overrun:2026-03-20",
        status: "resolved",
      },
    ]);
    const r = await syncIorReviewItems(sb, "job-1", data([lighting]));
    expect(r).toEqual({ opened: 0, closed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("does nothing for a report with no IOR model", async () => {
    const { sb, calls } = fakeSb([]);
    expect(await syncIorReviewItems(sb, "job-1", {})).toEqual({ opened: 0, closed: 0 });
    expect(calls).toHaveLength(0);
  });
});
