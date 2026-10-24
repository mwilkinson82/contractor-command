import { describe, it, expect } from "vitest";
import { parseState } from "../estimating";
import {
  measurementLines,
  measurementStatus,
  verifiedLines,
  type EngineSnapshot,
  type GeometryRevision,
} from "./state";
import { measuredSettlement, measurementExport } from "./integration";
const base = (): EngineSnapshot =>
  ({
    available: true,
    takeoff_version: 1,
    lines: [
      {
        id: "line",
        takeoff_id: "takeoff",
        line_no: 1,
        item: "Fixtures",
        qty: 999,
        unit: "EA",
        basis: "measured",
        sheet: "E-100",
        confidence: "high",
        inputs: [],
        math: "Historical supplied quantity",
      },
    ],
    calibrations: [],
    geometry: [],
    passes: [],
  }) as unknown as EngineSnapshot;
const row = (
  geometry_id: string,
  measured: number,
  status: "accepted" | "proposed" = "accepted",
): GeometryRevision => ({
  id: geometry_id + "-revision",
  geometry_id,
  version: 2,
  line_id: "line",
  source_id: "source",
  page: 1,
  calibration_id: null,
  shape: { kind: "pins", points: [{ x: 0.2, y: 0.2 }] },
  measured,
  unit: "EA",
  status,
  source: "estimator",
  reason: null,
  created_by: "actor",
  created_at: "2026-10-23",
  evidence: {},
});
describe("quantity and final-bid gates", () => {
  it("leaves legacy typed quantities unlocated and unpriceable", () => {
    const state = base();
    expect(measurementStatus(state).settled).toBe(false);
    expect(verifiedLines(state.lines, state)[0].qty).toBeNull();
  });
  it("shows the full proposed total beside the last accepted total", () => {
    const state = base();
    state.geometry = [row("a", 3), row("b", 2, "proposed")];
    state.accepted_history = [row("b", 1)];
    const line = measurementLines(state)[0];
    expect(line.accepted).toBe(4);
    expect(line.proposed).toBe(5);
    expect(measurementStatus(state).settled).toBe(false);
  });
  it("invalidates a changed original or a changed depth source, without calling its old value a new proposal", () => {
    const state = base();
    state.geometry = [row("a", 3)];
    state.sources = [{ id: "source", stale: true }];
    expect(measurementLines(state)[0].status).toBe("proposed");
    expect(measurementLines(state)[0].proposed).toBeNull();
    state.geometry[0].shape = {
      kind: "rect",
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      depth: { source_id: "depth", sheet: "S-200", detail: "Section", value: 6, unit: "in" },
    };
    state.sources = [
      { id: "source", stale: false },
      { id: "depth", stale: true },
    ];
    expect(measurementStatus(state).settled).toBe(false);
  });
  it("never lets an old typed verdict correction override a measured quantity", () => {
    const state = base();
    state.geometry = [row("a", 3)];
    const loaded = parseState({
      takeoff: { version: 1, lines: state.lines },
      verdicts: [
        {
          item_kind: "line",
          line_no: 1,
          item_text: "Fixtures",
          mark: "relevant",
          corrected_qty: 100000,
          created_at: "2026-10-23",
        },
      ],
    });
    expect(measuredSettlement(loaded, state).items[0].qty).toBe(3);
  });
  it("requires both a non-drawable basis and a known quantity unless it is by others", () => {
    const state = base();
    state.lines[0].qty = 999;
    state.geometry = [
      {
        ...row("exception", 0),
        status: "not_drawable",
        shape: { kind: "not_drawable", exception_kind: "allowance" },
        reason: "Allowance basis from specification",
      },
    ];
    expect(measurementStatus(state).settled).toBe(false);
    state.geometry[0].shape = {
      kind: "not_drawable",
      exception_kind: "allowance",
      quantity: 12,
      unit: "EA",
    };
    expect(measurementStatus(state).settled).toBe(true);
    expect(verifiedLines(state.lines, state)[0].qty).toBe(12);
    state.geometry[0].shape = { kind: "not_drawable", exception_kind: "by_others" };
    expect(measurementStatus(state).settled).toBe(true);
    expect(verifiedLines(state.lines, state)[0].qty).toBe(0);
  });
  it("preserves a reasoned scope exclusion from the existing estimator marks", () => {
    const state = base();
    state.lines[0].qty = null;
    state.verdicts = [
      {
        item_kind: "line",
        line_no: 1,
        item_text: "Fixtures",
        mark: "not_relevant",
        note: "Not in this bid scope per estimator review",
        created_at: "2026-10-23",
      },
    ] as EngineSnapshot["verdicts"];
    expect(measurementStatus(state).settled).toBe(true);
    expect(measurementLines(state)[0].exception_kind).toBe("excluded");
    expect(verifiedLines(state.lines, state)[0].qty).toBe(0);
  });
  it("exports the actual measured value, geometry references, status and sheet PNG link", () => {
    const state = base();
    state.geometry = [row("a", 3)];
    const exported = measurementExport("Fictional", state.lines, state, "workbook", {
      "source:1": "https://files.example.com/sheet.png",
    });
    expect(exported.structured.csv).toContain('"3"');
    expect(exported.structured.csv).not.toContain("999");
    expect(exported.structured.csv).toContain("a-revision");
    expect(exported.structured.csv).toContain("sheet.png");
  });
});
