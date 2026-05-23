/**
 * Phase 3.2 — importer-owned capability metadata.
 *
 * Confirms:
 *   - deriveCapabilityMetadataFromXerImport produces deterministic per-flag
 *     PASS / BLOCK / UNKNOWN verdicts from importer signals.
 *   - attaching the metadata to a Schedule forces the engine selector to
 *     fall back to legacy via the eligibility evaluator.
 *   - UNKNOWN is treated as a blocker (conservative).
 */

import { describe, expect, it } from "vitest";
import type { Schedule } from "../types";
import {
  ENGINE2_VERSION,
  attachCapabilityMetadata,
  defaultCapabilityMetadata,
  deriveCapabilityMetadataFromXerImport,
  evaluateScheduleEligibility,
  formatCapabilityMetadata,
  projectCapabilityEligibility,
  runScheduleWithSelectedEngine,
  type CapabilityFlagId,
  type ScheduleCapabilityMetadata,
  type XerEngine2ImportResult,
  type EvidenceLog,
  type EvidenceLogEntry,
} from "../engine2";

const fixedClock = { now: () => "2026-05-23T00:00:00.000Z" };

function entry(p: Partial<EvidenceLogEntry>): EvidenceLogEntry {
  return {
    scheduleId: "x",
    scheduleName: "x",
    timestamp: fixedClock.now(),
    legacyEngineVersion: "legacy-1.x",
    engine2Version: ENGINE2_VERSION,
    calendarMode: "whole-day",
    verdict: "expected-differences",
    mismatchCount: 0,
    exactDateMatches: 0,
    classificationCounts: {},
    topDifferenceCategories: [],
    useExceptionAwareCalendars: false,
    boring: true,
    intent: "demo",
    ...p,
  };
}

function passingLog(): EvidenceLog {
  return { createdAt: fixedClock.now(), entries: [entry({})] };
}

function clean(): Schedule {
  return {
    name: "clean",
    projectStartDate: "2026-01-05",
    calendar: { workDays: 31, holidays: [] },
    tasks: [
      { id: "T1", name: "S", duration: 0 },
      { id: "T2", name: "M", duration: 5 },
      { id: "T3", name: "E", duration: 0 },
    ],
    dependencies: [
      { from: "T1", to: "T2", type: "FS", lag: 0 },
      { from: "T2", to: "T3", type: "FS", lag: 0 },
    ],
  };
}

function emptyXerResult(): XerEngine2ImportResult {
  return {
    projectName: "p",
    projects: [],
    calendars: [],
    defaultCalendarId: "cal-default",
    activities: [],
    activityProjectIds: {},
    relationships: [],
    interprojectRelationships: [],
    externalRelationships: [],
    resources: [],
    roles: [],
    assignments: [],
    diagnostics: [],
    raw: {
      projects: [],
      calendars: [],
      wbs: [],
      tasks: [],
      taskpred: [],
      resources: [],
      roles: [],
      taskrsrc: [],
      otherTableNames: [],
    },
    stats: {
      projectsParsed: 0,
      tasksParsed: 0,
      relationshipsParsed: 0,
      interprojectRelationshipsCount: 0,
      calendarsParsed: 0,
      resourcesParsed: 0,
      rolesParsed: 0,
      assignmentsParsed: 0,
      constraintsMapped: 0,
      constraintsUnsupported: 0,
      externalRelationshipsPreservedRaw: 0,
      externalProjectsMissingCount: 0,
    },
  };
}

function findFlag(meta: ScheduleCapabilityMetadata, id: CapabilityFlagId) {
  return meta.flags.find((f) => f.id === id)!;
}

// ---------------------------------------------------------------------------
// 1. Default metadata for in-app authored schedules
// ---------------------------------------------------------------------------

describe("defaultCapabilityMetadata", () => {
  it("returns source=default with every flag PASS", () => {
    const m = defaultCapabilityMetadata();
    expect(m.source).toBe("default");
    expect(m.flags.length).toBe(10);
    expect(m.flags.every((f) => f.verdict === "pass")).toBe(true);
  });

  it("projectCapabilityEligibility flags none as blocker", () => {
    const findings = projectCapabilityEligibility(defaultCapabilityMetadata());
    expect(findings.every((f) => !f.blocker)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. XER → capability metadata derivation
// ---------------------------------------------------------------------------

describe("deriveCapabilityMetadataFromXerImport", () => {
  it("clean import (no signals) keeps importer-owned flags PASS except baseline-assumed", () => {
    const meta = deriveCapabilityMetadataFromXerImport(emptyXerResult());
    expect(meta.source).toBe("xer");
    // Baseline is always BLOCK from XER (never carries a baseline).
    expect(findFlag(meta, "baseline-assumed").verdict).toBe("block");
    // Everything else passes on an empty import.
    for (const id of [
      "external-relationships",
      "interproject-relationships",
      "unsupported-constraints",
      "unsupported-percent-type",
      "unsupported-duration-type",
      "resource-loaded-imported",
      "leveling-required",
      "unknown-xer-semantics",
      "calendar-shifts",
    ] as CapabilityFlagId[]) {
      expect(findFlag(meta, id).verdict).toBe("pass");
    }
  });

  it("external relationships → BLOCK", () => {
    const r = emptyXerResult();
    r.stats.externalRelationshipsPreservedRaw = 3;
    r.stats.externalProjectsMissingCount = 1;
    const meta = deriveCapabilityMetadataFromXerImport(r);
    const f = findFlag(meta, "external-relationships");
    expect(f.verdict).toBe("block");
    expect(f.evidenceCount).toBeGreaterThan(0);
  });

  it("interproject relationships → BLOCK", () => {
    const r = emptyXerResult();
    r.stats.interprojectRelationshipsCount = 2;
    const meta = deriveCapabilityMetadataFromXerImport(r);
    expect(findFlag(meta, "interproject-relationships").verdict).toBe("block");
  });

  it("unsupported constraints → BLOCK", () => {
    const r = emptyXerResult();
    r.stats.constraintsUnsupported = 1;
    r.diagnostics.push({
      severity: "warn",
      code: "unsupported_constraint_type",
      message: "Activity X has constraint CSTR_FOO not mapped",
    });
    const meta = deriveCapabilityMetadataFromXerImport(r);
    expect(findFlag(meta, "unsupported-constraints").verdict).toBe("block");
  });

  it("unsupported percent-complete and duration types → BLOCK", () => {
    const r = emptyXerResult();
    r.diagnostics.push({
      severity: "warn",
      code: "unsupported_percent_complete_type_behavior",
      message: "weird pct",
    });
    r.diagnostics.push({
      severity: "warn",
      code: "unsupported_duration_type_behavior",
      message: "weird dur",
    });
    const meta = deriveCapabilityMetadataFromXerImport(r);
    expect(findFlag(meta, "unsupported-percent-type").verdict).toBe("block");
    expect(findFlag(meta, "unsupported-duration-type").verdict).toBe("block");
  });

  it("resource assignments → resource + leveling BLOCK", () => {
    const r = emptyXerResult();
    r.stats.resourcesParsed = 2;
    r.stats.assignmentsParsed = 5;
    const meta = deriveCapabilityMetadataFromXerImport(r);
    expect(findFlag(meta, "resource-loaded-imported").verdict).toBe("block");
    expect(findFlag(meta, "leveling-required").verdict).toBe("block");
  });

  it("calendar shifts diagnostic → BLOCK", () => {
    const r = emptyXerResult();
    r.diagnostics.push({
      severity: "warn",
      code: "unsupported_calendar_shift",
      message: "shift cal",
    });
    const meta = deriveCapabilityMetadataFromXerImport(r);
    expect(findFlag(meta, "calendar-shifts").verdict).toBe("block");
  });

  it("unmodeled XER tables → UNKNOWN", () => {
    const r = emptyXerResult();
    r.raw.otherTableNames = ["PROJCOST", "RISKTYPE"];
    const meta = deriveCapabilityMetadataFromXerImport(r);
    expect(findFlag(meta, "unknown-xer-semantics").verdict).toBe("unknown");
  });

  it("unmapped warn/error diagnostic escalates to UNKNOWN bucket", () => {
    const r = emptyXerResult();
    r.diagnostics.push({
      severity: "warn",
      code: "some_brand_new_signal_we_dont_know",
      message: "something weird in P6 XER",
    });
    const meta = deriveCapabilityMetadataFromXerImport(r);
    expect(findFlag(meta, "unknown-xer-semantics").verdict).toBe("unknown");
  });

  it("formatCapabilityMetadata is deterministic", () => {
    const r = emptyXerResult();
    r.stats.externalRelationshipsPreservedRaw = 1;
    const meta = deriveCapabilityMetadataFromXerImport(r, {
      derivedAt: fixedClock.now(),
    });
    expect(formatCapabilityMetadata(meta)).toBe(formatCapabilityMetadata(meta));
    expect(formatCapabilityMetadata(meta)).toContain("BLOCK");
  });
});

// ---------------------------------------------------------------------------
// 3. Eligibility consumes capability metadata
// ---------------------------------------------------------------------------

describe("schedule eligibility consumes capability metadata", () => {
  it("schedule without metadata behaves as defaults (importer-owned all PASS)", () => {
    const e = evaluateScheduleEligibility(clean());
    expect(e.eligible).toBe(true);
  });

  it("attached BLOCK metadata flips eligibility to false", () => {
    const meta = deriveCapabilityMetadataFromXerImport(
      (() => {
        const r = emptyXerResult();
        r.stats.externalRelationshipsPreservedRaw = 2;
        return r;
      })(),
    );
    const s = attachCapabilityMetadata(clean(), meta);
    const e = evaluateScheduleEligibility(s);
    expect(e.eligible).toBe(false);
    expect(e.blockers.length).toBeGreaterThan(0);
  });

  it("attached UNKNOWN metadata flips eligibility to false (conservative)", () => {
    const meta = deriveCapabilityMetadataFromXerImport(
      (() => {
        const r = emptyXerResult();
        r.raw.otherTableNames = ["MYSTERY_TABLE"];
        return r;
      })(),
    );
    const s = attachCapabilityMetadata(clean(), meta);
    const e = evaluateScheduleEligibility(s);
    expect(e.eligible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Selector forces fallback on imported unsupported features
// ---------------------------------------------------------------------------

describe("selector — imported unsupported features force legacy fallback", () => {
  function runWith(s: Schedule) {
    return runScheduleWithSelectedEngine(s, {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      forcePastReadinessGate: true,
      clock: fixedClock,
    });
  }

  it("external relationships from XER block engine2 selection", () => {
    const r = emptyXerResult();
    r.stats.externalRelationshipsPreservedRaw = 1;
    const s = attachCapabilityMetadata(clean(), deriveCapabilityMetadataFromXerImport(r));
    const out = runWith(s);
    expect(out.provenance.engineUsed).toBe("legacy");
    expect(out.provenance.fallbackUsed).toBe(true);
    expect(out.provenance.scheduleEligible).toBe(false);
  });

  it("unsupported constraints from XER block engine2 selection", () => {
    const r = emptyXerResult();
    r.stats.constraintsUnsupported = 1;
    const s = attachCapabilityMetadata(clean(), deriveCapabilityMetadataFromXerImport(r));
    const out = runWith(s);
    expect(out.provenance.engineUsed).toBe("legacy");
    expect(out.provenance.eligibilityBlockers.length).toBeGreaterThan(0);
  });

  it("UNKNOWN xer semantics block engine2 selection", () => {
    const r = emptyXerResult();
    r.raw.otherTableNames = ["NEW_TABLE"];
    const s = attachCapabilityMetadata(clean(), deriveCapabilityMetadataFromXerImport(r));
    const out = runWith(s);
    expect(out.provenance.engineUsed).toBe("legacy");
    expect(out.provenance.fallbackUsed).toBe(true);
  });

  it("eligibility blocker from metadata cannot be bypassed by forcePastReadinessGate", () => {
    const r = emptyXerResult();
    r.stats.externalRelationshipsPreservedRaw = 1;
    const s = attachCapabilityMetadata(clean(), deriveCapabilityMetadataFromXerImport(r));
    const out = runScheduleWithSelectedEngine(s, {
      mode: "engine2-internal",
      evidenceLog: passingLog(),
      forcePastReadinessGate: true,
      clock: fixedClock,
    });
    expect(out.provenance.engineUsed).toBe("legacy");
  });
});
