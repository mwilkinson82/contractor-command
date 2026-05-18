// Signal tiles — single editorial grid for the command tools instrument
// panel. With ~6 live tools, dropping the 4-group taxonomy reads cleaner:
// every tool gets one well-spaced card, ordered by recency (latest run
// first, never-run after, coming-soon footnoted at the bottom).

import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ArrowUpRight, Lock } from "lucide-react";
import {
  COMMAND_TOOLS,
  type CommandTool,
} from "@/lib/command-tools";
import type { Packet } from "@/lib/vault";
import { hasToolDrawer, useToolDrawer } from "@/components/portal/tool-drawer";

type LatestBySource = Record<string, Packet | undefined>;

function buildLatest(packets: Packet[]): LatestBySource {
  const out: LatestBySource = {};
  for (const p of packets) if (!out[p.source]) out[p.source] = p;
  return out;
}

export function SignalTiles({ packets }: { packets: Packet[] }) {
  const latest = useMemo(() => buildLatest(packets), [packets]);

  const live = COMMAND_TOOLS.filter((t) => t.status === "live");
  const coming = COMMAND_TOOLS.filter((t) => t.status !== "live");

  // Sort live tools: most-recent run first, then never-run.
  const sortedLive = [...live].sort((a, b) => {
    const ap = a.vaultSource ? latest[a.vaultSource] : undefined;
    const bp = b.vaultSource ? latest[b.vaultSource] : undefined;
    if (ap && bp) return new Date(bp.createdAt).getTime() - new Date(ap.createdAt).getTime();
    if (ap) return -1;
    if (bp) return 1;
    return 0;
  });

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sortedLive.map((t) => (
          <Tile key={t.id} tool={t} packet={t.vaultSource ? latest[t.vaultSource] : undefined} />
        ))}
      </div>

      {coming.length > 0 && (
        <div className="mt-8 border-t border-dashed border-border pt-5">
          <p className="label-mono">Up next</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {coming.map((t) => {
              const Icon = t.icon;
              return (
                <li
                  key={t.id}
                  className="inline-flex items-center gap-2 rounded-full border border-dashed border-border bg-background/40 px-3 py-1.5 text-[12.5px] text-muted-foreground"
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-foreground/75">{t.name}</span>
                  <Lock className="h-3 w-3 opacity-60" />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Tile({ tool, packet }: { tool: CommandTool; packet?: Packet }) {
  const Icon = tool.icon;
  const drawer = useToolDrawer();
  const usesDrawer = hasToolDrawer(tool.id);
  const hasRun = !!packet;

  const finding =
    packet && packet.kind === "command"
      ? packet.primaryFinding
      : packet?.kind === "issue"
        ? packet.needsPressure
        : undefined;

  const shared =
    "group relative flex h-full flex-col rounded-2xl border border-border bg-card p-5 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-[0_12px_30px_-18px_color-mix(in_oklab,var(--ink)_28%,transparent)]";

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-foreground/5 text-foreground/80">
          <Icon className="h-4 w-4" />
        </span>
        <StatusBadge live={hasRun} />
      </div>

      <h3
        className="mt-4 font-display text-[19px] leading-snug text-foreground"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {tool.name}
      </h3>

      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {tool.group}
      </p>

      {hasRun && finding ? (
        <p className="mt-3 line-clamp-3 text-[13.5px] leading-relaxed text-foreground/85">
          {finding}
        </p>
      ) : (
        <p className="mt-3 line-clamp-2 text-[13.5px] leading-relaxed text-muted-foreground">
          {tool.blurb}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between pt-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {hasRun ? relative(packet!.createdAt) : "Not run yet · ~4 min"}
        </span>
        <ArrowUpRight className="h-4 w-4 text-foreground/55 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
    </>
  );

  if (usesDrawer) {
    return (
      <button type="button" onClick={() => drawer.open(tool.id)} className={shared}>
        {body}
      </button>
    );
  }
  return (
    <Link to={tool.route as "/tools/growth-constraint"} className={shared}>
      {body}
    </Link>
  );
}

function StatusBadge({ live }: { live: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted-foreground">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${live ? "bg-signal animate-signal-pulse" : "bg-gold"}`}
      />
      {live ? "Latest run" : "Ready"}
    </span>
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
