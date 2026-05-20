import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { getAosSnapshot, mintAosSsoToken, type AosResult, type AosCompany } from "@/lib/aos.functions";
import {
  ArrowUpRight,
  Compass,
  Target,
  AlertCircle,
  CheckSquare,
  TrendingUp,
  ChevronDown,
  Play,
  CheckCircle2,
  CircleDashed,
} from "lucide-react";

const COMPANY_KEY = "aos.company_id";

export function AosPulse() {
  const fn = useServerFn(getAosSnapshot);
  const mint = useServerFn(mintAosSsoToken);
  const { user } = useAuth();
  const [companyId, setCompanyId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(COMPANY_KEY);
  });
  const [waitingForLink, setWaitingForLink] = useState(false);
  const [opening, setOpening] = useState(false);
  const wasLinkedRef = useRef<boolean | null>(null);

  // Open AOS in a NEW TAB so Circle stays open. Keeps the user's place,
  // lets the snapshot poll detect the link, and gives an obvious way back.
  const openAosInNewTab = useCallback(async () => {
    setOpening(true);
    // Pre-open a tab synchronously inside the click handler so popup blockers
    // don't kill it while the server fn is in-flight.
    const popup = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
    try {
      const res = await mint();
      if (res.ok) {
        if (popup) {
          popup.location.href = res.url;
        } else {
          // Popup blocked — fall back to same-tab navigation so the user isn't stuck.
          window.location.assign(res.url);
          return;
        }
        setWaitingForLink(true);
        toast.success("AOS opened in a new tab", {
          description: "Sign in there, then come back — we'll detect it automatically.",
        });
      } else {
        if (popup) popup.close();
        toast.error("Couldn't open AOS", { description: res.error });
      }
    } catch (e) {
      if (popup) popup.close();
      toast.error("Couldn't open AOS", {
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setOpening(false);
    }
  }, [mint]);


  const { data, isLoading, refetch, isFetching } = useQuery<AosResult>({
    queryKey: ["aos-snapshot", companyId],
    queryFn: () => fn({ data: { companyId: companyId ?? undefined } }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: waitingForLink ? 4000 : false,
    enabled: !!user,
  });

  useEffect(() => {
    if (!data || !data.ok) return;
    const linkedNow = data.snapshot.linked;
    if (wasLinkedRef.current === false && linkedNow) {
      toast.success("AOS connected", {
        description: "Your scorecard, rocks, and to-dos are now live.",
      });
      setWaitingForLink(false);
    }
    wasLinkedRef.current = linkedNow;
  }, [data]);

  useEffect(() => {
    if (companyId || !data || !data.ok) return;
    const list = data.snapshot.linked ? data.snapshot.companies : data.snapshot.companies ?? [];
    if (list.length === 1) {
      setCompanyId(list[0].id);
      window.localStorage.setItem(COMPANY_KEY, list[0].id);
    }
  }, [data, companyId]);

  const companies: AosCompany[] =
    data?.ok
      ? data.snapshot.linked
        ? data.snapshot.companies
        : (data.snapshot.companies ?? [])
      : [];

  const onPick = (id: string) => {
    setCompanyId(id);
    window.localStorage.setItem(COMPANY_KEY, id);
  };

  return (
    <article
      className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]"
    >
      {/* Corner brackets — quiet instrument framing */}
      <span aria-hidden className="pointer-events-none absolute left-2 top-2 h-3 w-3 border-l border-t border-paper-edge" />
      <span aria-hidden className="pointer-events-none absolute right-2 top-2 h-3 w-3 border-r border-t border-paper-edge" />
      <span aria-hidden className="pointer-events-none absolute left-2 bottom-2 h-3 w-3 border-l border-b border-paper-edge" />
      <span aria-hidden className="pointer-events-none absolute right-2 bottom-2 h-3 w-3 border-r border-b border-paper-edge" />

      {/* Header strip */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-md bg-ink text-cream">
            <Compass className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p
              className="text-[16px] italic text-foreground"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-signal-success align-middle animate-signal-pulse" />
              AOS Pulse
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Live from your operating system
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {companies.length > 1 && (
            <WorkspacePicker companies={companies} current={companyId} onPick={onPick} />
          )}
          <button
            type="button"
            disabled={opening}
            onClick={openAosInNewTab}
            className="inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90 disabled:opacity-60"
          >
            <Play className="h-3 w-3" /> {opening ? "Opening AOS…" : "Open AOS"} <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      </header>

      <div className="px-6 py-6">
        {isLoading ? (
          <PulseSkeleton />
        ) : !data || !data.ok ? (
          <ErrorState message={data && !data.ok ? data.error : "Loading failed."} />
        ) : !data.snapshot.linked ? (
          <UnlinkedState
            reason={data.snapshot.reason}
            previouslyLinked={data.previously_linked}
            waiting={waitingForLink}
            isFetching={isFetching}
            opening={opening}
            onOpenAos={openAosInNewTab}
            onRecheck={() => refetch()}
          />
        ) : (
          <PulseBoard snapshot={data.snapshot} companyName={data.snapshot.company_name} />
        )}
      </div>
    </article>
  );
}

function WorkspacePicker({
  companies,
  current,
  onPick,
}: {
  companies: AosCompany[];
  current: string | null;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = companies.find((c) => c.id === current) ?? companies[0];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-muted"
        title="Switch AOS workspace"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Workspace:</span>
        <span className="max-w-[160px] truncate">{selected?.name ?? "Select"}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onPick(c.id);
                setOpen(false);
              }}
              className={`block w-full truncate px-3 py-2 text-left text-[12px] hover:bg-muted ${
                c.id === current ? "bg-muted/60 font-medium" : ""
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PulseBoard({
  snapshot,
  companyName,
}: {
  snapshot: Extract<AosResult, { ok: true }>["snapshot"] & { linked: true };
  companyName: string | null;
}) {
  const offTrackRocks = snapshot.rocks.filter((r) => r.status === "off-track");
  const onTrackRocks = snapshot.rocks.filter(
    (r) => r.status === "on-track" || r.status === "done",
  );
  const overdueTodos = snapshot.todos_due_this_week.filter(
    (t) => t.due_date && new Date(t.due_date) < new Date(),
  );
  const topIssues = snapshot.issues_open.slice(0, 3);
  const scorecardSummary = snapshot.scorecard_summary;
  const scorecardCount = snapshot.scorecard.length || scorecardSummary?.metrics_count || 0;
  const rockCounts = snapshot.pulse_counts?.rocks;
  const issueCounts = snapshot.pulse_counts?.issues;
  const todoCounts = snapshot.pulse_counts?.todos;

  const weekLabel = new Date().toLocaleDateString(undefined, {
    weekday: undefined,
    month: "long",
    day: "numeric",
  });

  const attentionCount =
    ((rockCounts?.off_track ?? offTrackRocks.length) > 0 ? 1 : 0) +
    ((issueCounts?.open ?? topIssues.length) > 0 ? 1 : 0) +
    ((todoCounts?.overdue ?? overdueTodos.length) > 0 ? 1 : 0);

  return (
    <div className="space-y-6">
      {/* Title block, mirrors the AOS dashboard hero */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            {companyName ?? "Your workspace"} · Week of {weekLabel}
          </p>
          <h3 className="mt-2 font-display text-[1.6rem] leading-tight">
            What needs your attention this week
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            A quick read on the operating system before you scale the work.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] ${
            attentionCount > 0
              ? "border-signal/40 bg-signal/10 text-signal"
              : "border-signal-success/40 bg-signal-success/10 text-signal-success"
          }`}
        >
          {attentionCount > 0 ? (
            <>
              <AlertCircle className="h-3.5 w-3.5" />
              {attentionCount} area{attentionCount > 1 ? "s" : ""} to review
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" />
              All clear this week
            </>
          )}
        </span>
      </div>

      {/* 2x2 attention grid */}
      <div className="grid gap-4 md:grid-cols-2">
        <AttentionCard
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Scorecard"
          count={scorecardCount}
          countLabel="measurables tracked"
          tone={scorecardSummary && scorecardSummary.off_goal_this_week > 0 ? "warn" : "neutral"}
        >
          {snapshot.scorecard.length === 0 && scorecardSummary ? (
            <ul className="space-y-1.5">
              <Row
                title="Current week"
                badge={
                  scorecardSummary.off_goal_this_week > 0 ? (
                    <Pill tone="warn">{scorecardSummary.off_goal_this_week} off</Pill>
                  ) : (
                    <Pill tone="ok">on goal</Pill>
                  )
                }
                meta={`${scorecardSummary.on_goal_this_week} on goal · ${scorecardSummary.off_goal_this_week} off goal`}
              />
            </ul>
          ) : snapshot.scorecard.length === 0 ? (
            <Empty>Nothing tracked yet.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {snapshot.scorecard.slice(0, 3).map((m) => {
                const last = m.weeks[m.weeks.length - 1]?.value ?? null;
                const miss =
                  typeof m.goal === "number" && typeof last === "number" && last < m.goal;
                return (
                  <Row
                    key={m.id}
                    title={m.name}
                    badge={
                      miss ? (
                        <Pill tone="warn">miss</Pill>
                      ) : (
                        <Pill tone="ok">on goal</Pill>
                      )
                    }
                    meta={
                      typeof last === "number"
                        ? `${last}${m.unit ?? ""}${typeof m.goal === "number" ? ` · goal ${m.goal}${m.unit ?? ""}` : ""}`
                        : "no value this week"
                    }
                  />
                );
              })}
            </ul>
          )}
        </AttentionCard>

        <AttentionCard
          icon={<Target className="h-3.5 w-3.5" />}
          label="Rocks"
          count={`${rockCounts?.on_track ?? onTrackRocks.length}/${rockCounts?.total ?? snapshot.rocks.length}`}
          countLabel="on track this quarter"
          tone={(rockCounts?.off_track ?? offTrackRocks.length) > 0 ? "warn" : "ok"}
        >
          {snapshot.rocks.length === 0 ? (
            <Empty>No rocks for this quarter yet.</Empty>
          ) : offTrackRocks.length > 0 ? (
            <ul className="space-y-1.5">
              {offTrackRocks.slice(0, 3).map((r) => (
                <Row
                  key={r.id}
                  title={r.title}
                  badge={<Pill tone="warn">off track</Pill>}
                  meta={`${r.owner ?? "Unassigned"} · ${r.percent_complete}%`}
                />
              ))}
            </ul>
          ) : (
            <p className="inline-flex items-center gap-2 text-[12px] text-signal-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              All rocks on track.
            </p>
          )}
        </AttentionCard>

        <AttentionCard
          icon={<AlertCircle className="h-3.5 w-3.5" />}
          label="Top issues"
          count={issueCounts?.open ?? snapshot.issues_open.length}
          countLabel="open"
          tone={(issueCounts?.open ?? snapshot.issues_open.length) > 0 ? "warn" : "ok"}
        >
          {topIssues.length === 0 ? (
            <p className="inline-flex items-center gap-2 text-[12px] text-signal-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Nothing flagged.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {topIssues.map((i, idx) => (
                <Row
                  key={i.id}
                  rank={`#${idx + 1}`}
                  title={i.title}
                  meta={i.owner ?? "Unassigned"}
                />
              ))}
            </ul>
          )}
        </AttentionCard>

        <AttentionCard
          icon={<CheckSquare className="h-3.5 w-3.5" />}
          label="To-Dos"
          count={todoCounts?.open ?? snapshot.todos_due_this_week.length}
          countLabel="due this week"
          tone={(todoCounts?.overdue ?? overdueTodos.length) > 0 ? "warn" : "neutral"}
        >
          {snapshot.todos_due_this_week.length === 0 ? (
            <p className="inline-flex items-center gap-2 text-[12px] text-signal-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              All clear.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {snapshot.todos_due_this_week.slice(0, 3).map((t) => {
                const overdue =
                  t.due_date && new Date(t.due_date) < new Date();
                return (
                  <Row
                    key={t.id}
                    title={t.title}
                    badge={
                      overdue ? (
                        <Pill tone="warn">overdue</Pill>
                      ) : null
                    }
                    meta={t.owner ?? "Unassigned"}
                  />
                );
              })}
            </ul>
          )}
        </AttentionCard>
      </div>

      {/* Jump to chips */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Jump into AOS
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { label: "Scorecard", icon: <TrendingUp className="h-3 w-3" /> },
            { label: "Rocks", icon: <Target className="h-3 w-3" /> },
            { label: "Issues", icon: <AlertCircle className="h-3 w-3" /> },
            { label: "To-Dos", icon: <CheckSquare className="h-3 w-3" /> },
          ].map((c) => (
            <a
              key={c.label}
              href="/aos"

              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/70 px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-muted"
            >
              {c.icon} {c.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function AttentionCard({
  icon,
  label,
  count,
  countLabel,
  tone,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number | string;
  countLabel: string;
  tone: "ok" | "warn" | "neutral";
  children: React.ReactNode;
}) {
  const ring =
    tone === "warn"
      ? "border-signal/30"
      : tone === "ok"
        ? "border-signal-success/30"
        : "border-border";
  return (
    <a
      href="/aos"

      className={`group block rounded-2xl border ${ring} bg-background/60 p-5 transition-colors hover:bg-muted/40 hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      title={`Open ${label} in AOS`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-foreground">
          {icon}
          <p
            className="inline-flex items-center gap-1 text-[15px] font-semibold leading-none"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {label}
            <ArrowUpRight className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </p>
        </div>
        <div className="text-right leading-none">
          <p className="font-display text-2xl">{count}</p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {countLabel}
          </p>
        </div>
      </div>
      <div className="mt-4 text-[13px] text-foreground/85">{children}</div>
    </a>
  );
}

function Row({
  title,
  meta,
  badge,
  rank,
}: {
  title: string;
  meta?: string;
  badge?: React.ReactNode;
  rank?: string;
}) {
  return (
    <li className="flex items-start gap-2">
      {rank ? (
        <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">{rank}</span>
      ) : (
        <CircleDashed className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-foreground">{title}</p>
        {meta && (
          <p className="truncate text-[11px] text-muted-foreground">{meta}</p>
        )}
      </div>
      {badge}
    </li>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn";
  children: React.ReactNode;
}) {
  const cls =
    tone === "warn"
      ? "border-signal/30 bg-signal/10 text-signal"
      : "border-signal-success/30 bg-signal-success/10 text-signal-success";
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-muted-foreground">{children}</p>;
}

function PulseSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-1/2 animate-pulse rounded bg-muted/50" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[140px] animate-pulse rounded-2xl border border-border bg-muted/40" />
        ))}
      </div>
    </div>
  );
}

function UnlinkedState({
  reason,
  previouslyLinked,
  waiting,
  isFetching,
  opening,
  onOpenAos,
  onRecheck,
}: {
  reason: string;
  previouslyLinked: boolean;
  waiting: boolean;
  isFetching: boolean;
  opening: boolean;
  onOpenAos: () => void;
  onRecheck: () => void;
}) {
  if (previouslyLinked) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background/60 p-5">
        <p className="font-display text-[15px]">Reconnect to AOS</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          You've connected before — your AOS session just needs a quick refresh. Open AOS, then come back. We'll detect it automatically.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenAos}
            disabled={opening}
            className="inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90 disabled:opacity-60"
          >
            {opening ? "Opening AOS…" : "Refresh AOS session"} <ArrowUpRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onRecheck}
            className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-muted"
          >
            {isFetching ? "Checking…" : "Check now"}
          </button>
        </div>
        {waiting && (
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Waiting for AOS · auto-checking every few seconds
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-border bg-background/60 p-5">
      <p className="font-display text-[15px]">Connect your AOS workspace</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {reason ||
          "We couldn't match your Circle email to an AOS account yet. Follow the two steps below — we'll detect the connection automatically and light up this panel."}
      </p>

      <ol className="mt-4 space-y-2 text-[12px] text-foreground/80">
        <li className="flex gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">01</span>
          <span>Click <b>Open AOS</b>. It opens in a new tab — keep this tab open.</span>
        </li>
        <li className="flex gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">02</span>
          <span>Sign in to AOS using the <b>same email</b> you use here, then come back to this tab.</span>
        </li>
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onOpenAos}
          disabled={opening}
          className="inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90 disabled:opacity-60"
        >
          {opening ? "Opening AOS…" : "Open AOS in new tab"} <ArrowUpRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onRecheck}
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-muted"
        >
          {isFetching ? "Checking…" : "I've signed in — check now"}
        </button>
      </div>

      {waiting && (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Waiting for AOS sign-in · auto-checking every few seconds
        </p>
      )}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background/60 p-5">
      <p className="font-display text-[15px]">AOS Pulse unavailable</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{message}</p>
    </div>
  );
}
