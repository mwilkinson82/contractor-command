import { describe, expect, it } from "vitest";
import { renderHtml } from "./cards/html";
import { renderMarkdown } from "./cards/markdown";
import {
  contractNextStep,
  contractsBoardUrl,
  jobContractsCard,
  type JobContractsPayload,
} from "./tools/job-contract-tools";

const payload: JobContractsPayload = {
  job_id: "00000000-0000-4000-8000-000000000e20",
  job_number: "2810",
  job_name: "Willow Creek",
  contracts: [
    {
      id: "p1",
      kind: "prime",
      counterparty: "Willow Creek HOA",
      value_cents: 125_000_000,
      status: "signed",
      signed_on: "2026-10-01",
      document_id: "d1",
      cost_code: "00",
      version: 2,
    },
    {
      id: "s1",
      kind: "subcontract",
      counterparty: "Bright Wire Co",
      tag: "Lighting rough-in",
      cost_code: "26-0500",
      value_cents: 8_400_000,
      status: "sent",
      sent_on: "2026-11-02",
      version: 1,
    },
    {
      id: "v1",
      kind: "supplier",
      counterparty: "Volt Supply",
      po_number: "PO-101",
      value_cents: 1_000_000,
      status: "void",
      version: 3,
    },
  ],
};

describe("job contracts card", () => {
  it("shows every contract with who, scope, value and status, and links the job board", () => {
    const board =
      "https://app.meetathena.io/r/job/00000000-0000-4000-8000-000000000e20/field?t=" +
      "A".repeat(43);
    const card = jobContractsCard(payload, null, contractsBoardUrl(board));
    expect(card.title).toBe("Contracts");
    expect(card.job).toBe("2810 – Willow Creek");
    expect(card.kpis).toEqual([
      { label: "Prime contract", value: "$1,250,000.00" },
      { label: "Subcontracts and suppliers", value: "$84,000.00" },
      { label: "Signed", value: "1 of 2" },
    ]);
    const table = card.sections![0];
    expect(table.rows.map((r) => r.cells)).toEqual([
      ["Prime", "Willow Creek HOA", "", "00", "$1,250,000.00", "Signed 2026-10-01"],
      [
        "Subcontract",
        "Bright Wire Co",
        "Lighting rough-in",
        "26-0500",
        "$84,000.00",
        "Sent 2026-11-02",
      ],
      ["Supplier · PO PO-101", "Volt Supply", "", "", "$10,000.00", "Void"],
    ]);
    expect(card.sections![1].rows[0].href).toBe(
      `https://app.meetathena.io/r/job/00000000-0000-4000-8000-000000000e20/home?t=${"A".repeat(43)}#contracts`,
    );
    // No signed link (contract-only role): no board chip, never a tokenless link.
    expect(jobContractsCard(payload).sections).toHaveLength(1);
    expect(contractsBoardUrl(null)).toBeNull();
    expect(contractsBoardUrl("https://app.meetathena.io/r/job/j/field?x=1")).toBeNull();
    expect(renderMarkdown(card)).toContain("Bright Wire Co");
    expect(renderHtml(card)).not.toMatch(/#2465CB/i);
  });

  it("walks the member to the next step after a save", () => {
    const saved = {
      ...payload.contracts[1],
      cost_code: null,
      contract_id: "s1",
      changed: true,
      previous_status: null,
      status_changed: true,
    };
    expect(jobContractsCard(payload, saved).next_move).toBe(
      "Saved v1. Want to tag it to a cost code?",
    );
    expect(contractNextStep({ ...saved, cost_code: "26", status: "signed" })).toBe(
      "Upload the signed copy?",
    );
    expect(jobContractsCard({ ...payload, contracts: [] }).sections![0].rows[0].cells[0]).toBe(
      "No contracts on this job yet.",
    );
  });
});
