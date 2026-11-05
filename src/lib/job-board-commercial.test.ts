import { describe, expect, it } from "vitest";
import {
  cleanTitle,
  commercialNextStep,
  contractsOverview,
  estimateOverview,
  gbbOverview,
  jobStage,
} from "./job-board-commercial";
import { willowCreekTypeE } from "./selections/__fixtures__/willow-creek-type-e";

const line = (n: number, extra: Record<string, unknown> = {}) => ({
  line_no: n,
  item: `Line ${n}`,
  qty: 10,
  unit: "EA",
  sheet: "E1",
  ...extra,
});

describe("estimate on the job board", () => {
  it("shows a job with no estimate as not started, with the drawings as the next step", () => {
    const e = estimateOverview({ scope: "full", setup: null, takeoff: null, gaps: [], verdicts: [] }, null, []);
    expect(e.started).toBe(false);
    expect(e.status.label).toBe("Not started");
    const step = commercialNextStep({ jobNumber: "2830", estimate: e, gbb: null, contracts: null, contracted: false });
    expect(step?.title).toMatch(/add the drawings/);
    expect(step?.ask).toContain("2830");
  });

  it("counts lines, missing quantities, open questions and priced lines", () => {
    const e = estimateOverview(
      {
        setup: { role: "self_performer", trades: ["Electrical"], bid_due: "2026-11-20", documents: [{ name: "26097E.pdf", kind: "base" }] },
        takeoff: {
          version: 2,
          revision: "IFC",
          lines: [line(1), line(2, { qty: null, missing_input: "No ceiling height" }), line(3, { exclusion: "By others" })],
        },
        gaps: [
          { ref: "G-1", holds_bid: true, severity: "hard" },
          { ref: "G-2", holds_bid: false, severity: "soft" },
        ],
        verdicts: [{ item_kind: "gap", gap_ref: "G-2" }],
      },
      { pricing: { labor: [{ ref: "T-1" }], material: [{ ref: "T-1" }, { ref: "T-2" }] }, bid: { overhead_pct: 10, profit_pct: 8 } },
      [{ id: "x1", sheet: "E1", page: 1, source_filename: "26097E.pdf", rendered_pdf: "a/b.pdf", created_at: "2026-10-31T12:00:00Z" }],
    );
    expect(e).toMatchObject({
      started: true,
      takeoffVersion: 2,
      role: "Self-perform",
      lines: 3,
      withQuantity: 2,
      missingInput: 1,
      excluded: 1,
      openQuestions: 1,
      holdingBid: 1,
      pricedLines: 2,
      overheadPct: 10,
      profitPct: 8,
      drawings: ["26097E.pdf"],
    });
    expect(e.files[0]).toMatchObject({ id: "x1", label: "E1 measured takeoff", path: "a/b.pdf" });
    expect(e.status.label).toBe("In progress");
    const step = commercialNextStep({ jobNumber: "2810", estimate: e, gbb: null, contracts: null, contracted: false });
    expect(step?.title).toBe("Settle the takeoff: 2 open items");
  });

  it("survives an unavailable read", () => {
    const e = estimateOverview(null, null, null);
    expect(e.started).toBe(false);
    expect(e.files).toEqual([]);
  });
});

describe("Good, Better, Best on the job board", () => {
  it("drops test labels from a title a member would see", () => {
    expect(cleanTitle("Track lighting options (TEST)")).toBe("Track lighting options");
    expect(cleanTitle("Lighting [test] upgrades")).toBe("Lighting upgrades");
    expect(cleanTitle("Kitchen - test")).toBe("Kitchen");
    expect(cleanTitle("Contest lighting")).toBe("Contest lighting");
  });

  it("reads totals, time and status from the saved board", () => {
    const board = willowCreekTypeE();
    const g = gbbOverview({ version: 4, board, updated_at: "2026-11-04T00:00:00Z", scope: "full" }, false);
    expect(g?.exists).toBe(true);
    expect(g?.selections).toBe(board.selections.length);
    expect(g?.totals.good).not.toBeNull();
    expect(g?.time.good).toBe("No added time");
    expect(g?.underContract).toBe(false);
    expect(["Draft", "Ready, not chosen yet"]).toContain(g?.status.label);
  });

  it("returns nothing for a shape it doesn't know, so the board never shows a guess", () => {
    expect(gbbOverview({ version: 1, board: { nope: true } }, false)).toBeNull();
    expect(gbbOverview(null, false)).toBeNull();
  });
});

describe("contracts on the job board", () => {
  const po = {
    orders: [
      {
        id: "po1",
        number: "WC-2810-PO01",
        versions: [
          { version: 1, status: "draft", party_snapshot: { name: "Old", kind: "supplier" }, lines: [] },
          {
            version: 2,
            status: "draft",
            party_snapshot: { name: "Summit Electrical Supply", kind: "supplier", trade: "Electrical materials", contract_reference: "WC-2810-MAT" },
            lines: [
              { quantity: 4000, unit_price_cents: 200 },
              { quantity: 200, unit_price_cents: 2200 },
            ],
          },
        ],
      },
    ],
  };

  it("shows the job setup value as the prime when no contract is recorded, and the PO", () => {
    const c = contractsOverview(null, po, 480000);
    expect(c.recordAvailable).toBe(false);
    expect(c.rows.map((r) => [r.kind, r.with, r.valueCents])).toEqual([
      ["prime", "Your client", 48_000_000],
      ["supplier", "Summit Electrical Supply", 1_240_000],
    ]);
    expect(c.rows[1].status.label).toBe("Draft · version 2");
    expect(c.draftPos).toBe(1);
    const step = commercialNextStep({ jobNumber: "2810", estimate: null, gbb: null, contracts: c, contracted: true });
    expect(step?.title).toBe("Save the signed prime contract on this job");
  });

  it("uses recorded contracts, and doesn't list a PO twice when a contract points at it", () => {
    const c = contractsOverview(
      {
        contracts: [
          { id: "c1", kind: "prime", counterparty: "Willow Creek Owners LLC", value_cents: 48_000_000, status: "signed", document_id: "d1", signed_on: "2026-10-01" },
          { id: "c2", kind: "subcontract", counterparty: "Bright Lines Low Voltage", tag: "Low voltage", value_cents: 3_100_000, status: "sent" },
          { id: "c3", kind: "supplier", counterparty: "Summit Electrical Supply", value_cents: 1_240_000, status: "draft", po_id: "po1" },
          { id: "c4", kind: "wrong" },
        ],
      },
      po,
      480000,
    );
    expect(c.recordAvailable).toBe(true);
    expect(c.rows.map((r) => r.key)).toEqual(["c:c1", "c:c2", "c:c3"]);
    expect(c.rows[0].signedCopy).toBe("Signed copy saved");
    expect(c.outForSignature).toBe(1);
    expect(c.totals.subcontract).toBe(3_100_000);
  });

  it("leaves a PO value unknown when a line has no price", () => {
    const c = contractsOverview(null, { orders: [{ id: "p", versions: [{ version: 1, status: "draft", lines: [{ quantity: 1, unit_price_cents: null }] }] }] }, null);
    expect(c.rows[0].valueCents).toBeNull();
  });
});

describe("job stage", () => {
  it("is inferred from saved records", () => {
    expect(jobStage({ contracted: false, fieldStarted: false, proposalReady: false })).toBe(0);
    expect(jobStage({ contracted: false, fieldStarted: false, proposalReady: true })).toBe(1);
    expect(jobStage({ contracted: true, fieldStarted: false, proposalReady: false })).toBe(2);
    expect(jobStage({ contracted: true, fieldStarted: true, proposalReady: false })).toBe(3);
  });
});
