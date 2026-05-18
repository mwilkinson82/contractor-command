import { createFileRoute, Outlet, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Archive, ArrowUpRight, LayoutGrid, Lock } from "lucide-react";
import {
  COMMAND_TOOLS,
  TOOL_GROUPS,
  toolsByGroup,
  type CommandTool,
} from "@/lib/command-tools";
import { hasToolDrawer } from "@/components/portal/tool-drawer";
import { useAppSidebar } from "@/components/portal/app-sidebar";
import { EstimateThroughputTool } from "@/components/portal/tools/estimate-throughput-tool";
import { ContractReadinessTool } from "@/components/portal/tools/contract-readiness-tool";
import { MarginLeakTool } from "@/components/portal/tools/margin-leak-tool";
import { SopPriorityTool } from "@/components/portal/tools/sop-priority-tool";
import { GrowthConstraintTool } from "@/routes/tools.growth-constraint";
import { OwnerDependencyTool } from "@/routes/tools.owner-dependency";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ChevronUp, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/tools")({
  component: ToolsLayout,
  head: () => ({
    meta: [{ title: "Operator's Workbench — ALP Contractor Circle" }],
  }),
});

const STAGE_TOOLS: Record<string, () => ReactElement> = {
  "sop-priority": () => <SopPriorityTool />,
  "contract-readiness": () => <ContractReadinessTool />,
  "estimate-throughput": () => <EstimateThroughputTool />,
  "margin-leak": () => <MarginLeakTool />,
  "growth-constraint": () => <GrowthConstraintTool embedded />,
  "owner-dependency": () => <OwnerDependencyTool embedded />,
};


const DEFAULT_TOOL = "sop-priority";
const STORAGE_KEY = "alp.cc.workbench.last";

function readLastTool(): string {
  if (typeof window === "undefined") return DEFAULT_TOOL;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v && v in STAGE_TOOLS) return v;
  } catch {}
  return DEFAULT_TOOL;
}

function ToolsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search }) as unknown as Record<string, unknown>;

  // Child routes (/tools/growth-constraint, /tools/owner-dependency) render
  // their own page chrome — bypass the workbench.
  if (pathname !== "/tools") {
    return <Outlet />;
  }

  return <Workbench searchTool={typeof search?.t === "string" ? (search.t as string) : undefined} />;
}

function Workbench({ searchTool }: { searchTool?: string }) {
  const { collapsed, toggle } = useAppSidebar();
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState<string>(DEFAULT_TOOL);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Hydrate from URL → localStorage → default on mount.
  useEffect(() => {
    const initial =
      searchTool && searchTool in STAGE_TOOLS ? searchTool : readLastTool();
    setActiveId(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep URL in sync with the active tool.
  useEffect(() => {
    if (searchTool === activeId) return;
    navigate({
      to: "/tools",
      search: { t: activeId } as never,
      replace: true,
    });
    try {
      window.localStorage.setItem(STORAGE_KEY, activeId);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Auto-collapse the app sidebar once on entry so the workbench gets the
  // full width. User can re-open it manually; we don't restore on unmount.
  useEffect(() => {
    if (!collapsed) toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ⌘K / Ctrl+K opens the picker.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPickerOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeTool = useMemo(
    () => COMMAND_TOOLS.find((t) => t.id === activeId),
    [activeId],
  );
  const Render = STAGE_TOOLS[activeId];

  function pickTool(t: CommandTool) {
    setPickerOpen(false);
    if (t.id in STAGE_TOOLS) {
      setActiveId(t.id);
      return;
    }
    // Tools without a stage variant have their own route.
    if (t.route) {
      navigate({ to: t.route as "/tools/growth-constraint" });
    }
  }

  const [chromeCollapsed, setChromeCollapsed] = useState(false);

  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-col bg-background">
      {!chromeCollapsed && (
        <>
          <WorkbenchHeader
            activeTool={activeTool}
            onOpenPicker={() => setPickerOpen(true)}
            onCollapse={() => setChromeCollapsed(true)}
          />
          <ToolRail activeId={activeId} onPick={pickTool} />
        </>
      )}
      {chromeCollapsed && (
        <CollapsedBar
          activeTool={activeTool}
          onExpand={() => setChromeCollapsed(false)}
          onOpenPicker={() => setPickerOpen(true)}
        />
      )}
      <div className="flex-1">
        {Render ? <Render /> : <StageFallback />}
      </div>

      <SwitchToolDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        activeId={activeId}
        onPick={pickTool}
      />
    </div>
  );
}

function CollapsedBar({
  activeTool,
  onExpand,
  onOpenPicker,
}: {
  activeTool: CommandTool | undefined;
  onExpand: () => void;
  onOpenPicker: () => void;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-6 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onExpand}
            title="Expand workbench header"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-foreground/70 hover:bg-muted"
          >
            <ChevronDown className="h-3 w-3" />
            <span className="font-mono uppercase tracking-[0.22em]">Workbench</span>
          </button>
          <span className="truncate text-[12.5px] text-foreground/80">
            {activeTool?.name ?? "Select a tool"}
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenPicker}
          className="inline-flex items-center gap-1.5 rounded-md bg-signal px-3 py-1.5 text-[12px] font-semibold text-cream hover:bg-signal/90"
        >
          <LayoutGrid className="h-3.5 w-3.5" /> Switch tool
        </button>
      </div>
    </div>
  );
}

function WorkbenchHeader({
  activeTool,
  onOpenPicker,
}: {
  activeTool: CommandTool | undefined;
  onOpenPicker: () => void;
}) {
  const liveCount = useMemo(
    () => COMMAND_TOOLS.filter((t) => t.status === "live").length,
    [],
  );
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("alp.cc.workbench.seenSwitch")) {
        setPulse(true);
        sessionStorage.setItem("alp.cc.workbench.seenSwitch", "1");
        const t = setTimeout(() => setPulse(false), 4800);
        return () => clearTimeout(t);
      }
    } catch {}
  }, []);

  return (
    <div className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-start justify-between gap-4 px-6 py-5">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Operator's Workbench
          </p>
          <h1
            className="mt-1 font-display text-[28px] leading-none"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Operator's Workbench
          </h1>
          <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground">
            <span className="text-signal">● Now loaded</span>
            <span className="mx-2 text-muted-foreground/40">·</span>
            <span>{activeTool?.group ?? "—"}</span>
            <span className="mx-2 text-muted-foreground/40">·</span>
            <span className="text-foreground/80">{activeTool?.name ?? "Select a tool"}</span>
          </p>
          <p className="mt-2 max-w-xl text-[12.5px] text-muted-foreground">
            {liveCount} tools to run the business. One loaded — pick another anytime.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenPicker}
            className={`group inline-flex items-center gap-2 rounded-md border border-signal/60 bg-signal px-4 py-2.5 text-[13px] font-semibold text-cream shadow-sm transition hover:bg-signal/90 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/40 ${pulse ? "animate-signal-pulse" : ""}`}
          >
            <LayoutGrid className="h-4 w-4" />
            <span>Switch tool</span>
            <span className="text-cream/70">· {liveCount} tools</span>
            <kbd className="ml-1 hidden rounded border border-cream/30 bg-cream/10 px-1.5 py-0.5 font-mono text-[10px] text-cream/90 sm:inline-block">
              ⌘K
            </kbd>
          </button>
          <Link
            to="/vault"
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12.5px] text-foreground/60 hover:bg-muted hover:text-foreground"
          >
            <Archive className="h-3.5 w-3.5" /> Vault
          </Link>
        </div>
      </div>
    </div>
  );
}

function ToolRail({
  activeId,
  onPick,
}: {
  activeId: string;
  onPick: (t: CommandTool) => void;
}) {
  const live = useMemo(
    () => COMMAND_TOOLS.filter((t) => t.status === "live"),
    [],
  );
  return (
    <div className="border-b border-border bg-card/40">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-1.5 px-6 py-2.5">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Tools ·
        </span>
        {live.map((t) => {
          const isActive = t.id === activeId;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t)}
              title={t.blurb}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] transition ${
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background/60 text-foreground/70 hover:border-foreground/40 hover:bg-muted"
              }`}
            >
              <Icon className="h-3 w-3" />
              <span className="truncate">{t.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


function StageFallback() {
  return (
    <div className="mx-auto flex max-w-[600px] flex-col items-center px-6 py-24 text-center">
      <p className="label-mono">Empty stage</p>
      <h2
        className="mt-3 font-display text-[24px]"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Pick a tool to begin.
      </h2>
      <p className="mt-2 text-[13.5px] text-muted-foreground">
        Press <kbd className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[11px]">⌘K</kbd>{" "}
        or use the Switch tool button above.
      </p>
    </div>
  );
}

function SwitchToolDialog({
  open,
  onOpenChange,
  activeId,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  activeId: string;
  onPick: (t: CommandTool) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <DialogTitle className="sr-only">Switch tool</DialogTitle>
        <DialogDescription className="sr-only">
          Pick a Command Tool to load into the workbench.
        </DialogDescription>
        <div className="border-b border-border px-5 py-4">
          <p className="label-mono">Workbench · switch tool</p>
          <h3
            className="mt-1 font-display text-[20px] leading-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Every tool you've got.
          </h3>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            One per problem. Live tools load straight into the workbench. Others have their own page.
          </p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-2 py-3">
          {TOOL_GROUPS.map((group, idx) => {
            const tools = toolsByGroup(group);
            if (tools.length === 0) return null;
            const num = String(idx + 1).padStart(2, "0");
            return (
              <div key={group} className="px-3 py-2">
                <p className="px-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  {num} · {group}
                </p>
                <ul className="mt-2 space-y-1">
                  {tools.map((t) => {
                    const isActive = t.id === activeId;
                    const Icon = t.icon;
                    const isStage = t.id in STAGE_TOOLS;
                    const isRouted = !isStage && !!t.route;
                    const usable = isStage || isRouted;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => usable && onPick(t)}
                          disabled={!usable}
                          className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition ${
                            isActive
                              ? "border-foreground/40 bg-muted"
                              : usable
                                ? "border-transparent hover:border-border hover:bg-muted/60"
                                : "border-transparent opacity-50"
                          }`}
                        >
                          <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground/5 text-foreground/80">
                            {t.status === "later" || (!usable && !hasToolDrawer(t.id)) ? (
                              <Lock className="h-3.5 w-3.5" />
                            ) : (
                              <Icon className="h-3.5 w-3.5" />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-[13.5px] font-medium text-foreground">
                                {t.name}
                              </span>
                              {isActive && (
                                <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-signal">
                                  · loaded
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 line-clamp-1 block text-[12px] text-muted-foreground">
                              {t.blurb}
                            </span>
                          </span>
                          <StatusPill status={t.status} routed={isRouted} />
                          <ArrowUpRight className="h-3.5 w-3.5 text-foreground/40 opacity-0 transition group-hover:opacity-100" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusPill({ status, routed }: { status: CommandTool["status"]; routed: boolean }) {
  if (status === "later") {
    return (
      <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted-foreground">
        Soon
      </span>
    );
  }
  if (routed) {
    return (
      <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted-foreground">
        Own page
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted-foreground">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal" /> Live
    </span>
  );
}
