/**
 * IntelDock — PA-1
 *
 * Bottom-anchored Schedule Intelligence dock with three escalating states:
 *   - strip  (always visible, 44px)
 *   - drawer (bottom drawer, resizable)
 *   - full   (full-screen sheet)
 *
 * PA-1: Build is no longer a dock tab — it is a top-level product mode.
 * The dock now exposes only Review and Chat. Hosts should hide the dock
 * entirely when productMode !== 'schedule'.
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
};

const TAB_CAPTIONS: Record<IntelTab, string> = {
  review: "Findings",
  chat: "Ask about this schedule",
};

export interface IntelBuildHandle {
  isFull: boolean;
  toggleFull: () => void;
}

export interface IntelDockProps {
  renderReview: (sizing: { compact: boolean; wide: boolean }) => React.ReactNode;
  renderChat: () => React.ReactNode;
  /** Optional one-line summary shown in the strip when there is room. */
  reviewSummary?: string;
  /** Count of review findings (warnings/errors). Shown as a badge on the Review tab. */
  reviewCount?: number;
}

export function IntelDock({
  renderReview,
  renderChat,
  reviewSummary,
  reviewCount,
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
    openDrawerTab,
    openBuildFull,
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

  const renderActive = () => {
    if (intelTab === "review") {
      return renderReview({ compact: !isFull && !isDrawer, wide: isFull });
    }
    return renderChat();
  };

  /**
   * Tab click handler.
   * - Review/Chat from the strip open the drawer.
   * - When already in drawer or full, just switch tab.
   */
  const handleTabClick = (k: IntelTab) => {
    if (intelMode === "strip") {
      openDrawerTab(k);
      return;
    }
    setIntelTab(k);
  };

  const tabBar = (
    <div
      role="tablist"
      aria-label="Intelligence mode"
      className="flex items-center gap-1"
      data-testid="intel-mode-tabs"
    >
      {(["review", "chat"] as IntelTab[]).map((k) => {
        const active = intelTab === k;
        const showCount = k === "review" && typeof reviewCount === "number" && reviewCount > 0;
        const base =
          "group inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10.5px] font-medium tracking-wide transition-colors";
        const cls = active
          ? "bg-[#1f241f] text-[#f7e9b8]"
          : "text-[#6b6a63] hover:bg-[#faf8f3] hover:text-[#1f241f]";
        return (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => handleTabClick(k)}
            data-testid={`intel-mode-${k}`}
            title={TAB_CAPTIONS[k]}
            className={`${base} ${cls}`}
          >
            <span>{TAB_LABELS[k]}</span>
            {showCount ? (
              <span
                className={
                  "rounded-full px-1 text-[9px] font-semibold tabular-nums " +
                  (active
                    ? "bg-[#f7e9b8]/30 text-[#f7e9b8]"
                    : "bg-amber-100 text-amber-900")
                }
                data-testid="intel-mode-review-count"
              >
                {reviewCount}
              </span>
            ) : null}
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

      {/* Drawer — elevated panel with brass left-edge accent so it reads as
          distinct from the always-visible strip / KPI bar. */}
      {isDrawer ? (
        <aside
          className="fixed right-0 z-30 flex flex-col border-t border-[var(--sched-surface-rule)] bg-[var(--sched-ivory)] shadow-[var(--sched-elevation-2)] print:hidden"
          style={{ bottom: STRIP_HEIGHT, height: dockHeight, left: "var(--app-sidebar-w, 0px)" }}
          aria-label="Schedule intelligence drawer"
          data-testid="intel-dock-drawer"
        >
          {/* Brass left-edge accent — Intelligence is brass emphasis territory. */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[var(--sched-brass)] to-[var(--sched-brass-deep)]"
          />

          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize intelligence drawer"
            onPointerDown={startResize}
            className="group absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize"
            title="Drag to resize"
          >
            <div className="absolute inset-x-0 top-1 h-px bg-[var(--sched-surface-rule)] group-hover:bg-[var(--sched-graphite-strong)]" />
          </div>
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--sched-surface-rule)] bg-[var(--sched-surface)] px-3 py-1.5">
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-graphite)]">
                <span className="text-[var(--sched-brass-deep)]">✶</span> Schedule Intelligence
              </span>
              {tabBar}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goFull}
                className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--sched-graphite)] hover:bg-[var(--sched-ivory)] hover:text-[var(--sched-graphite-strong)]"
                data-testid="intel-dock-go-full"
              >
                Full
              </button>
              <button
                type="button"
                onClick={collapseToStrip}
                className="rounded p-1 text-[var(--sched-graphite)] hover:bg-[var(--sched-ivory)] hover:text-[var(--sched-graphite-strong)]"
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
          className="fixed right-0 bottom-0 z-30 flex items-center gap-2 border-t border-[#1f241f]/15 bg-gradient-to-r from-[#1f241f] via-[#26302a] to-[#1f241f] px-3 text-[#f7e9b8] shadow-[0_-2px_8px_rgba(0,0,0,0.08)] print:hidden"
          style={{ height: STRIP_HEIGHT, left: "var(--app-sidebar-w, 0px)" }}
          data-testid="intel-dock-strip"
          aria-label="Schedule intelligence dock"
        >
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#f7e9b8]">
            <span className="text-[#d4b94a]">✶</span> Schedule Intelligence
          </span>

          <div className="mx-2 h-5 w-px bg-[#f7e9b8]/20" />

          {/* Review CTA */}
          <button
            type="button"
            onClick={() => openDrawerTab("review")}
            className="group inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium tracking-tight transition-colors hover:bg-white/10"
            data-testid="intel-strip-cta-review"
            title="Open review findings"
          >
            <span className="text-[#f7e9b8]/70 group-hover:text-[#f7e9b8]">Review</span>
            {typeof reviewCount === "number" && reviewCount > 0 ? (
              <span
                className={
                  "rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums " +
                  (reviewCount > 5
                    ? "bg-[#b42318] text-white"
                    : "bg-[#d4a017] text-[#1f241f]")
                }
              >
                {reviewCount} {reviewCount === 1 ? "finding" : "findings"}
              </span>
            ) : (
              <span className="rounded-full bg-[#3c7a4a] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                Clean
              </span>
            )}
          </button>

          {/* Chat CTA */}
          <button
            type="button"
            onClick={() => openDrawerTab("chat")}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-[#f7e9b8]/70 transition-colors hover:bg-white/10 hover:text-[#f7e9b8]"
            data-testid="intel-strip-cta-chat"
            title="Ask about this schedule"
          >
            <span>Chat</span>
            <span className="hidden text-[10px] text-[#f7e9b8]/50 md:inline">Ask about schedule</span>
          </button>

          {/* Build CTA — jumps to Build mode */}
          <button
            type="button"
            onClick={openBuildFull}
            className="inline-flex items-center gap-1.5 rounded border border-[#d4b94a]/40 bg-gradient-to-r from-[#c9a84c] to-[#a89968] px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-[#1f241f] transition hover:brightness-110"
            data-testid="intel-strip-cta-build"
            title="Open Build mode — draft a CPM"
          >
            <span>✦ Build</span>
            <span className="hidden text-[9px] font-medium normal-case tracking-normal opacity-80 md:inline">
              Draft CPM
            </span>
          </button>

          {reviewSummary ? (
            <span className="ml-2 hidden truncate text-[11px] text-[#f7e9b8]/65 lg:inline">
              {reviewSummary}
            </span>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={toggleDrawer}
              className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                isDrawer
                  ? "bg-[#f7e9b8] text-[#1f241f]"
                  : "text-[#f7e9b8]/70 hover:bg-white/10 hover:text-[#f7e9b8]"
              }`}
              data-testid="intel-dock-toggle-drawer"
              title={isDrawer ? "Collapse drawer" : "Open drawer"}
            >
              {isDrawer ? "Collapse" : "Expand"}
            </button>
            <button
              type="button"
              onClick={goFull}
              className="rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#f7e9b8]/70 hover:bg-white/10 hover:text-[#f7e9b8]"
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
          className="fixed inset-y-0 right-0 z-50 flex flex-col bg-[#fdfcf7] print:hidden"
          style={{ left: "var(--app-sidebar-w, 0px)" }}
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
