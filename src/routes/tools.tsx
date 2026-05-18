import { createFileRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Archive, ArrowUpRight, Lock } from "lucide-react";
import { Container } from "@/components/portal/page-header";
import {
  COMMAND_TOOLS,
  TOOL_GROUPS,
  toolsByGroup,
  type CommandTool,
} from "@/lib/command-tools";
import { hasToolDrawer, useToolDrawer } from "@/components/portal/tool-drawer";
import { vault, type Packet } from "@/lib/vault";

export const Route = createFileRoute("/tools")({
  component: ToolsLayout,
  head: () => ({
    meta: [{ title: "Command Tools — ALP Contractor Circle" }],
  }),
});

function ToolsLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onIndex = pathname === "/tools";

  return (
    <Container className="py-10">
      {onIndex ? <ToolsDirectory /> : <Outlet />}
    </Container>
  );
}

function ToolsDirectory() {
  const [packets, setPackets] = useState<Packet[]>([]);
  useEffect(() => {
    const load = () => setPackets(vault.list());
    load();
    window.addEventListener("vault:changed", load);
    return () => window.removeEventListener("vault:changed", load);
  }, []);

  const latestBySource: Record<string, Packet | undefined> = {};
  for (const p of packets) if (!latestBySource[p.source]) latestBySource[p.source] = p;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div className="max-w-2xl">
          <p className="label-mono">Command Tools · directory</p>
          <h1
            className="mt-2 font-display text-[2rem] leading-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Every tool you've got.
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            One per problem. Run them when you need them — findings save straight to your vault.
          </p>
        </div>
        <Link
          to="/vault"
          className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3.5 py-2 text-[13px] font-medium text-cream hover:opacity-90"
        >
          <Archive className="h-3.5 w-3.5" /> Company Vault
        </Link>
      </div>

      <div className="mt-12 space-y-16">
        {TOOL_GROUPS.map((group, idx) => {
          const tools = toolsByGroup(group);
          if (tools.length === 0) return null;
          const num = String(idx + 1).padStart(2, "0");
          const count = String(tools.length).padStart(2, "0");
          return (
            <section key={group}>
              <div className="border-t border-border pt-6">
                <p className="label-mono">
                  Section {num} · {count} {tools.length === 1 ? "tool" : "tools"}
                </p>
                <h2
                  className="mt-3 font-display text-[28px] leading-[1.05] tracking-tight sm:text-[34px]"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {group}
                </h2>
                <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-muted-foreground">
                  {GROUP_LEDES[group]}
                </p>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tools.map((t) => (
                  <DirectoryCard
                    key={t.id}
                    tool={t}
                    packet={t.vaultSource ? latestBySource[t.vaultSource] : undefined}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const GROUP_LEDES: Record<string, string> = {
  "Make more money": "The plays that lift revenue without adding overhead.",
  "Protect margin and cash": "Stop the slow bleed inside jobs you've already won.",
  "Build the machine": "Install the systems that make the business run without you.",
  "Deliver better projects": "Tighten execution so every job ends clean.",
};

function DirectoryCard({ tool, packet }: { tool: CommandTool; packet?: Packet }) {
  const Icon = tool.icon;
  const drawer = useToolDrawer();
  const usesDrawer = hasToolDrawer(tool.id);
  const isLive = tool.status === "live";
  const hasRun = isLive && !!packet;

  const finding =
    packet && packet.kind === "command"
      ? packet.primaryFinding
      : packet?.kind === "issue"
        ? packet.needsPressure
        : undefined;

  if (!isLive) {
    return (
      <div className="flex h-full flex-col rounded-2xl border-2 border-dashed border-border bg-transparent p-5 opacity-70">
        <CardHeader Icon={Icon} status="soon" />
        <h3
          className="mt-4 font-display text-[19px] leading-snug text-foreground/75"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {tool.name}
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground/80">{tool.blurb}</p>
        <p className="mt-auto pt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
          Coming next
        </p>
      </div>
    );
  }

  const inner = (
    <>
      <CardHeader Icon={Icon} status={hasRun ? "live" : "ready"} />
      <h3
        className="mt-4 font-display text-[19px] leading-snug"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {tool.name}
      </h3>
      {hasRun && finding ? (
        <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-foreground/85">
          {finding}
        </p>
      ) : (
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{tool.blurb}</p>
      )}
      <div className="mt-auto flex items-center justify-between pt-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {hasRun ? relative(packet!.createdAt) : "Not run yet · ~4 min"}
        </span>
        <ArrowUpRight className="h-4 w-4 text-foreground/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
    </>
  );

  const shared =
    "group flex h-full flex-col rounded-2xl border-2 border-border bg-card/40 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/30 hover:bg-card hover:shadow-sm";

  if (usesDrawer) {
    return (
      <button type="button" onClick={() => drawer.open(tool.id)} className={shared}>
        {inner}
      </button>
    );
  }
  return (
    <Link to={tool.route as "/tools/growth-constraint"} className={shared}>
      {inner}
    </Link>
  );
}

function CardHeader({
  Icon,
  status,
}: {
  Icon: CommandTool["icon"];
  status: "live" | "ready" | "soon";
}) {
  const dot =
    status === "live" ? "bg-signal" : status === "ready" ? "bg-gold" : "bg-muted-foreground/40";
  const label = status === "live" ? "Live" : status === "ready" ? "Ready" : "Soon";
  return (
    <div className="flex items-center justify-between">
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-foreground/5 text-foreground/80">
        {status === "soon" ? <Lock className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
      </span>
      <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </span>
    </div>
  );
}

function relative(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
