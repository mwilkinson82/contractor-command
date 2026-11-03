import { describe, expect, it } from "vitest";
import type { BidBreakdown } from "./estimating-bid";
import { bidComponents } from "./estimating-handoff-preview";
import {
  mapEstimateDestination,
  type DestinationPlan,
  type DestinationSnapshot,
} from "./estimating-destination-mapping";

const bid = (): BidBreakdown => ({
  direct: [
    { ref: "T-1", basis: "direct", quoteId: null, amountCents: 10000 },
    { ref: "T-2", basis: "direct", quoteId: null, amountCents: 5000 },
  ],
  directCents: 15000,
  generalConditions: [{ label: "Office", ref: null, placement: "gc", amountCents: 2000 }],
  generalConditionsCents: 2000,
  requirements: [{ label: "Permit", ref: "R-1", placement: "own_line", amountCents: 1000 }],
  requirementsCents: 1000,
  overheadCents: 1000,
  profitCents: 1000,
  totalCents: 20000,
});
const destination = (): DestinationSnapshot => ({
  company_id: "company",
  job_id: "job",
  version: "guarded-v1",
  fee_pct: 10,
  basis: "Official basis",
  draft_fee_pct: null,
  draft_basis: null,
  facts: [
    { module: "budget", key: "A", value: { description: "A", amount: 100 } },
    { module: "budget", key: "B", value: { description: "B", amount: 100 } },
  ],
});
const budgetPlan = (): Extract<DestinationPlan, { kind: "budget" }> => ({
  kind: "budget",
  lines: [
    { cost_code: "A", description: "Paint" },
    { cost_code: "B", description: "Floor" },
  ],
  allocations: bidComponents(bid()).map((c) => ({
    component_id: c.id,
    splits:
      c.id === "direct:T-1"
        ? [
            { target_key: "A", amount_cents: 6000 },
            { target_key: "B", amount_cents: 4000 },
          ]
        : c.id === "direct:T-2"
          ? [{ target_key: "B", amount_cents: 5000 }]
          : [],
    excluded_cents: c.id.startsWith("direct:") ? 0 : c.amountCents,
    exclusion_reason: c.id.startsWith("direct:") ? null : "Outside this execution cost budget",
  })),
});
const sovPlan = (): Extract<DestinationPlan, { kind: "sov" }> => ({
  kind: "sov",
  copy: "official",
  source_basis: "base_contract",
  fee_pct: 10,
  billing_basis: "Explicit signed base-contract value",
  lines: [{ line: "01", description: "Work and general conditions", cost_codes: ["A", "B"] }],
  allocations: bidComponents(bid()).map((c) => ({
    component_id: c.id,
    splits: ["overhead", "profit"].includes(c.id)
      ? []
      : [{ target_key: "01", amount_cents: c.amountCents }],
    fee_cents: ["overhead", "profit"].includes(c.id) ? c.amountCents : 0,
  })),
});
const run = (plan: DestinationPlan = budgetPlan(), dest = destination(), source = bid()) =>
  mapEstimateDestination({ breakdown: source, destination: dest, plan });

describe("canonical estimate destination mapping", () => {
  it("splits budget cents explicitly, preserves omitted facts and records exclusions", () => {
    const dest = destination();
    dest.facts.push({
      module: "budget",
      key: "KEEP",
      value: { description: "Retained", amount: 25 },
    });
    const before = structuredClone(dest);
    const r = run(budgetPlan(), dest);
    expect(r.facts).toEqual({
      budget: { A: { description: "Paint", amount: 60 }, B: { description: "Floor", amount: 90 } },
    });
    expect(r.review).toMatchObject({
      source_total_cents: 20000,
      mapped_cents: 15000,
      excluded_cents: 5000,
      resulting_total_cents: 17500,
      retained_keys: ["KEEP"],
    });
    expect(r.allocated_components).toEqual(["direct:T-1", "direct:T-2"]);
    expect(r.target_keys).toEqual([
      { module: "budget", key: "A" },
      { module: "budget", key: "B" },
    ]);
    expect(r.allocation_totals[0]).toEqual({
      component_id: "direct:T-1",
      mapped_cents: 10000,
      excluded_cents: 0,
      fee_cents: 0,
    });
    expect(r.terms).toEqual({});
    expect(dest).toEqual(before);
    expect(r.review.retained_rows).toEqual([
      {
        module: "budget",
        key: "KEEP",
        value: { description: "Retained", amount: 25 },
        amount_cents: 2500,
      },
    ]);
    expect(
      r.review.targets.reduce((n, t) => n + t.proposed_cents, 0) +
        r.review.retained_rows.reduce((n, t) => n + t.amount_cents!, 0),
    ).toBe(r.review.resulting_total_cents);
  });
  it("supports an explicit zero target for retirement without inventing an unused amount", () => {
    const plan = budgetPlan();
    plan.lines.push({ cost_code: "OLD", description: "Retired", zero: true });
    expect(run(plan).facts.budget.OLD).toEqual({ description: "Retired", amount: 0 });
    delete plan.lines[2].zero;
    expect(() => run(plan)).toThrow(/explicit zero/i);
    plan.lines[0].zero = true;
    expect(() => run(plan)).toThrow(/marked zero/i);
  });
  it("requires exact per-component accounting and reasoned budget exclusions", () => {
    const missing = budgetPlan();
    missing.allocations.pop();
    expect(() => run(missing)).toThrow(/every source component/i);
    const duplicate = budgetPlan();
    duplicate.allocations[1].component_id = duplicate.allocations[0].component_id;
    expect(() => run(duplicate)).toThrow(/exactly once/i);
    const cents = budgetPlan();
    cents.allocations[0].splits[0].amount_cents--;
    expect(() => run(cents)).toThrow(/exact source cents/i);
    const reason = budgetPlan();
    reason.allocations[2].exclusion_reason = null;
    expect(() => run(reason)).toThrow(/explicit reason/i);
    const target = budgetPlan();
    target.allocations[0].splits[1].target_key = "A";
    expect(() => run(target)).toThrow(/unambiguous/i);
    const unknown = budgetPlan();
    unknown.allocations[0].splits[0].target_key = "missing";
    expect(() => run(unknown)).toThrow(/known/i);
  });
  it("rejects duplicate targets, malformed canonical totals and duplicate guarded identities", () => {
    const plan = budgetPlan();
    plan.lines.push(plan.lines[0]);
    expect(() => run(plan)).toThrow(/unique/i);
    expect(() => run(budgetPlan(), destination(), { ...bid(), totalCents: 1 })).toThrow(
      /canonical source/i,
    );
    const dest = destination();
    dest.facts.push(dest.facts[0]);
    expect(() => run(budgetPlan(), dest)).toThrow(/duplicate fact/i);
  });
  it("creates initial official SOV from explicit base/fee mapping using existing line identities", () => {
    const r = run(sovPlan());
    expect(r.facts).toEqual({
      sov: {
        "01": {
          description: "Work and general conditions",
          billable_value: 180,
          cost_codes: ["A", "B"],
        },
      },
    });
    expect(r.review).toMatchObject({
      source_total_cents: 20000,
      resulting_base_cents: 18000,
      fee_cents: 2000,
      resulting_total_cents: 20000,
      official_locked: false,
    });
    expect(r.terms).toEqual({ sov_basis: "Explicit signed base-contract value" });
    expect(r.allocated_components).toEqual(bidComponents(bid()).map((c) => c.id));
    expect(r.facts.sov).not.toHaveProperty("CF");
    expect(r.plan.kind).toBe("sov");
  });
  it("does not infer fee, base splits, billing basis, cost codes or line identity", () => {
    const p = sovPlan();
    p.fee_pct = 20;
    expect(() => run(p)).toThrow(/exact frozen bid total/i);
    const markups = sovPlan();
    markups.allocations[4].fee_cents = 0;
    expect(() => run(markups)).toThrow(/exact source cents/i);
    const code = sovPlan();
    code.lines[0].cost_codes = ["MISSING"];
    expect(() => run(code)).toThrow(/existing.*budget cost codes/i);
    const duplicateCode = sovPlan();
    duplicateCode.lines[0].cost_codes = ["A", "A"];
    expect(() => run(duplicateCode)).toThrow(/unique.*budget cost codes/i);
    const identity = sovPlan();
    identity.lines[0].line = "CF";
    expect(() => run(identity)).toThrow(/sequential item/i);
    const basis = sovPlan();
    basis.billing_basis = "";
    expect(() => run(basis)).toThrow();
  });
  it("locks existing official line dollars while allowing identical dollars and metadata review", () => {
    const dest = destination();
    dest.facts.push({
      module: "sov",
      key: "01",
      value: { description: "Before", billable_value: 170, cost_codes: ["A"] },
    });
    expect(() => run(sovPlan(), dest)).toThrow(/official SOV dollars are locked/i);
    (dest.facts[2].value as { billable_value: number }).billable_value = 180;
    const r = run(sovPlan(), dest);
    expect(r.review.official_locked).toBe(true);
    expect(r.facts.sov["01"]).toMatchObject({
      billable_value: 180,
      description: "Work and general conditions",
    });
  });
  it("seeds a new draft and preserves official executed changes byte-for-byte", () => {
    const dest = destination();
    const change = {
      description: "Approved change",
      billable_value: 50,
      executed_change_order: "co-id",
      fee_included: true,
      cost_codes: ["B"],
      source_note: "Original evidence",
    };
    dest.facts.push(
      {
        module: "sov",
        key: "01",
        value: { description: "Official base", billable_value: 180, cost_codes: ["A"] },
      },
      { module: "sov", key: "09.001", value: change },
    );
    const p = sovPlan();
    p.copy = "draft";
    const before = structuredClone(dest);
    const r = run(p, dest);
    expect(r.facts.sov_draft["09.001"]).toBe(change);
    expect(r.facts).not.toHaveProperty("sov");
    expect(r.review).toMatchObject({
      resulting_base_cents: 18000,
      fee_cents: 2000,
      retained_change_cents: 5000,
      resulting_total_cents: 25000,
    });
    expect(r.terms).toEqual({
      sov_draft_fee_pct: 10,
      sov_draft_basis: "Explicit signed base-contract value",
    });
    expect(r.target_keys).toEqual([{ module: "sov_draft", key: "01" }]);
    expect(r.review.retained_rows).toEqual([
      { module: "sov_draft", key: "09.001", value: change, amount_cents: 5000 },
    ]);
    expect(
      r.review.targets.reduce((n, t) => n + t.proposed_cents, 0) +
        r.review.fee_cents +
        r.review.retained_rows.reduce((n, t) => n + t.amount_cents!, 0),
    ).toBe(r.review.resulting_total_cents);
    expect(dest).toEqual(before);
  });
  it("keeps existing draft base rows and imports missing official changes without replacing them", () => {
    const dest = destination();
    const change = {
      description: "Credit",
      billable_value: -10,
      executed_change_order: "co-credit",
      fee_included: true,
    };
    dest.facts.push(
      { module: "sov", key: "01", value: { billable_value: 999 } },
      { module: "sov", key: "09.001", value: change },
      {
        module: "sov_draft",
        key: "01",
        value: { description: "Earlier draft", billable_value: 180 },
      },
    );
    const p = sovPlan();
    p.copy = "draft";
    const r = run(p, dest);
    expect(r.facts.sov_draft["09.001"]).toBe(change);
    expect(r.review.resulting_total_cents).toBe(19000);
    expect(r.facts.sov_draft["01"]).toMatchObject({ billable_value: 180 });
  });
  it("rejects CO target overlap, divergent CO copies and unmatched draft COs", () => {
    const dest = destination();
    const c = { billable_value: 10, executed_change_order: "co", fee_included: true };
    dest.facts.push({ module: "sov", key: "01", value: c });
    const p = sovPlan();
    p.copy = "draft";
    expect(() => run(p, dest)).toThrow(/change-order targets/i);
    dest.facts[2].key = "09.001";
    dest.facts.push({ module: "sov_draft", key: "09.001", value: { ...c, billable_value: 11 } });
    expect(() => run(p, dest)).toThrow(/conflicts.*executed change-order/i);
    dest.facts = dest.facts.filter((f) => f.module !== "sov");
    expect(() => run(p, dest)).toThrow(/unmatched executed/i);
  });
  it("preserves omitted zero base rows but refuses retained amounts or unknowns that break reconciliation", () => {
    const dest = destination();
    dest.facts.push({
      module: "sov_draft",
      key: "02",
      value: { description: "Omitted", billable_value: 1 },
    });
    const p = sovPlan();
    p.copy = "draft";
    expect(() => run(p, dest)).toThrow(/retained numeric base lines/i);
    (dest.facts[2].value as { billable_value: unknown }).billable_value = null;
    expect(() => run(p, dest)).toThrow(/explicit amount/i);
    (dest.facts[2].value as { billable_value: unknown }).billable_value = 0;
    const r = run(p, dest);
    expect(r.review.retained_keys).toEqual(["02"]);
    expect(r.review.resulting_total_cents).toBe(20000);
  });
  it("does not touch contract facts or official terms during draft handoff", () => {
    const dest = destination();
    dest.facts.push({ module: "contract", key: "contract_value", value: 99999 });
    const p = sovPlan();
    p.copy = "draft";
    const r = run(p, dest);
    expect(Object.keys(r.facts)).toEqual(["sov_draft"]);
    expect(r.terms).not.toHaveProperty("sov_fee_pct");
    expect(r.terms).not.toHaveProperty("sov_basis");
    expect(r.review.source_basis).toBe("base_contract");
    expect(r.review.recorded_contract_original_cents).toBe(9999900);
  });
  it("preserves genuine zero source and target decisions", () => {
    const source = bid();
    source.direct.forEach((r) => (r.amountCents = 0));
    source.directCents = 0;
    source.generalConditions.forEach((r) => (r.amountCents = 0));
    source.generalConditionsCents = 0;
    source.requirements.forEach((r) => (r.amountCents = 0));
    source.requirementsCents = 0;
    source.overheadCents = 0;
    source.profitCents = 0;
    source.totalCents = 0;
    const plan = sovPlan();
    plan.lines[0].zero = true;
    plan.allocations.forEach((a) => {
      a.splits = [];
      a.fee_cents = 0;
    });
    const result = run(plan, destination(), source);
    expect(result.facts.sov["01"]).toMatchObject({ billable_value: 0 });
    expect(result.review.resulting_total_cents).toBe(0);
    expect(result.allocated_components).toEqual([]);
  });
  it("retains special budget identities as own data and rejects conflicting saved types", () => {
    const plan = budgetPlan();
    plan.lines[0].cost_code = "__proto__";
    plan.allocations[0].splits[0].target_key = "__proto__";
    const r = run(plan);
    expect(Object.hasOwn(r.facts.budget, "__proto__")).toBe(true);
    expect(JSON.parse(JSON.stringify(r.facts.budget))["__proto__"]).toEqual({
      description: "Paint",
      amount: 60,
    });
    const dest = destination();
    dest.facts[0].status = "unknown";
    expect(() => run(budgetPlan(), dest)).toThrow(/status conflicts/i);
  });
  it("rejects fees that PostgreSQL numeric(7,4) would silently round", () => {
    for (const fee of [10.00001, 0.00000001]) {
      const plan = sovPlan();
      plan.fee_pct = fee;
      expect(() => run(plan)).toThrow(/four decimal places/i);
    }
  });
  it("rejects high cents whose JSON dollar text would lose precision", () => {
    const source = bid();
    source.direct[0].amountCents = Number.MAX_SAFE_INTEGER;
    source.direct[1].amountCents = 0;
    source.directCents = Number.MAX_SAFE_INTEGER;
    source.generalConditions[0].amountCents = 0;
    source.generalConditionsCents = 0;
    source.requirements[0].amountCents = 0;
    source.requirementsCents = 0;
    source.overheadCents = 0;
    source.profitCents = 0;
    source.totalCents = Number.MAX_SAFE_INTEGER;
    const plan = budgetPlan();
    plan.lines = [{ cost_code: "A", description: "Large amount" }];
    plan.allocations = bidComponents(source).map((c) => ({
      component_id: c.id,
      splits: c.id === "direct:T-1" ? [{ target_key: "A", amount_cents: c.amountCents }] : [],
      excluded_cents: 0,
      exclusion_reason: null,
    }));
    expect(() => run(plan, destination(), source)).toThrow(/serialized cent precision/i);
  });
  it("ties official base SOV to known original contract value and preserves0058 provenance", () => {
    const dest = destination();
    const basis = {
      reference: "Executed agreement",
      provided_by: "00000000-0000-4000-8000-000000000001",
      provided_at: "2026-11-01T00:00:00.000Z",
    };
    dest.facts.push(
      { module: "contract", key: "contract_value", status: "known", value: 99999 },
      { module: "contract", key: "contract_value_basis", status: "known", value: basis },
    );
    expect(() => run(sovPlan(), dest)).toThrow(/canonical recorded original contract value/i);
    dest.facts.find((f) => f.key === "contract_value")!.value = 200;
    const before = structuredClone(dest);
    const r = run(sovPlan(), dest);
    expect(r.review).toMatchObject({
      recorded_contract_original_cents: 20000,
      recorded_contract_basis: basis,
    });
    expect(r.facts).not.toHaveProperty("contract");
    expect(dest).toEqual(before);
    dest.facts = dest.facts.filter((f) => f.key !== "contract_value_basis");
    expect(run(sovPlan(), dest).review.recorded_contract_basis).toBeNull();
  });
  it("holds malformed/conflicting canonical contract facts without repricing a draft", () => {
    const malformed = destination();
    malformed.facts.push({
      module: "contract",
      key: "contract_value",
      status: "known",
      value: "200",
    });
    expect(() => run(sovPlan(), malformed)).toThrow(/exact nonnegative USD/i);
    const duplicate = destination();
    duplicate.facts.push(
      { module: "contract", key: "contract_value", status: "known", value: 200 },
      { module: "contract", key: "contract_value", status: "known", value: 201 },
    );
    expect(() => run(sovPlan(), duplicate)).toThrow(/conflicting canonical/i);
    const badBasis = destination();
    badBasis.facts.push(
      { module: "contract", key: "contract_value", status: "known", value: 200 },
      {
        module: "contract",
        key: "contract_value_basis",
        status: "known",
        value: { reference: "Missing actor and date" },
      },
    );
    expect(() => run(sovPlan(), badBasis)).toThrow(/recorded contract basis/i);
    const draft = destination();
    draft.facts.push({ module: "contract", key: "contract_value", status: "known", value: 99999 });
    const p = sovPlan();
    p.copy = "draft";
    const before = structuredClone(draft);
    const r = run(p, draft);
    expect(r.review.resulting_total_cents).toBe(20000);
    expect(r.facts).not.toHaveProperty("contract");
    expect(draft).toEqual(before);
  });
  it("enforces 0057 official work-line capacity while reporting draft limits without inventing rollups", () => {
    const p = sovPlan();
    p.lines.push(
      ...Array.from({ length: 99 }, (_, i) => ({
        line: String(i + 2).padStart(3, "0"),
        description: `Explicit zero ${i}`,
        cost_codes: ["A"],
        zero: true as const,
      })),
    );
    expect(() => run(p)).toThrow(/at most 99 stored work lines/i);
    p.copy = "draft";
    const r = run(p);
    expect(r.review.billing_structure).toEqual({
      work_line_count: 100,
      max_work_lines: 99,
      work_line_limit_ok: false,
      amount_range_ok: true,
      requires_official_acceptance: true,
    });
    expect(Object.keys(r.facts.sov_draft)).toHaveLength(100);
    p.copy = "official";
    p.lines.pop();
    expect(run(p).review.billing_structure).toMatchObject({
      work_line_count: 99,
      work_line_limit_ok: true,
    });
  });
  it("holds official billing amounts beyond 0057 range while flagging a draft proposal", () => {
    const source = bid();
    source.direct[0].amountCents = 15_000_000_000_000;
    source.direct[1].amountCents = 0;
    source.directCents = 15_000_000_000_000;
    source.generalConditions[0].amountCents = 0;
    source.generalConditionsCents = 0;
    source.requirements[0].amountCents = 0;
    source.requirementsCents = 0;
    source.overheadCents = 0;
    source.profitCents = 0;
    source.totalCents = 15_000_000_000_000;
    const plan = sovPlan();
    plan.fee_pct = 0;
    plan.allocations = bidComponents(source).map((c) => ({
      component_id: c.id,
      splits: c.id === "direct:T-1" ? [{ target_key: "01", amount_cents: c.amountCents }] : [],
      fee_cents: 0,
    }));
    expect(() => run(plan, destination(), source)).toThrow(/supported billing range/i);
    plan.copy = "draft";
    expect(run(plan, destination(), source).review.billing_structure).toMatchObject({
      work_line_count: 1,
      amount_range_ok: false,
      requires_official_acceptance: true,
    });
  });
});
