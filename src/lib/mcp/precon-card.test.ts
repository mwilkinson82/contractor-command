import { describe, expect, it } from "vitest";
import {
  nextInstallment,
  preconCard,
  preconMoney,
  preconNextStep,
  creditState,
  type PreconAgreement,
} from "./tools/precon-tools";

const base: PreconAgreement = {
  id: "a",
  job_id: "j",
  version: 3,
  status: "signed",
  phase: "design",
  design_partner: "Coastline Design Studio",
  design_role: "architect",
  design_fee_cents: 1_000_000,
  design_days: 35,
  design_markup_bps: 0,
  hourly_rate_cents: 12_500,
  time_lines: [
    { label: "Design coordination", hours: 16 },
    { label: "Estimate", hours: 40 },
  ],
  includes: [],
  billing: "split",
  owner_owns_drawings: true,
  credit: true,
  credit_days: 90,
  credit_until: null,
  price_cents: 1_700_000,
  parts: {
    design_cents: 1_000_000,
    markup_cents: 0,
    hours: 56,
    time_cents: 700_000,
    price_cents: 1_700_000,
  },
  installments: [
    { when: "signing", amount_cents: 850_000 },
    { when: "final_drawings", amount_cents: 850_000 },
  ],
  hours_used: 12,
  sent_on: "2026-10-20",
  signed_on: "2026-10-22",
  signed_name: "Erin Hartwell",
  signed_via: "client_page",
  drawings_approved_on: null,
  outcome: null,
  closed_on: null,
  invoices: [],
  credit_change: null,
  contract_sov: false,
  note: null,
};
const inv = (n: number, paid: number) => ({
  id: `i${n}`,
  number: `PC-2731-${n}`,
  kind: "invoice" as const,
  status: "submitted",
  invoice_date: "2026-10-22",
  net_due_cents: 850_000,
  paid_cents: paid,
  credited_cents: 0,
});

describe("pre-con card", () => {
  it("walks the member through each next step", () => {
    expect(preconNextStep(null)).toMatch(/start a pre-construction agreement/);
    expect(preconNextStep({ ...base, status: "draft" })).toMatch(/^Send the agreement/);
    expect(preconNextStep({ ...base, status: "sent" })).toMatch(/Did the owner sign/);
    expect(preconNextStep(base)).toBe("Send invoice 1 for $8,500 to the owner's client page?");
    const one = { ...base, invoices: [inv(1, 850_000)] };
    expect(nextInstallment(one)).toBeNull();
    expect(preconNextStep(one)).toMatch(/final drawings/);
    const drawings = { ...one, drawings_approved_on: "2026-11-01", phase: "estimate" as const };
    expect(preconNextStep(drawings)).toBe("Send invoice 2 for $8,500 to the owner's client page?");
    const both = { ...drawings, invoices: [inv(1, 850_000), inv(2, 0)] };
    expect(preconNextStep(both)).toMatch(/Build the estimate/);
    expect(preconMoney(both)).toEqual({
      billed: 1_700_000,
      paid: 850_000,
      open: 850_000,
      unbilled: 0,
    });
    const won = {
      ...both,
      status: "closed" as const,
      outcome: "won" as const,
      phase: "contract" as const,
    };
    expect(preconNextStep(won)).toMatch(/^Set up the contract's schedule of values/);
    const sov = { ...won, contract_sov: true };
    expect(preconNextStep(sov)).toBe(
      "Add the $17,000 pre-con credit to the contract as a change order for the owner to approve?",
    );
    const co = { id: "c", number: "PCO-008", co_number: null, total_cents: -1_700_000 };
    expect(preconNextStep({ ...sov, credit_change: { ...co, state: "submitted" } })).toBe(
      "Send the pre-con credit change order PCO-008 to the owner to approve?",
    );
    expect(preconNextStep({ ...sov, credit_change: { ...co, state: "approved" } })).toMatch(
      /owner approved the pre-con credit \(PCO-008\)\. Execute it/,
    );
    const applied = { ...sov, credit_change: { ...co, state: "executed", co_number: "CO-003" } };
    expect(creditState(applied)).toBe("applied");
    expect(preconNextStep(applied)).toMatch(/wrapped up/);
    expect(creditState({ ...sov, credit_change: { ...co, state: "rejected" } })).toBe("to_make");
  });

  it("shows the build-up, terms and phase strip", () => {
    const card = preconCard({
      status: "ok",
      job_id: "j",
      job_number: "2731",
      job_name: "Hartwell Residence",
      agreement: base,
    });
    expect(card.kpis?.[0]).toEqual({ label: "Agreement", value: "$17,000" });
    const strip = card.sections![0]!;
    expect(strip.rows.map((r) => r.cells[0])).toEqual([
      "Agreement",
      "Design",
      "Estimate",
      "Proposal",
      "Contract",
    ]);
    expect(strip.rows.find((r) => r.tone === "action")?.cells[0]).toBe("Design");
    const build = card.sections![1]!;
    expect(build.rows.at(-1)?.cells).toEqual(["Agreement price", "56", "$17,000"]);
    expect(card.sections![2]!.rows[0]!.cells[0]).toBe(
      "Billed $8,500 at signing and $8,500 at final drawings",
    );
  });

  it("a job with no agreement offers to start one", () => {
    const card = preconCard({ status: "none", job_id: "j", job_number: "2732", job_name: "Plain" });
    expect(card.next_move).toMatch(/Want to start/);
  });
});
