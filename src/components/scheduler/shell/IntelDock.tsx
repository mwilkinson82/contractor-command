/**
 * IntelDock — UI-2.0
 *
 * Bottom-anchored Schedule Intelligence dock with three escalating states:
 *   - strip  (always visible, 44px)
 *   - drawer (bottom drawer, resizable)
 *   - full   (full-screen sheet)
 *
 * Content rendering for Review / Chat / Build is delegated to the host via
 * render props so the dock has zero coupling to schedule data. UI-2.1 will
 * redesign the Build content itself; this pass only re-homes the existing
 * Review / Chat / Build panels into the new state machine.
 *
 * The dock does NOT change scheduler behavior, persistence, XER, dry-run,
 * AI generation, or the "Add to Schedule" guardrail (still disabled).
 */

import * as React from "react";
import { useSchedulerLayout, type IntelTab } from "./SchedulerLayoutContext";

const STRIP_HEIGHT = 44;

const TAB_LABELS: Record<IntelTab, string> = {
  review: "Review",
  chat: "Chat",
  build: "Build",
};

export interface IntelBuildHandle {
  isFull: boolean;
  toggleFull: () => void;
}

export interface IntelDockProps {
  renderReview: (sizing: { compact: boolean; wide: boolean }) => React.ReactNode;
  renderChat: () => React.ReactNode;
  renderBuild: (handle: IntelBuildHandle) => React.ReactNode;
  /** Optional one-line summary shown in the strip when there is room. */
  reviewSummary?: string;
}

export function IntelDock({
  renderReview,
  renderChat,
  renderBuild,
  reviewSummary,
}: IntelDockProps) {
  const {
    intelMode,
    intelTab,
    dockHeight,
    setIntelTab,
    setDockHeight,
    toggleDrawer,
    goFull,
    goDrawer,
    collapseToStrip,
  } = useSchedulerLayout();

  const isDrawer = intelMode === "drawer";
  const isFull = intelMode === "full";

  // Drag-to-resize the drawer height (only active while in drawer mode).
  const startResize = React.useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawer) return;
      e.preventDefault();
      const startY = e.clientY;
      const startH = dockHeight;
      const onMove = (ev: PointerEvent) => {
        const delta = startY - ev.clientY;
        setDockHeight(startH + delta);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [isDrawer, dockHeight, setDockHeight],
  );

  const buildHandle: IntelBuildHandle = React.useMemo(
    () => ({
      isFull,
      toggleFull: () => (isFull ? goDrawer() : goFull()),
    }),
    [isFull, goDrawer, goFull],
  );

  const renderActive = () => {
    if (intelTab === "review") {
      return renderReview({ compact: !isFull && !isDrawer, wide: isFull });
    }
    if (intelTab === "chat") return renderChat();
    return renderBuild(buildHandle);
  };

  const tabBar = (
    <div
      role="tablist"
      aria-label="Intelligence mode"
      className="flex items-center gap-0.5"
      data-testid="intel-mode-tabs"
    >
      {(["review", "chat", "build"] as IntelTab[]).map((k) => {
        const active = intelTab === k;
        return (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setIntelTab(k)}
            data-testid={`intel-mode-${k}`}
            className={`rounded px-2 py-0.5 text-[10.5px] font-medium tracking-wide ${
              active
                ? "bg-[#1f241f] text-[#f7e9b8]"
                : "text-[#6b6a63] hover:bg-[#faf8f3] hover:text-[#1f241f]"
            }`}
          >
            {TAB_LABELS[k]}
          </button>
        );
      })}
    </div>
  );

  return (
    <div data-scheduler-intel-dock>
      {/* Inline spacer so fixed dock doesn't cover bottom of page content. */}
      {!isFull ? (
        <div
          aria-hidden
          data-testid="intel-dock-spacer"
          style={{ height: STRIP_HEIGHT + (isDrawer ? dockHeight : 0) }}
          className="shrink-0 print:hidden"
        />
      ) : null}

      {/* Drawer */}
      {isDrawer ? (
        <aside
          className="fixed inset-x-0 z-30 flex flex-col border-t border-[#e3e0d8] bg-[#faf8f3] print:hidden"
          style={{ bottom: STRIP_HEIGHT, height: dockHeight }}
          aria-label="Schedule intelligence drawer"
          data-testid="intel-dock-drawer"
        >
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize intelligence drawer"
            onPointerDown={startResize}
            className="group absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
            title="Drag to resize"
          >
            <div className="absolute inset-x-0 top-1 h-px bg-[#e3e0d8] group-hover:bg-[#1f241f]" />
          </div>
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[#e3e0d8] bg-white px-3 py-1.5">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4a4944]">
                Schedule Intelligence
              </span>
              {tabBar}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goFull}
                className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#6b6a63] hover:bg-[#faf8f3] hover:text-[#1f241f]"
                data-testid="intel-dock-go-full"
              >
                Full
              </button>
              <button
                type="button"
                onClick={collapseToStrip}
                className="rounded p-1 text-[#6b6a63] hover:bg-[#faf8f3] hover:text-[#1f241f]"
                aria-label="Collapse intelligence to strip"
                data-testid="intel-dock-collapse"
              >
                ✕
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">{renderActive()}</div>
        </aside>
      ) : null}

      {/* Strip — always visible unless full-screen. */}
      {!isFull ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-[#e3e0d8] bg-white/95 px-3 backdrop-blur print:hidden"
          style={{ height: STRIP_HEIGHT }}
          data-testid="intel-dock-strip"
          aria-label="Schedule intelligence dock"
        >
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4a4944]">
            ✶ Schedule Intelligence
          </span>
          {tabBar}
          {reviewSummary ? (
            <span className="hidden truncate text-[11px] text-[#6b6a63] lg:inline">
              {reviewSummary}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={toggleDrawer}
              className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                isDrawer
                  ? "bg-[#1f241f] text-white"
                  : "text-[#6b6a63] hover:bg-[#faf8f3] hover:text-[#1f241f]"
              }`}
              data-testid="intel-dock-toggle-drawer"
              title={isDrawer ? "Collapse drawer" : "Open drawer"}
            >
              {isDrawer ? "Collapse" : "Expand"}
            </button>
            <button
              type="button"
              onClick={goFull}
              className="rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#6b6a63] hover:bg-[#faf8f3] hover:text-[#1f241f]"
              data-testid="intel-dock-go-full-strip"
              title="Open intelligence full-screen"
            >
              Full
            </button>
          </div>
        </div>
      ) : null}

      {/* Full-screen sheet */}
      {isFull ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-[#fdfcf7] print:hidden"
          data-testid="intel-dock-full"
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[#e3e0d8] bg-white px-3 py-1.5">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4a4944]">
                Schedule Intelligence — Full
              </span>
              {tabBar}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goDrawer}
                className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#6b6a63] hover:bg-[#faf8f3] hover:text-[#1f241f]"
                data-testid="intel-dock-full-to-drawer"
              >
                Drawer
              </button>
              <button
                type="button"
                onClick={collapseToStrip}
                className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#6b6a63] hover:bg-[#faf8f3] hover:text-[#1f241f]"
                data-testid="intel-dock-full-to-strip"
              >
                Strip
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">{renderActive()}</div>
        </div>
      ) : null}
    </div>
  );
}


/**
 * Tiny button host that lives wherever the old "✶ Intel" trigger lived in
 * the route. Uses the layout context to toggle the drawer open/closed.
 */
export function IntelTrigger({
  className,
  label = "✶ Intel",
  title = "Schedule Intelligence",
}: {
  className?: string;
  label?: React.ReactNode;
  title?: string;
}) {
  const { intelMode, toggleDrawer } = useSchedulerLayout();
  const active = intelMode !== "strip";
  return (
    <button
      type="button"
      onClick={toggleDrawer}
      data-testid="intel-trigger"
      className={
        className ??
        `rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
          active
            ? "bg-[#1f241f] text-white"
            : "text-[#6b6a63] hover:bg-[#faf8f3] hover:text-[#1f241f]"
        }`
      }
      title={title}
    >
      {label}
    </button>
  );
}
