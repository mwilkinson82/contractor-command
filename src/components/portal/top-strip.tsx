import { Link } from "@tanstack/react-router";
import { Sparkles, MessageCircle, PanelLeftClose, PanelLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDailyAskUsage } from "@/lib/ask.functions";
import { useAppSidebar } from "@/components/portal/app-sidebar";

export function TopStrip() {
  const usageFn = useServerFn(getDailyAskUsage);
  const { data } = useQuery({
    queryKey: ["ask-usage"],
    queryFn: () => usageFn(),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
  const remaining = data?.remaining ?? null;
  const limit = data?.limit ?? 30;
  const low = remaining !== null && remaining <= 5;
  const { collapsed, toggle } = useAppSidebar();

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-border/70 bg-background/70 px-6 backdrop-blur-md">
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
        <p
          className="text-[14px] text-muted-foreground"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          <span className="text-signal">●</span> Live · Contractor Circle
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          to="/ask"
          className="group inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-cream shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="text-[15px] italic leading-none">Ask Marshall</span>
        </Link>

        <Link
          to="/ask"
          title={`${remaining ?? "—"} of ${limit} messages with Marshall left today`}
          className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors sm:inline-flex ${
            low
              ? "border-signal/40 bg-gold-soft text-signal hover:bg-gold-soft/80"
              : "border-border bg-card text-foreground/80 hover:bg-muted"
          }`}
        >
          <MessageCircle className="h-3 w-3" />
          <span className="font-mono tabular-nums">
            {remaining ?? "—"}
            <span className="text-muted-foreground">/{limit}</span>
          </span>
          <span
            className="italic text-muted-foreground"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            today
          </span>
        </Link>

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
