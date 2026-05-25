/**
 * SchedulerLayoutContext — UI-2.0
 *
 * Owns the new scheduler shell layout state:
 *   - intelMode: 'strip' | 'drawer' | 'full'
 *   - intelTab:  'review' | 'chat'   | 'build'
 *   - inspectorOpen / inspectorPinned (scaffolded for UI-2.2)
 *   - dockHeight (drawer height in px)
 *
 * Persistence uses a NEW localStorage key (`aos:scheduler:layout:${projectId}`)
 * so the existing `aos:scheduler:workbench:${projectId}` key is untouched.
 *
 * No behavior changes to scheduling, persistence, XER, dry-run, or AI.
 */

import * as React from "react";

export type IntelMode = "strip" | "drawer" | "full";
export type IntelTab = "review" | "chat" | "build";

export interface SchedulerLayoutState {
  intelMode: IntelMode;
  intelTab: IntelTab;
  inspectorOpen: boolean;
  inspectorPinned: boolean;
  dockHeight: number;
}

export interface SchedulerLayoutContextValue extends SchedulerLayoutState {
  setIntelMode: (m: IntelMode) => void;
  setIntelTab: (t: IntelTab) => void;
  setInspectorOpen: (b: boolean) => void;
  setInspectorPinned: (b: boolean) => void;
  setDockHeight: (h: number) => void;
  toggleDrawer: () => void;
  openDrawerTab: (t: IntelTab) => void;
  goFull: () => void;
  goDrawer: () => void;
  collapseToStrip: () => void;
  /** UI-2.1: open Build full-screen (flagship workspace entry). */
  openBuildFull: () => void;
}


const DEFAULTS: SchedulerLayoutState = {
  intelMode: "strip",
  intelTab: "review",
  inspectorOpen: true,
  inspectorPinned: true,
  dockHeight: 340,
};

const MIN_DOCK_HEIGHT = 220;
const MAX_DOCK_HEIGHT = 720;

const Ctx = React.createContext<SchedulerLayoutContextValue | null>(null);

export function useSchedulerLayout(): SchedulerLayoutContextValue {
  const v = React.useContext(Ctx);
  if (!v) {
    throw new Error(
      "useSchedulerLayout must be used inside <SchedulerLayoutProvider />",
    );
  }
  return v;
}

/** Safe variant — returns `null` outside a provider instead of throwing. */
export function useSchedulerLayoutSafe(): SchedulerLayoutContextValue | null {
  return React.useContext(Ctx);
}

export function SchedulerLayoutProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const storageKey = `aos:scheduler:layout:${projectId}`;
  const [state, setState] = React.useState<SchedulerLayoutState>(DEFAULTS);

  // Hydrate from localStorage on mount / project change.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const v = JSON.parse(raw) as Partial<SchedulerLayoutState>;
      setState((prev) => ({
        ...prev,
        ...(v.intelMode === "strip" || v.intelMode === "drawer" || v.intelMode === "full"
          ? { intelMode: v.intelMode }
          : {}),
        ...(v.intelTab === "review" || v.intelTab === "chat" || v.intelTab === "build"
          ? { intelTab: v.intelTab }
          : {}),
        ...(typeof v.inspectorOpen === "boolean" ? { inspectorOpen: v.inspectorOpen } : {}),
        ...(typeof v.inspectorPinned === "boolean" ? { inspectorPinned: v.inspectorPinned } : {}),
        ...(typeof v.dockHeight === "number"
          ? { dockHeight: clamp(v.dockHeight, MIN_DOCK_HEIGHT, MAX_DOCK_HEIGHT) }
          : {}),
      }));
    } catch {
      /* ignore corrupted layout */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }, [storageKey, state]);

  const value = React.useMemo<SchedulerLayoutContextValue>(
    () => ({
      ...state,
      setIntelMode: (m) => setState((s) => ({ ...s, intelMode: m })),
      setIntelTab: (t) => setState((s) => ({ ...s, intelTab: t })),
      setInspectorOpen: (b) => setState((s) => ({ ...s, inspectorOpen: b })),
      setInspectorPinned: (b) => setState((s) => ({ ...s, inspectorPinned: b })),
      setDockHeight: (h) =>
        setState((s) => ({ ...s, dockHeight: clamp(h, MIN_DOCK_HEIGHT, MAX_DOCK_HEIGHT) })),
      toggleDrawer: () =>
        setState((s) => ({
          ...s,
          intelMode: s.intelMode === "drawer" ? "strip" : "drawer",
        })),
      openDrawerTab: (t) =>
        setState((s) => ({ ...s, intelMode: "drawer", intelTab: t })),
      goFull: () => setState((s) => ({ ...s, intelMode: "full" })),
      goDrawer: () => setState((s) => ({ ...s, intelMode: "drawer" })),
      collapseToStrip: () => setState((s) => ({ ...s, intelMode: "strip" })),
    }),
    [state],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
