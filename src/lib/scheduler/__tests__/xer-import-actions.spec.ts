/**
 * Phase 2.0 — XER import action semantics.
 *
 * Covers Create / Update / Replace / Add-Into behavior plus
 * delete-unreferenced options, collision diagnostics, and dry-run plans.
 * Operates entirely on `XerEngine2ImportResult` shapes; no UI wiring.
 */

import { describe, expect, it } from "vitest";
import {
  applyImportAction,
  importXerForEngine2,
  planImportAction,
  type XerEngine2ImportResult,
} from "../engine2";

// ---------------------------------------------------------------------------
// Tiny XER builder
// ---------------------------------------------------------------------------

function buildXer(opts: {
  projectId: string;
  tasks: Array<{
    id: string;
    code: string;
    name?: string;
    durHr?: number;
    remainHr?: number;
  }>;
  preds?: Array<{ from: string; to: string; type?: string; lagHr?: number }>;
  assignments?: Array<{
    id: string;
    taskId: string;
    rsrcId: string;
    targetQty?: number;
  }>;
  rsrc?: Array<{ id: string; name: string }>;
}): string {
  const lines: string[] = ["ERMHDR\t6.2"];
  lines.push("%T\tPROJECT");
  lines.push("%F\tproj_id\tproj_short_name\tproj_name\tplan_start_date\tlast_recalc_date");
  lines.push(
    `%R\t${opts.projectId}\t${opts.projectId}\t${opts.projectId}\t2025-01-06 08:00\t2025-01-06 08:00`,
  );
  lines.push("%T\tCALENDAR");
  lines.push("%F\tclndr_id\tclndr_name\tday_hr_cnt\tclndr_data");
  lines.push("%R\tCAL1\tStandard 5d\t8\t");
  if (opts.rsrc && opts.rsrc.length) {
    lines.push("%T\tRSRC");
    lines.push("%F\trsrc_id\trsrc_name\trsrc_type\tclndr_id");
    for (const r of opts.rsrc) lines.push(`%R\t${r.id}\t${r.name}\tRT_Labor\tCAL1`);
  }
  lines.push("%T\tTASK");
  lines.push(
    "%F\ttask_id\tproj_id\ttask_code\ttask_name\tclndr_id\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt",
  );
  for (const t of opts.tasks) {
    lines.push(
      `%R\t${t.id}\t${opts.projectId}\t${t.code}\t${t.name ?? t.code}\tCAL1\t${t.durHr ?? 8}\t${t.remainHr ?? t.durHr ?? 8}`,
    );
  }
  if (opts.preds && opts.preds.length) {
    lines.push("%T\tTASKPRED");
    lines.push("%F\ttask_id\tproj_id\tpred_task_id\tpred_proj_id\tpred_type\tlag_hr_cnt");
    for (const p of opts.preds) {
      lines.push(
        `%R\t${p.to}\t${opts.projectId}\t${p.from}\t${opts.projectId}\t${p.type ?? "PR_FS"}\t${p.lagHr ?? 0}`,
      );
    }
  }
  if (opts.assignments && opts.assignments.length) {
    lines.push("%T\tTASKRSRC");
    lines.push(
      "%F\ttaskrsrc_id\ttask_id\trsrc_id\ttarget_qty\tact_reg_qty\tremain_qty\ttarget_cost\tact_reg_cost\tremain_cost",
    );
    for (const a of opts.assignments) {
      lines.push(
        `%R\t${a.id}\t${a.taskId}\t${a.rsrcId}\t${a.targetQty ?? 8}\t0\t${a.targetQty ?? 8}\t0\t0\t0`,
      );
    }
  }
  lines.push("%E");
  return lines.join("\n");
}

function importIt(xer: string): XerEngine2ImportResult {
  return importXerForEngine2(xer);
}

// ---------------------------------------------------------------------------
// create-new-project
// ---------------------------------------------------------------------------

describe("Phase 2.0 — create-new-project", () => {
  it("creates entries for every imported activity/relationship/assignment", () => {
    const incoming = importIt(
      buildXer({
        projectId: "P1",
        tasks: [
          { id: "1", code: "A" },
          { id: "2", code: "B" },
        ],
        preds: [{ from: "1", to: "2" }],
        rsrc: [{ id: "R1", name: "Crew" }],
        assignments: [{ id: "TA1", taskId: "1", rsrcId: "R1" }],
      }),
    );
    const result = applyImportAction({
      incoming,
      options: { action: "create-new-project", targetProjectId: "P1" },
    });
    expect(result.ok).toBe(true);
    expect(result.plan.summary.create).toBeGreaterThan(0);
    expect(result.state.activities.map((a) => a.id).sort()).toEqual(["A", "B"]);
    expect(result.state.relationships).toHaveLength(1);
    expect(result.state.assignments).toHaveLength(1);
    expect(
      result.diagnostics.some((d) => d.code === "import_action_applied"),
    ).toBe(true);
  });

  it("blocks with a critical error when the project id already exists", () => {
    const seedXer = buildXer({ projectId: "P1", tasks: [{ id: "1", code: "A" }] });
    const seed = applyImportAction({
      incoming: importIt(seedXer),
      options: { action: "create-new-project", targetProjectId: "P1" },
    });
    const incoming = importIt(seedXer);
    const plan = planImportAction({
      existing: seed.state,
      incoming,
      options: { action: "create-new-project", targetProjectId: "P1" },
    });
    expect(plan.criticalErrors.some((e) => e.code === "import_collision_project_id")).toBe(true);

    const applied = applyImportAction({
      existing: seed.state,
      incoming,
      options: { action: "create-new-project", targetProjectId: "P1" },
    });
    expect(applied.ok).toBe(false);
    expect(applied.state).toBe(seed.state); // untouched (no partial commit)
  });
});

// ---------------------------------------------------------------------------
// update-existing-project
// ---------------------------------------------------------------------------

describe("Phase 2.0 — update-existing-project", () => {
  function seed() {
    const xer = buildXer({
      projectId: "P1",
      tasks: [
        { id: "1", code: "A", durHr: 16 },
        { id: "2", code: "B", durHr: 16 },
        { id: "3", code: "C", durHr: 16 },
      ],
      preds: [
        { from: "1", to: "2" },
        { from: "2", to: "3" },
      ],
      assignments: [
        { id: "TA1", taskId: "1", rsrcId: "R1", targetQty: 8 },
        { id: "TA2", taskId: "2", rsrcId: "R1", targetQty: 8 },
      ],
      rsrc: [{ id: "R1", name: "Crew" }],
    });
    return applyImportAction({
      incoming: importIt(xer),
      options: { action: "create-new-project", targetProjectId: "P1" },
    }).state;
  }

  it("updates changed activities, preserves untouched ones, adds new ones", () => {
    const base = seed();
    // Incoming: A duration changed, B unchanged, C removed (no longer in incoming),
    // D is new.
    const incoming = importIt(
      buildXer({
        projectId: "P1",
        tasks: [
          { id: "1", code: "A", durHr: 24 }, // changed
          { id: "2", code: "B", durHr: 16 }, // unchanged
          { id: "4", code: "D", durHr: 8 }, // new
        ],
        preds: [{ from: "1", to: "2" }],
      }),
    );
    const plan = planImportAction({
      existing: base,
      incoming,
      options: { action: "update-existing-project", targetProjectId: "P1" },
    });
    const kindsBySubject = (subject: string) =>
      plan.entries.filter((e) => e.subject === subject).map((e) => `${e.kind}:${e.id}`);
    expect(kindsBySubject("activity")).toEqual(
      expect.arrayContaining(["update:A", "preserve:B", "create:D", "preserve:C"]),
    );

    const applied = applyImportAction({
      existing: base,
      incoming,
      options: { action: "update-existing-project", targetProjectId: "P1" },
    });
    expect(applied.ok).toBe(true);
    const byId = new Map(applied.state.activities.map((a) => [a.id, a]));
    expect(byId.get("A")?.originalDuration.minutes).toBe(24 * 60);
    expect(byId.get("B")?.originalDuration.minutes).toBe(16 * 60);
    expect(byId.has("C")).toBe(true); // preserved when delete-unreferenced=false
    expect(byId.has("D")).toBe(true);
  });

  it("delete-unreferenced removes activities/relationships/assignments not in incoming", () => {
    const base = seed();
    const incoming = importIt(
      buildXer({
        projectId: "P1",
        tasks: [{ id: "1", code: "A", durHr: 16 }],
      }),
    );
    const applied = applyImportAction({
      existing: base,
      incoming,
      options: {
        action: "update-existing-project",
        targetProjectId: "P1",
        deleteUnreferenced: {
          activities: true,
          relationships: true,
          assignments: true,
        },
      },
    });
    expect(applied.ok).toBe(true);
    expect(applied.state.activities.map((a) => a.id)).toEqual(["A"]);
    expect(applied.state.relationships).toHaveLength(0);
    expect(applied.state.assignments).toHaveLength(0);
    expect(applied.plan.summary.delete).toBeGreaterThan(0);
  });

  it("preserves activities/relationships/assignments when delete-unreferenced is off", () => {
    const base = seed();
    const incoming = importIt(
      buildXer({ projectId: "P1", tasks: [{ id: "1", code: "A", durHr: 16 }] }),
    );
    const applied = applyImportAction({
      existing: base,
      incoming,
      options: { action: "update-existing-project", targetProjectId: "P1" },
    });
    expect(applied.state.activities.map((a) => a.id).sort()).toEqual(["A", "B", "C"]);
    expect(applied.state.relationships).toHaveLength(2);
    expect(applied.state.assignments).toHaveLength(2);
  });

  it("emits a critical error and aborts when target project is missing", () => {
    const base = seed();
    const incoming = importIt(
      buildXer({ projectId: "PX", tasks: [{ id: "1", code: "A" }] }),
    );
    const applied = applyImportAction({
      existing: base,
      incoming,
      options: { action: "update-existing-project", targetProjectId: "PX" },
    });
    expect(applied.ok).toBe(false);
    expect(applied.state).toBe(base);
    expect(
      applied.plan.criticalErrors.some((e) => e.code === "import_target_project_missing"),
    ).toBe(true);
  });

  it("flags unsupported delete-unreferenced categories (calendars/resources/roles)", () => {
    const base = seed();
    const incoming = importIt(
      buildXer({ projectId: "P1", tasks: [{ id: "1", code: "A", durHr: 16 }] }),
    );
    const plan = planImportAction({
      existing: base,
      incoming,
      options: {
        action: "update-existing-project",
        targetProjectId: "P1",
        deleteUnreferenced: { calendars: true, resources: true, roles: true },
      },
    });
    expect(plan.unsupportedPreservedOnly).toHaveLength(3);
    for (const d of plan.unsupportedPreservedOnly) {
      expect(d.code).toBe("delete_unreferenced_category_unsupported");
    }
  });
});

// ---------------------------------------------------------------------------
// replace-existing-project
// ---------------------------------------------------------------------------

describe("Phase 2.0 — replace-existing-project", () => {
  it("removes the old project graph and rebuilds from incoming, no orphans", () => {
    const baseState = applyImportAction({
      incoming: importIt(
        buildXer({
          projectId: "P1",
          tasks: [
            { id: "1", code: "A" },
            { id: "2", code: "B" },
            { id: "3", code: "C" },
          ],
          preds: [
            { from: "1", to: "2" },
            { from: "2", to: "3" },
          ],
        }),
      ),
      options: { action: "create-new-project", targetProjectId: "P1" },
    }).state;

    const incoming = importIt(
      buildXer({
        projectId: "P1",
        tasks: [
          { id: "10", code: "X" },
          { id: "20", code: "Y" },
        ],
        preds: [{ from: "10", to: "20" }],
      }),
    );

    const applied = applyImportAction({
      existing: baseState,
      incoming,
      options: { action: "replace-existing-project", targetProjectId: "P1" },
    });
    expect(applied.ok).toBe(true);
    expect(applied.state.activities.map((a) => a.id).sort()).toEqual(["X", "Y"]);
    expect(applied.state.relationships).toHaveLength(1);
    // No orphan project-id mappings.
    for (const id of Object.keys(applied.state.activityProjectIds)) {
      expect(applied.state.activities.some((a) => a.id === id)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// add-into-existing-project
// ---------------------------------------------------------------------------

describe("Phase 2.0 — add-into-existing-project", () => {
  it("merges new activities and emits collision diagnostic on duplicates", () => {
    const baseState = applyImportAction({
      incoming: importIt(
        buildXer({
          projectId: "P1",
          tasks: [
            { id: "1", code: "A" },
            { id: "2", code: "B" },
          ],
        }),
      ),
      options: { action: "create-new-project", targetProjectId: "P1" },
    }).state;

    const incoming = importIt(
      buildXer({
        projectId: "P1",
        tasks: [
          { id: "2", code: "B" }, // collision
          { id: "3", code: "C" }, // new
        ],
      }),
    );

    const applied = applyImportAction({
      existing: baseState,
      incoming,
      options: { action: "add-into-existing-project", targetProjectId: "P1" },
    });
    expect(applied.ok).toBe(true);
    expect(applied.state.activities.map((a) => a.id).sort()).toEqual(["A", "B", "C"]);
    expect(
      applied.plan.diagnostics.some((d) => d.code === "activity_id_collision"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Transactional safety
// ---------------------------------------------------------------------------

describe("Phase 2.0 — transactional plan/apply safety", () => {
  it("planImportAction never mutates input state", () => {
    const baseState = applyImportAction({
      incoming: importIt(
        buildXer({ projectId: "P1", tasks: [{ id: "1", code: "A", durHr: 16 }] }),
      ),
      options: { action: "create-new-project", targetProjectId: "P1" },
    }).state;
    const snapshot = JSON.stringify({
      activities: baseState.activities,
      relationships: baseState.relationships,
      assignments: baseState.assignments,
      projects: baseState.projects,
      activityProjectIds: baseState.activityProjectIds,
    });

    planImportAction({
      existing: baseState,
      incoming: importIt(
        buildXer({ projectId: "P1", tasks: [{ id: "1", code: "A", durHr: 999 }] }),
      ),
      options: {
        action: "update-existing-project",
        targetProjectId: "P1",
        deleteUnreferenced: { activities: true, relationships: true, assignments: true },
      },
    });

    expect(
      JSON.stringify({
        activities: baseState.activities,
        relationships: baseState.relationships,
        assignments: baseState.assignments,
        projects: baseState.projects,
        activityProjectIds: baseState.activityProjectIds,
      }),
    ).toEqual(snapshot);
  });

  it("aborted apply does not mutate existing state and reports partial-commit-safe", () => {
    const baseState = applyImportAction({
      incoming: importIt(
        buildXer({ projectId: "P1", tasks: [{ id: "1", code: "A" }] }),
      ),
      options: { action: "create-new-project", targetProjectId: "P1" },
    }).state;
    const applied = applyImportAction({
      existing: baseState,
      incoming: importIt(
        buildXer({ projectId: "PX", tasks: [{ id: "1", code: "A" }] }),
      ),
      options: { action: "update-existing-project", targetProjectId: "PX" },
    });
    expect(applied.ok).toBe(false);
    expect(applied.state).toBe(baseState);
    expect(applied.plan.transactional).toBe(true);
    expect(
      applied.diagnostics.some((d) => d.code === "import_action_aborted"),
    ).toBe(true);
  });
});
