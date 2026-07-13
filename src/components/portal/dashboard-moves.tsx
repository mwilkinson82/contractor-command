import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CheckCircle2, CircleDot } from "lucide-react";

export type DashboardMove = {
  id: string;
  title: string;
  detail: string;
  source: string;
  status: string;
  owner?: string | null;
  to?: string;
  href?: string;
  tone?: "signal" | "critical" | "neutral";
};

export function WhatNeedsMove({ moves }: { moves: DashboardMove[] }) {
  return (
    <article className="border-t border-ink/20 bg-card">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-5 py-5 sm:px-6">
        <div>
          <p className="label-mono">What needs a move</p>
          <h2 className="mt-2 font-display text-[2rem] leading-none">
            The queue in front of the company.
          </h2>
        </div>
        <Link
          to="/vault"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-foreground/70 hover:text-foreground"
        >
          Open Company Vault <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      <ol>
        {moves.slice(0, 4).map((move, index) => (
          <li key={move.id} className="group border-b border-border last:border-b-0">
            <MoveAction move={move}>
              <div className="grid gap-3 px-5 py-4 sm:grid-cols-[42px_minmax(0,1fr)_auto] sm:items-center sm:px-6">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {move.tone === "critical" ? (
                      <CircleDot className="h-3.5 w-3.5 text-crit" />
                    ) : move.tone === "signal" ? (
                      <CircleDot className="h-3.5 w-3.5 text-signal" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <p className="text-[13px] font-semibold text-foreground">{move.title}</p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                    {move.detail}
                  </p>
                </div>
                <div className="flex items-center gap-3 pl-6 sm:pl-0">
                  <div className="text-right">
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                      {move.source}
                    </p>
                    <p
                      className={`mt-1 text-[10px] ${move.tone === "critical" ? "text-crit" : "text-foreground/70"}`}
                    >
                      {move.owner ? `${move.owner} · ` : ""}
                      {move.status}
                    </p>
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
              </div>
            </MoveAction>
          </li>
        ))}
      </ol>
    </article>
  );
}

function MoveAction({ move, children }: { move: DashboardMove; children: React.ReactNode }) {
  if (move.href) {
    return (
      <a href={move.href} target="_blank" rel="noreferrer" className="block hover:bg-muted/35">
        {children}
      </a>
    );
  }

  return (
    <Link to={(move.to ?? "/vault") as "/"} className="block hover:bg-muted/35">
      {children}
    </Link>
  );
}
