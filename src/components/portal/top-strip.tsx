import { Link } from "@tanstack/react-router";
import { Command } from "lucide-react";

export function TopStrip() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-border/70 bg-background/70 px-6 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
          <span className="text-signal">●</span> Live · Member workspace
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="hidden items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted sm:inline-flex"
          aria-label="Command palette (coming soon)"
        >
          <Command className="h-3 w-3" />
          <span>Jump to…</span>
          <span className="ml-1 rounded border border-border bg-background px-1 font-mono text-[9px]">⌘K</span>
        </button>
        <Link
          to="/account"
          className="flex items-center gap-2 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] hover:bg-muted"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-[10px] font-medium text-cream">M</span>
          <span className="hidden sm:inline text-foreground/80">Marshall</span>
        </Link>
      </div>
    </header>
  );
}
