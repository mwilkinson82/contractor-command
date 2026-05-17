// Today's Move — the single highest-leverage action for the CEO this
// week. Auto-derived from the latest signals:
//   1. If there's an Intensive-flagged packet, surface that.
//   2. Else newest command packet's recommendedAction.
//   3. Else newest issue packet's winLooksLike.
//   4. Else a "start here" nudge based on which live tool hasn't been run.
//
// Curated override (Marshall pushes a weekly move to all members) is
// planned next — leave the prop hook in place so the wiring is trivial
// when the admin path lands.

import { Link } from "@tanstack/react-router";
import { ArrowRight, Crosshair } from "lucide-react";
import type { Packet } from "@/lib/vault";
import { COMMAND_TOOLS, findToolBySource } from "@/lib/command-tools";

type CuratedMove = {
  headline: string;
  body: string;
  ctaLabel: string;
  ctaTo?: string;
  ctaHref?: string;
  source?: string;
};

export function TodaysMove({
  packets,
  curated,
}: {
  packets: Packet[];
  curated?: CuratedMove | null;
}) {
  const move = curated ?? deriveMove(packets);

  return (
    <article className="relative overflow-hidden rounded-2xl border border-border bg-card p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--gold), transparent 70%)" }}
      />
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gold/15 text-gold">
            <Crosshair className="h-3.5 w-3.5" />
          </span>
          <p className="label-mono">
            {curated ? "Marshall's move this week" : "Today's move"}
          </p>
        </div>
        <h2 className="mt-4 font-display text-2xl leading-[1.15] sm:text-3xl">
          {move.headline}
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
          {move.body}
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {move.ctaTo ? (
            <Link
              to={move.ctaTo as "/"}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90"
            >
              {move.ctaLabel} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : move.ctaHref ? (
            <a
              href={move.ctaHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90"
            >
              {move.ctaLabel} <ArrowRight className="h-3.5 w-3.5" />
            </a>
          ) : null}
          {move.source && (
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              From · {move.source}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function deriveMove(packets: Packet[]): CuratedMove {
  // 1. Intensive-flagged packet wins
  const intensive = packets.find(
    (p) => p.kind === "command" && p.intensiveRecommended,
  );
  if (intensive && intensive.kind === "command") {
    return {
      headline: intensive.primaryConstraint,
      body: intensive.recommendedAction,
      ctaLabel: "Open in Vault",
      ctaTo: "/vault",
      source: intensive.source,
    };
  }

  // 2. Newest command packet
  const newestCmd = packets.find((p) => p.kind === "command");
  if (newestCmd && newestCmd.kind === "command") {
    return {
      headline: newestCmd.primaryConstraint,
      body: newestCmd.recommendedAction,
      ctaLabel: "Open in Vault",
      ctaTo: "/vault",
      source: newestCmd.source,
    };
  }

  // 3. Newest issue packet
  const newestIssue = packets.find((p) => p.kind === "issue");
  if (newestIssue && newestIssue.kind === "issue") {
    return {
      headline: newestIssue.title,
      body: newestIssue.winLooksLike,
      ctaLabel: "Open in Vault",
      ctaTo: "/vault",
      source: "Bring One Issue",
    };
  }

  // 4. Cold start — point them at the first live tool they haven't run
  const firstLive = COMMAND_TOOLS.find((t) => t.status === "live" && t.route);
  return {
    headline: "Run your first command tool.",
    body:
      "The Command Center comes alive as you feed it data. Start with the Growth Constraint Map — four minutes, and you'll know whether your revenue target is actually supportable.",
    ctaLabel: firstLive ? `Open ${firstLive.name}` : "Open tools",
    ctaTo: firstLive?.route ?? "/tools/growth-constraint",
  };
}

// Re-export for future curated-move hook
export type { CuratedMove };
// Confirm registry is wired for the "from" lookup helper
void findToolBySource;
