import { createFileRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { Container } from "@/components/portal/page-header";

export const Route = createFileRoute("/tools")({
  component: ToolsLayout,
});

const TOOLS = [
  { to: "/tools/growth-constraint", label: "Growth Constraint Map", status: "Live" as const, group: "Make more money" },
  { to: "/tools/owner-dependency", label: "Owner Dependency Scorecard", status: "Live" as const, group: "Build the machine" },
];

const COMING = [
  "Pipeline Leak Finder",
  "Estimate Throughput Tracker",
  "Cash Control Snapshot",
  "Margin Leak Finder",
  "Project Launch Readiness",
];

function ToolsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-2">
          <p className="label-mono">Business Command Tools</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <details className="relative">
            <summary className="cursor-pointer list-none rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted">
              Switch tool
            </summary>
            <div className="absolute right-0 z-10 mt-2 w-72 rounded-xl border border-border bg-popover p-2 shadow-[var(--shadow-elegant)]">
              {TOOLS.map((t) => (
                <Link
                  key={t.to}
                  to={t.to as "/tools/growth-constraint"}
                  className={`block rounded-md px-3 py-2 text-sm hover:bg-muted ${
                    pathname === t.to ? "bg-muted" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{t.label}</span>
                    <span className="label-mono !text-[9px]">{t.group}</span>
                  </div>
                </Link>
              ))}
              <div className="mt-2 border-t border-border pt-2">
                <p className="px-3 pb-1 label-mono">More tools next</p>
                <p className="px-3 pb-2 text-xs text-muted-foreground">
                  {COMING.join(" · ")}
                </p>
              </div>
            </div>
          </details>
          <Link
            to="/vault"
            className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-muted"
          >
            Company Vault
          </Link>
        </div>
      </div>
      <div className="mt-8">
        <Outlet />
      </div>
    </Container>
  );
}
