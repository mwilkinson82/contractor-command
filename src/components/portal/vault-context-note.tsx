import { Link } from "@tanstack/react-router";
import { Archive, ArrowRight, Brain } from "lucide-react";

type VaultContextMode = "ask" | "vault" | "saved" | "packet";

const COPY: Record<VaultContextMode, { label: string; title: string; body: string }> = {
  ask: {
    label: "Vault-aware",
    title: "Ask Marshall checks your saved operating context.",
    body:
      "Saved command packets, COS Navigator results, and tool findings give Marshall the read before you ask what to do next.",
  },
  vault: {
    label: "Operating memory",
    title: "This is the context Ask Marshall can use.",
    body:
      "When a command tool result is saved here, Ask Marshall can start from that diagnosis instead of generic advice.",
  },
  saved: {
    label: "Saved to operating memory",
    title: "Ask Marshall can now start from this diagnosis.",
    body:
      "Open Ask Marshall and ask what to do next. The saved packet travels with the conversation as operating context.",
  },
  packet: {
    label: "Ask Marshall context",
    title: "This packet can shape the next answer.",
    body:
      "Ask about this constraint and Marshall can use the saved finding, consequence, and next action as the starting point.",
  },
};

export function VaultContextNote({
  mode = "saved",
  compact = false,
  inline = false,
  showActions = true,
  className = "",
}: {
  mode?: VaultContextMode;
  compact?: boolean;
  inline?: boolean;
  showActions?: boolean;
  className?: string;
}) {
  const copy = COPY[mode];

  if (inline) {
    return (
      <div
        className={`inline-flex min-w-0 items-center gap-2 rounded-full border border-signal/25 bg-signal/5 px-3 py-1.5 text-[12px] text-foreground/75 ${className}`}
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-signal" />
        <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.2em] text-signal">
          {copy.label}
        </span>
        <span className="truncate">Checks Vault context before answering.</span>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border border-signal/25 bg-signal/5 ${
        compact ? "px-3 py-2.5" : "px-4 py-3"
      } ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-signal/15 text-signal">
            <Brain className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-signal">
              {copy.label}
            </p>
            <p
              className={`${compact ? "mt-0.5 text-[13px]" : "mt-1 text-[15px]"} font-medium leading-snug text-foreground`}
            >
              {copy.title}
            </p>
            <p
              className={`${compact ? "mt-1 text-[12px]" : "mt-1.5 text-[13px]"} leading-relaxed text-foreground/70`}
            >
              {copy.body}
            </p>
          </div>
        </div>
        {showActions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Link
              to="/ask"
              className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90"
            >
              Ask Marshall <ArrowRight className="h-3 w-3" />
            </Link>
            <Link
              to="/vault"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/70 px-3 py-1.5 text-[12px] text-foreground hover:bg-background"
            >
              <Archive className="h-3 w-3" /> Vault
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
