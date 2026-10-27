import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CpmGrid } from "./CpmGrid";
import {
  buildCpmRows,
  cpmProgress,
  CPM_ACTUAL,
  CPM_CRITICAL,
  CPM_REMAINING,
} from "./cpm-presentation";
import type { ScheduleResult, ScheduledTask } from "@/lib/scheduler/types";
import type { WbsNode } from "@/lib/scheduler/structure.functions";

const task = (
  id: string,
  percentComplete: number,
  isCritical: boolean,
  wbs?: string,
): ScheduledTask => ({
  id,
  name: id,
  duration: 10,
  percentComplete,
  isCritical,
  wbs,
  earlyStart: 0,
  earlyFinish: 10,
  lateStart: 0,
  lateFinish: 10,
  totalFloat: isCritical ? 0 : 2,
  freeFloat: 0,
});
const nodes: WbsNode[] = [
  { id: "root", parentId: null, code: "1", name: "Building", position: 0 },
  { id: "child", parentId: "root", code: "1.1", name: "Foundation", position: 0 },
  { id: "grandchild", parentId: "child", code: "1.1.1", name: "Footings", position: 0 },
];
const result = (tasks: ScheduledTask[]): ScheduleResult => ({
  name: "QA",
  projectStartDate: "2026-01-05",
  projectDuration: 10,
  tasks,
  dependencies: [
    { id: "dep", from: tasks[0].id, to: tasks[1].id, type: "FS", lag: 0, isDriving: true },
  ],
  criticalPath: [],
  diagnostics: [],
});

describe("CPM presentation", () => {
  it("renders reported progress and criticality independently of the data date", () => {
    const tasks = [
      task("unstarted", 0, false),
      task("critical", 0, true),
      task("partial", 30, false),
      task("partial-critical", 70, true),
      task("complete", 100, true),
    ];
    const schedule = result(tasks);
    const original = JSON.stringify(schedule);
    for (const dataDate of [undefined, "2025-12-01", "2026-01-09", "2027-01-01"]) {
      const html = renderToStaticMarkup(
        createElement(CpmGrid, {
          result: schedule,
          selectedId: null,
          onSelect: () => {},
          dataDate,
        }),
      );
      expect(html.match(new RegExp(`fill="${CPM_ACTUAL}"`, "g"))?.length).toBe(3);
      expect(html.match(new RegExp(`fill="${CPM_REMAINING}"`, "g"))?.length).toBe(2);
      expect(html.match(new RegExp(`fill="${CPM_CRITICAL}"`, "g"))?.length).toBe(2);
      expect(html).toContain('width="24"'); // 30% of a 10-day bar at 8px/day
      expect(html).toContain('width="56"');
      expect(html).toContain('marker-end="url(#cpm-arrow-drv)"');
    }
    const hidden = renderToStaticMarkup(
      createElement(CpmGrid, {
        result: schedule,
        selectedId: null,
        onSelect: () => {},
        showLogicLines: false,
      }),
    );
    expect(hidden).not.toContain('marker-end="url(#cpm-arrow-drv)"');
    expect(JSON.stringify(schedule)).toBe(original);
  });
  it("clamps invalid progress and colors completed milestones blue", () => {
    expect([cpmProgress(-5), cpmProgress(150), cpmProgress(NaN), cpmProgress(undefined)]).toEqual([
      0, 100, 0, 0,
    ]);
    const milestones = [task("a", 100, true), task("b", 0, false)].map((t) => ({
      ...t,
      duration: 0,
    }));
    const html = renderToStaticMarkup(
      createElement(CpmGrid, { result: result(milestones), selectedId: null, onSelect: () => {} }),
    );
    expect(html).toContain(`fill="${CPM_ACTUAL}"`);
    expect(html).toContain(`fill="${CPM_REMAINING}"`);
  });
  it("uses existing parent links, includes ancestors and collapses descendants", () => {
    const tasks = [task("a", 0, false, "1.1.1 · Footings"), task("b", 0, true, "1 · Building")];
    const rows = buildCpmRows(tasks, "wbs", nodes);
    expect(
      rows.map((r) =>
        r.kind === "group" ? [r.label, r.depth, r.taskCount] : [r.task.id, r.depth],
      ),
    ).toEqual([
      ["1 · Building", 0, 2],
      ["b", 1],
      ["1.1 · Foundation", 1, 1],
      ["1.1.1 · Footings", 2, 1],
      ["a", 3],
    ]);
    expect(
      buildCpmRows(tasks, "wbs", nodes, new Set(["wbs:child"])).map((r) =>
        r.kind === "group" ? r.label : r.task.id,
      ),
    ).toEqual(["1 · Building", "b", "1.1 · Foundation"]);
  });
  it("keeps free text, absent, ambiguous and invalid WBS flat without inferring parents", () => {
    const tasks = [
      task("a", 0, false, "1.1 · Foundation"),
      task("b", 0, false),
      task("c", 0, false, "2.1 · Free"),
    ];
    expect(
      buildCpmRows(tasks, "wbs", [])
        .filter((r) => r.kind === "group")
        .map((r) => r.label),
    ).toEqual(["1.1 · Foundation", "2.1 · Free", "Unassigned"]);
    const duplicate = [...nodes, { ...nodes[1], id: "duplicate" }];
    expect(
      buildCpmRows(tasks, "wbs", duplicate)
        .filter((r) => r.kind === "group")
        .map((r) => r.label),
    ).toEqual(["1.1 · Foundation", "2.1 · Free", "Unassigned"]);
    const orphan = [{ ...nodes[1], parentId: "missing" }];
    expect(buildCpmRows(tasks, "wbs", orphan).find((r) => r.kind === "group")?.key).toBe(
      "flat:1.1 · Foundation",
    );
  });
});
