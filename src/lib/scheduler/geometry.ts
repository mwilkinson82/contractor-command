/**
 * Schedule geometry helpers — pure functions describing how the scheduler
 * shell allocates horizontal space across the app sidebar, the Activity
 * Inspector, and the Gantt/CPM work surface.
 *
 * These mirror the runtime layout defined in:
 *   - src/styles.css (`--app-sidebar-w`, `scheduler-focus-mode`)
 *   - src/components/portal/app-sidebar.tsx (216 / 60 expanded/collapsed)
 *   - src/components/scheduler/ActivityInspectorPanel.tsx (RAIL/FULL widths)
 *   - src/routes/scheduler.$projectId.tsx (fit-zoom calculation)
 *
 * Kept as a separate pure module so we can snapshot geometry across states
 * (inspector expanded/collapsed, focus mode, mobile) without rendering the
 * scheduler in a browser.
 */

import {
  ACTIVITY_INSPECTOR_FULL_WIDTH,
  ACTIVITY_INSPECTOR_RAIL_WIDTH,
} from "@/components/scheduler/ActivityInspectorPanel";
import { getCpmStickyTableWidth } from "@/components/scheduler/CpmGrid";

/** Width of the portal app sidebar in its various states. */
export const APP_SIDEBAR_EXPANDED_W = 216;
export const APP_SIDEBAR_COLLAPSED_W = 60;
export const APP_SIDEBAR_FOCUS_W = 0;
export const APP_SIDEBAR_MOBILE_W = 0;

/** Fit-zoom dayPx clamp range, mirroring scheduler.$projectId.tsx fitToContainer. */
export const FIT_DAYPX_MIN = 4;
export const FIT_DAYPX_MAX = 36;

/** Padding deducted from container.clientWidth before fit-zoom calc. */
export const FIT_AVAILABLE_PADDING = 2;

export interface SidebarStateInput {
  focusMode: boolean;
  collapsed: boolean;
  /** True if the viewport is narrower than the md breakpoint (767px). */
  mobile: boolean;
}

/** Effective `--app-sidebar-w` for the given shell state. */
export function computeAppSidebarWidth(s: SidebarStateInput): number {
  if (s.mobile) return APP_SIDEBAR_MOBILE_W;
  if (s.focusMode) return APP_SIDEBAR_FOCUS_W;
  return s.collapsed ? APP_SIDEBAR_COLLAPSED_W : APP_SIDEBAR_EXPANDED_W;
}

/** Effective width of the right-side Activity Inspector. */
export function computeInspectorWidth(opts: {
  /** True when the inspector is rendered at all (Schedule mode with selection / pinned). */
  visible: boolean;
  expanded: boolean;
}): number {
  if (!opts.visible) return 0;
  return opts.expanded
    ? ACTIVITY_INSPECTOR_FULL_WIDTH
    : ACTIVITY_INSPECTOR_RAIL_WIDTH;
}

/** Width of the central work surface (between sidebar and inspector). */
export function computeWorkSurfaceWidth(opts: {
  viewport: number;
  sidebar: number;
  inspector: number;
}): number {
  return Math.max(0, opts.viewport - opts.sidebar - opts.inspector);
}

/**
 * Fit-zoom dayPx for the Gantt timeline. Mirrors the production calc:
 *   ideal   = (workSurface - stickyTableWidth - padding) / projectDuration
 *   dayPx   = clamp(ideal, FIT_DAYPX_MIN, FIT_DAYPX_MAX)
 *
 * Returns 0 when there is no usable space (caller should fall back to the
 * user-selected zoom). The clamp produces a finite number even when the
 * available band is tiny.
 */
export function computeFitDayPx(opts: {
  workSurface: number;
  nameColWidth?: number;
  projectDuration: number;
}): number {
  if (opts.projectDuration < 1) return 0;
  const sticky = getCpmStickyTableWidth(opts.nameColWidth);
  const available = opts.workSurface - sticky - FIT_AVAILABLE_PADDING;
  if (available <= 0) return 0;
  const ideal = available / opts.projectDuration;
  return clamp(ideal, FIT_DAYPX_MIN, FIT_DAYPX_MAX);
}

/**
 * Full geometry snapshot for one shell state. Useful as a single object to
 * snapshot in regression tests across (viewport × inspector × focusMode).
 */
export interface ScheduleGeometrySnapshot {
  viewport: number;
  sidebar: number;
  inspector: number;
  workSurface: number;
  stickyTable: number;
  ganttBand: number;
  fitDayPx: number;
}

export function computeScheduleGeometry(input: {
  viewport: number;
  focusMode: boolean;
  sidebarCollapsed: boolean;
  inspectorVisible: boolean;
  inspectorExpanded: boolean;
  projectDuration: number;
  nameColWidth?: number;
}): ScheduleGeometrySnapshot {
  const mobile = input.viewport < 768;
  const sidebar = computeAppSidebarWidth({
    focusMode: input.focusMode,
    collapsed: input.sidebarCollapsed,
    mobile,
  });
  const inspector = computeInspectorWidth({
    visible: input.inspectorVisible,
    expanded: input.inspectorExpanded,
  });
  const workSurface = computeWorkSurfaceWidth({
    viewport: input.viewport,
    sidebar,
    inspector,
  });
  const stickyTable = getCpmStickyTableWidth(input.nameColWidth);
  const ganttBand = Math.max(
    0,
    workSurface - stickyTable - FIT_AVAILABLE_PADDING,
  );
  const fitDayPx = computeFitDayPx({
    workSurface,
    nameColWidth: input.nameColWidth,
    projectDuration: input.projectDuration,
  });
  return {
    viewport: input.viewport,
    sidebar,
    inspector,
    workSurface,
    stickyTable,
    ganttBand,
    fitDayPx: round4(fitDayPx),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
