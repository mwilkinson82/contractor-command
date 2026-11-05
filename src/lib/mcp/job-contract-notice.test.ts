import { describe, expect, it } from "vitest";
import { contractNotice, type SavedContract } from "./tools/job-contract-tools";

const base = {
  id: "c1",
  contract_id: "c1",
  kind: "subcontract",
  counterparty: "Rivera Drywall",
  title: "the drywall subcontract",
  value_cents: 4_500_000,
  status: "signed",
  previous_status: "sent",
  status_changed: true,
  changed: true,
  version: 2,
} as SavedContract;

describe("contract notices", () => {
  it("tells the PM and supers when a sub signs, once per status", () => {
    expect(contractNotice(base, "j1")).toMatchObject({
      topic: "sub_contract",
      kind: "subcontract_signed",
      title: "Rivera Drywall signed the drywall subcontract",
      boardPage: "contracts",
      dedupeKey: "contract:c1:signed",
      facts: { amount_cents: 4_500_000 },
    });
    expect(
      contractNotice({ ...base, status: "sent", previous_status: "draft" }, "j1"),
    ).toMatchObject({
      kind: "subcontract_sent",
      title: "Contract sent to Rivera Drywall",
    });
  });

  it("counts the prime contract as a client decision and skips drafts, voids, other and no change", () => {
    expect(
      contractNotice({ ...base, kind: "prime", counterparty: "Harbor Point Dental" }, "j1"),
    ).toMatchObject({
      topic: "client_decision",
      kind: "prime_contract_signed",
    });
    expect(contractNotice({ ...base, status: "draft" }, "j1")).toBeNull();
    expect(contractNotice({ ...base, status: "void" }, "j1")).toBeNull();
    expect(contractNotice({ ...base, kind: "other" }, "j1")).toBeNull();
    expect(contractNotice({ ...base, status_changed: false }, "j1")).toBeNull();
  });
});
