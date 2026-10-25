import { describe, it, expect } from "vitest";
import { buildSov } from "./sov";
import { buildFieldPayApp } from "./superintendent";
import { setupContractValue } from "./contract-value";
const base = { item_no: "05.01", description: "Base steel", scheduled_value: 900 };
const change = (amount: number) => ({
  item_no: "05.002",
  description: "Executed CO-001",
  scheduled_value: amount,
  executed_change_order: "approved-record",
  fee_included: true,
});
describe("executed change orders preserve contract and billing arithmetic", () => {
  it("adds a fully priced change without charging the base fee again", () => {
    const s = buildSov([base, change(100)], 10, 10);
    expect(s.summary.contract_total).toBe(1100);
    expect(s.summary.fee).toBe(100);
    expect(s.tie_out.ok).toBe(true);
  });
  it("preserves the entire prior certificate, including the original fee allocation", () => {
    const p = [{ item_no: "05.01", pct: 50 }];
    const before = buildFieldPayApp([base], 10, 10, p, p);
    const after = buildFieldPayApp([base, change(100)], 10, 10, p, p);
    expect(before.previous_certificates).toBe(500);
    expect(after.previous_certificates).toBe(500);
    expect(after.rows[0].previous).toBe(450);
    expect(after.completed_and_stored).toBe(500);
  });
  it("carries an executed credit at face value and permits negative current-period credit billing", () => {
    const s = buildSov([base, change(-100)], 10, 10);
    expect(s.summary.contract_total).toBe(900);
    const app = buildFieldPayApp(
      [base, change(-100)],
      10,
      0,
      [
        { item_no: "05.01", pct: 100 },
        { item_no: "05.002", pct: 100 },
      ],
      [
        { item_no: "05.01", pct: 100 },
        { item_no: "05.002", pct: 0 },
      ],
    );
    expect(app.previous_certificates).toBe(1000);
    expect(app.current_payment_due).toBe(-100);
    expect(app.contract_sum).toBe(900);
  });
  it("does not allow an ordinary negative SOV line or a credit exceeding the contract", () => {
    expect(() =>
      buildSov(
        [base, { item_no: "05.02", description: "Unapproved", scheduled_value: -10 }],
        10,
        10,
      ),
    ).toThrow("negative");
    expect(() => buildSov([base, change(-1001)], 10, 10)).toThrow("exceeds");
  });
  it("adds executed credits to the original setup value without changing the original fact", () => {
    const facts = [
      { module: "contract", key: "contract_value", value: 1000 },
      { module: "contract", key: "executed_change_orders", value: -100 },
    ];
    expect(setupContractValue(facts)).toBe(900);
    expect(facts[0].value).toBe(1000);
  });
});
