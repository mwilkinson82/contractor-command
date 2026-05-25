/**
 * SchedulerShell — UI-2.0
 *
 * Composition surface for the new scheduler workbench. For UI-2.0 the shell
 * is intentionally thin: it provides the layout context and a semantic
 * `WorkSurface` wrapper. UI-2.2 will move the Inspector into the shell as a
 * persistent right column; UI-2.3 will move the command bar in.
 */

import * as React from "react";
import {
  SchedulerLayoutProvider,
  useSchedulerLayout,
} from "./SchedulerLayoutContext";

export interface SchedulerShellProps {
  projectId: string;
  children: React.ReactNode;
}

/** Provider wrapper. Use at the top of the scheduler route render tree. */
export function SchedulerShell({ projectId, children }: SchedulerShellProps) {
  return (
    <SchedulerLayoutProvider projectId={projectId}>
      {children}
    </SchedulerLayoutProvider>
  );
}

/**
 * Semantic wrapper for the primary work surface (table / Gantt area).
 * Currently a passthrough flex column with a stable data attribute so future
 * passes (UI-2.4 Gantt polish, UI-2.2 inspector re-home) can target it.
 */
export function WorkSurface({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-scheduler-work-surface
      className={"flex min-h-0 flex-1 flex-col " + className}
    >
      {children}
    </div>
  );
}

export { useSchedulerLayout };
export type {
  IntelMode,
  IntelTab,
  SchedulerLayoutContextValue,
} from "./SchedulerLayoutContext";
