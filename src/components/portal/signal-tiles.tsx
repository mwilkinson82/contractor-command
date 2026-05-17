// Signal tiles — one card per command tool. Live tools surface the
// latest vault packet finding. Coming-next tools stay visible but
// quieter, so the CEO sees the full instrument panel and knows what's
// still dark.

import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowUpRight, Lock } from "lucide-react";
import {
  COMMAND_TOOLS,
  TOOL_GROUPS,
  type CommandTool,
  type ToolGroup,
  toolsByGroup,
} from "@/lib/command-tools";
import type { Packet } from "@/lib/vault";

type LatestBySource = Record<string, Packet | undefined>;

function buildLatest(packets: Packet[]): LatestBySource {
  const out: LatestBySource = {};
  for (const p of packets) {
    if (!out[p.source]) out[p.source] = p;
  }
  return out;
}

export function SignalTiles({ packets }: { packets: Packet[] }) {
  const latest = useMemo(() => buildLatest(packets), [packets]);

  return (
    <div className="space-y-8">
      {TOOL_GROUPS.map((group) => (
        <GroupBlock key={group} group={group} latest={latest} />
      ))}
    </div>
  );
}

function GroupBlock({ group, latest }: { group: ToolGroup; latest: LatestBySource }) {
  const tools = toolsByGroup(group);
  return (
    <div>
      <p className="label-mono">{group}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tools.map((t) => (
          <Tile key={t.id} tool={t} packet={t.vaultSource ? latest[t.vaultSource] : undefined} />
        ))}
      </div>
    </div>
  );
}

function Tile({ tool, packet }: { tool: CommandTool; packet?: Packet }) {
  const Icon = tool.icon;
  const isLive = tool.status === "live";
  const hasRun = isLive && !!packet;

  const finding =
    packet && packet.kind === "command"
      ? packet.primaryFinding
      : packet?.kind === "issue"
        ? packet.needsPressure
        : undefined;

  // Live tool, never run yet
  if (isLive && !hasRun) {
    return (
      <Link
        to={tool.route as "/tools/growth-constraint"}
        className="group relative flex h-full flex-col rounded-2xl border-2 border-border bg-transparent p-4 transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-card"
      >
        <TileHeader Icon={Icon} status="ready" />
        <h3 className="mt-3 font-display text-[17px] leading-snug">{tool.name}</h3>
        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{tool.blurb}</p>
        <p className="mt-auto pt-3 text-[11px] font-medium text-gold">
          Not run yet — takes 4 min →
        </p>
      </Link>
    );
  }

  // Live tool, already has a packet
  if (isLive && hasRun) {
    return (
      <Link
        to={tool.route as "/tools/growth-constraint"}
        className="group relative flex h-full flex-col rounded-2xl border-2 border-border bg-transparent p-4 transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:bg-card"
      >
        <TileHeader Icon={Icon} status="live" />
        <h3 className="mt-3 font-display text-[17px] leading-snug">{tool.name}</h3>
        <p
          className="mt-2 line-clamp-3 text-[12px] leading-snug text-foreground/85"
          title={finding}
        >
          {finding ?? packet!.title}
        </p>
        <div className="mt-auto flex items-center justify-between pt-3 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          <span className="font-mono">{relative(packet!.createdAt)}</span>
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </div>
      </Link>
    );
  }

  // Coming-next placeholder
  return (
    <div className="relative flex h-full flex-col rounded-2xl border-2 border-dashed border-border bg-transparent p-4 opacity-70">
      <TileHeader Icon={Icon} status="soon" />
      <h3 className="mt-3 font-display text-[17px] leading-snug text-foreground/75">{tool.name}</h3>
      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/80">{tool.blurb}</p>
      <p className="mt-auto pt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70">
        Coming next
      </p>
    </div>
  );
}

function TileHeader({
  Icon,
  status,
}: {
  Icon: CommandTool["icon"];
  status: "live" | "ready" | "soon";
}) {
  const dot =
    status === "live"
      ? "bg-signal"
      : status === "ready"
        ? "bg-gold"
        : "bg-muted-foreground/40";
  const label = status === "live" ? "Live" : status === "ready" ? "Ready" : "Soon";
  return (
    <div className="flex items-center justify-between">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-foreground/5 text-foreground/80">
        {status === "soon" ? <Lock className="h-3 w-3" /> : <Icon className="h-3.5 w-3.5" />}
      </span>
      <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </span>
    </div>
  );
}

function relative(iso: string) {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
