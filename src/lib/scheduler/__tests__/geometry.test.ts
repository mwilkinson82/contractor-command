/**
 * Schedule geometry regression tests.
 *
 * Locks down horizontal layout math across the four states that have
 * regressed visually in prior passes:
 *   - inspector expanded vs collapsed
 *   - focus mode on vs off
 *   - sidebar expanded vs collapsed
 *   - mobile (<768px) viewport
 *
 * If any geometry constant changes (sidebar width, inspector width, sticky
 * table width, fit-zoom clamp, fit-zoom padding) these snapshots will fail
 * and force a deliberate review of the layout contract.
 */

import { describe, expect, it } from "vitest";
import {
  APP_SIDEBAR_COLLAPSED_W,
  APP_SIDEBAR_EXPANDED_W,
  APP_SIDEBAR_FOCUS_W,
  APP_SIDEBAR_MOBILE_W,
  FIT_AVAILABLE_PADDING,
  FIT_DAYPX_MAX,
  FIT_DAYPX_MIN,
  computeAppSidebarWidth,
  computeFitDayPx,
  computeInspectorWidth,
  computeScheduleGeometry,
  computeWorkSurfaceWidth,
} from "../geometry";
import {
  ACTIVITY_INSPECTOR_FULL_WIDTH,
  ACTIVITY_INSPECTOR_RAIL_WIDTH,
} from "@/components/scheduler/ActivityInspectorPanel";
import { getCpmStickyTableWidth } from "@/components/scheduler/CpmGrid";

const DESKTOP = 1440;
const LAPTOP = 1280;
const MOBILE = 414;
const DURATION = 180; // 6-month project, representative

describe("computeAppSidebarWidth", () => {
  it("expanded on desktop", () => {
    expect(
      computeAppSidebarWidth({ focusMode: false, collapsed: false, mobile: false }),
    ).toBe(APP_SIDEBAR_EXPANDED_W);
  });
  it("collapsed on desktop", () => {
    expect(
      computeAppSidebarWidth({ focusMode: false, collapsed: true, mobile: false }),
    ).toBe(APP_SIDEBAR_COLLAPSED_W);
  });
  it("focus mode zeroes the sidebar even when not collapsed", () => {
    expect(
      computeAppSidebarWidth({ focusMode: true, collapsed: false, mobile: false }),
    ).toBe(APP_SIDEBAR_FOCUS_W);
    expect(APP_SIDEBAR_FOCUS_W).toBe(0);
  });
  it("mobile viewport zeroes the sidebar", () => {
    expect(
      computeAppSidebarWidth({ focusMode: false, collapsed: false, mobile: true }),
    ).toBe(APP_SIDEBAR_MOBILE_W);
  });
});

describe("computeInspectorWidth", () => {
  it("hidden when not visible", () => {
    expect(computeInspectorWidth({ visible: false, expanded: true })).toBe(0);
    expect(computeInspectorWidth({ visible: false, expanded: false })).toBe(0);
  });
  it("rail width when collapsed", () => {
    expect(computeInspectorWidth({ visible: true, expanded: false })).toBe(
      ACTIVITY_INSPECTOR_RAIL_WIDTH,
    );
  });
  it("full width when expanded", () => {
    expect(computeInspectorWidth({ visible: true, expanded: true })).toBe(
      ACTIVITY_INSPECTOR_FULL_WIDTH,
    );
  });
});

describe("computeWorkSurfaceWidth", () => {
  it("subtracts both rails", () => {
    expect(
      computeWorkSurfaceWidth({ viewport: 1440, sidebar: 216, inspector: 340 }),
    ).toBe(884);
  });
  it("never returns negative", () => {
    expect(
      computeWorkSurfaceWidth({ viewport: 200, sidebar: 216, inspector: 340 }),
    ).toBe(0);
  });
});

describe("computeFitDayPx", () => {
  it("returns 0 when project has no duration", () => {
    expect(computeFitDayPx({ workSurface: 1000, projectDuration: 0 })).toBe(0);
  });
  it("returns 0 when no horizontal room after sticky + padding", () => {
    const sticky = getCpmStickyTableWidth();
    expect(
      computeFitDayPx({
        workSurface: sticky + FIT_AVAILABLE_PADDING,
        projectDuration: 30,
      }),
    ).toBe(0);
  });
  it("clamps to FIT_DAYPX_MAX when band is wide for a short project", () => {
    expect(
      computeFitDayPx({ workSurface: 5000, projectDuration: 5 }),
    ).toBe(FIT_DAYPX_MAX);
  });
  it("clamps to FIT_DAYPX_MIN when band is narrow for a long project", () => {
    expect(
      computeFitDayPx({ workSurface: 700, projectDuration: 5000 }),
    ).toBe(FIT_DAYPX_MIN);
  });
  it("produces fractional dayPx so the timeline fills edge-to-edge", () => {
    const sticky = getCpmStickyTableWidth();
    const workSurface = 1500;
    const duration = 100;
    const expected = (workSurface - sticky - FIT_AVAILABLE_PADDING) / duration;
    // Guard: the expected value must fall inside the clamp so we are actually
    // testing the fractional path, not the clamp.
    expect(expected).toBeGreaterThan(FIT_DAYPX_MIN);
    expect(expected).toBeLessThan(FIT_DAYPX_MAX);
    expect(
      computeFitDayPx({ workSurface, projectDuration: duration }),
    ).toBeCloseTo(expected, 6);
    // And the result must not be an integer — regression guard for the
    // historical Math.floor() that left a white gutter before the inspector.
    const actual = computeFitDayPx({ workSurface, projectDuration: duration });
    expect(actual).not.toBe(Math.floor(actual));
  });
});

describe("computeScheduleGeometry — regression snapshots", () => {
  const states = [
    {
      name: "desktop · sidebar expanded · inspector expanded",
      input: {
        viewport: DESKTOP,
        focusMode: false,
        sidebarCollapsed: false,
        inspectorVisible: true,
        inspectorExpanded: true,
        projectDuration: DURATION,
      },
    },
    {
      name: "desktop · sidebar expanded · inspector collapsed (rail)",
      input: {
        viewport: DESKTOP,
        focusMode: false,
        sidebarCollapsed: false,
        inspectorVisible: true,
        inspectorExpanded: false,
        projectDuration: DURATION,
      },
    },
    {
      name: "desktop · sidebar expanded · inspector hidden",
      input: {
        viewport: DESKTOP,
        focusMode: false,
        sidebarCollapsed: false,
        inspectorVisible: false,
        inspectorExpanded: false,
        projectDuration: DURATION,
      },
    },
    {
      name: "desktop · focus mode · inspector expanded",
      input: {
        viewport: DESKTOP,
        focusMode: true,
        sidebarCollapsed: false,
        inspectorVisible: true,
        inspectorExpanded: true,
        projectDuration: DURATION,
      },
    },
    {
      name: "desktop · focus mode · inspector collapsed",
      input: {
        viewport: DESKTOP,
        focusMode: true,
        sidebarCollapsed: false,
        inspectorVisible: true,
        inspectorExpanded: false,
        projectDuration: DURATION,
      },
    },
    {
      name: "laptop · sidebar collapsed · inspector expanded",
      input: {
        viewport: LAPTOP,
        focusMode: false,
        sidebarCollapsed: true,
        inspectorVisible: true,
        inspectorExpanded: true,
        projectDuration: DURATION,
      },
    },
    {
      name: "mobile · inspector hidden",
      input: {
        viewport: MOBILE,
        focusMode: false,
        sidebarCollapsed: false,
        inspectorVisible: false,
        inspectorExpanded: false,
        projectDuration: DURATION,
      },
    },
  ];

  for (const s of states) {
    it(s.name, () => {
      expect(computeScheduleGeometry(s.input)).toMatchSnapshot();
    });
  }

  it("focus mode reclaims exactly the sidebar width as Gantt band", () => {
    const base = {
      viewport: DESKTOP,
      sidebarCollapsed: false,
      inspectorVisible: true,
      inspectorExpanded: true,
      projectDuration: DURATION,
    };
    const off = computeScheduleGeometry({ ...base, focusMode: false });
    const on = computeScheduleGeometry({ ...base, focusMode: true });
    expect(on.ganttBand - off.ganttBand).toBe(APP_SIDEBAR_EXPANDED_W);
    expect(on.workSurface - off.workSurface).toBe(APP_SIDEBAR_EXPANDED_W);
  });

  it("collapsing the inspector reclaims (FULL - RAIL) for the Gantt band", () => {
    const base = {
      viewport: DESKTOP,
      focusMode: false,
      sidebarCollapsed: false,
      inspectorVisible: true,
      projectDuration: DURATION,
    };
    const expanded = computeScheduleGeometry({ ...base, inspectorExpanded: true });
    const collapsed = computeScheduleGeometry({ ...base, inspectorExpanded: false });
    const reclaimed = ACTIVITY_INSPECTOR_FULL_WIDTH - ACTIVITY_INSPECTOR_RAIL_WIDTH;
    expect(collapsed.ganttBand - expanded.ganttBand).toBe(reclaimed);
  });

  it("clamp bounds remain numerically valid", () => {
    expect(FIT_DAYPX_MIN).toBeLessThan(FIT_DAYPX_MAX);
    expect(FIT_DAYPX_MIN).toBeGreaterThan(0);
  });
});
