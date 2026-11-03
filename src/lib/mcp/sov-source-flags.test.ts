import { describe, expect, it } from "vitest";
import {
  buildSov,
  sovValueCents,
  sovTotalChangeRefusal,
  SovMismatch,
  SOV_SOURCE_REFUSAL,
  type SovLineIn,
} from "./sov";

describe("runtime SOV source types", () => {
  it.each(["false", "true", 0, 1, null, {}])(
    "holds malformed fee_included %j instead of promoting truthiness",
    (fee_included) => {
      const line = {
        item_no: "01",
        description: "Work",
        scheduled_value: 100,
        executed_change_order: "co",
        fee_included,
      };
      expect(() => buildSov([line as unknown as SovLineIn], 10, null)).toThrow(SovMismatch);
      expect(() => buildSov([line as unknown as SovLineIn], 10, null)).toThrow(
        /fee_included must be a boolean/i,
      );
      expect(
        sovValueCents([{ billable_value: 100, executed_change_order: "co", fee_included }], 10),
      ).toEqual({ sov: null, contract: null });
      expect(
        sovTotalChangeRefusal([], 10, {
          "01": { billable_value: 100, executed_change_order: "co", fee_included },
        }),
      ).toBe(SOV_SOURCE_REFUSAL);
    },
  );
  it.each([null, "", true, 7, {}])(
    "holds malformed executed source %j",
    (executed_change_order) => {
      expect(() =>
        buildSov(
          [
            {
              item_no: "01",
              description: "Work",
              scheduled_value: 100,
              fee_included: true,
              executed_change_order,
            } as unknown as SovLineIn,
          ],
          10,
          null,
        ),
      ).toThrow(SovMismatch);
      expect(
        sovValueCents([{ billable_value: 100, fee_included: true, executed_change_order }], 10)
          .contract,
      ).toBeNull();
    },
  );
  it("preserves genuine boolean arithmetic, zero and fee-included credits", () => {
    const line = {
      item_no: "01",
      description: "Work",
      scheduled_value: 100,
      executed_change_order: "co",
    };
    expect(buildSov([{ ...line, fee_included: false }], 10, null).summary.contract_total).toBe(
      111.11,
    );
    expect(buildSov([{ ...line, fee_included: true }], 10, null).summary.contract_total).toBe(100);
    expect(
      buildSov(
        [
          { item_no: "01", description: "Base", scheduled_value: 100 },
          { ...line, item_no: "02", scheduled_value: -10, fee_included: true },
        ],
        10,
        null,
      ).summary.contract_total,
    ).toBe(101.11);
    expect(
      buildSov(
        [{ item_no: "01", description: "Zero", scheduled_value: 0, fee_included: false }],
        0,
        null,
      ).summary.contract_total,
    ).toBe(0);
  });
});
