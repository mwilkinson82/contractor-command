import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getAosSnapshot, type AosResult, type AosCompany } from "@/lib/aos.functions";
import { AOS_URL } from "@/lib/program";
import { ArrowUpRight, Compass, Target, AlertCircle, CheckSquare, TrendingUp, ChevronDown } from "lucide-react";

const COMPANY_KEY = "aos.company_id";

export function AosPulse() {
  const fn = useServerFn(getAosSnapshot);
  const [companyId, setCompanyId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(COMPANY_KEY);
  });
  const [waitingForLink, setWaitingForLink] = useState(false);
  const wasLinkedRef = useRef<boolean | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<AosResult>({
    queryKey: ["aos-snapshot", companyId],
    queryFn: () => fn({ data: { companyId: companyId ?? undefined } }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    // While the user is finishing sign-in in another tab, poll every 4s
    refetchInterval: waitingForLink ? 4000 : false,
  });

  // Detect transition unlinked -> linked and notify the user
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

  // Auto-select the only company if none chosen yet
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
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 md:col-span-3 shadow-[var(--shadow-soft)]"
      style={{
        backgroundImage:
          "radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, var(--signal) 6%, transparent) 0%, transparent 55%), radial-gradient(100% 60% at 100% 100%, color-mix(in oklab, var(--signal-green) 5%, transparent) 0%, transparent 60%)",
      }}
    >
      {/* Corner brackets — quiet "instrument" framing */}
      <span aria-hidden className="pointer-events-none absolute left-2 top-2 h-3 w-3 border-l border-t border-paper-edge" />
      <span aria-hidden className="pointer-events-none absolute right-2 top-2 h-3 w-3 border-r border-t border-paper-edge" />
      <span aria-hidden className="pointer-events-none absolute left-2 bottom-2 h-3 w-3 border-l border-b border-paper-edge" />
      <span aria-hidden className="pointer-events-none absolute right-2 bottom-2 h-3 w-3 border-r border-b border-paper-edge" />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-ink text-cream">
            <Compass className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p
              className="text-[15px] italic text-foreground"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-signal align-middle animate-signal-pulse" />
              EOS Pulse
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Live from your operating system
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {companies.length > 1 && (
            <WorkspacePicker
              companies={companies}
              current={companyId}
              onPick={onPick}
            />
          )}
          <a
            href={AOS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background/70 px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-muted"
          >
            Open AOS <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="mt-5">
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
            onOpenAos={() => {
              setWaitingForLink(true);
              window.open(AOS_URL, "_blank", "noopener,noreferrer");
            }}
            onRecheck={() => refetch()}
          />
        ) : (
          <PulseGrid snapshot={data.snapshot} />
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

function PulseGrid({ snapshot }: { snapshot: Extract<AosResult, { ok: true }>["snapshot"] & { linked: true } }) {
  const rocksOnTrack = snapshot.rocks.filter((r) => r.status === "on-track" || r.status === "done").length;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        label="Scorecard"
        value={`${snapshot.scorecard.length}`}
        sub="measurables tracked"
      />
      <Tile
        icon={<Target className="h-3.5 w-3.5" />}
        label="Rocks"
        value={`${rocksOnTrack}/${snapshot.rocks.length}`}
        sub="on track this quarter"
      />
      <Tile
        icon={<AlertCircle className="h-3.5 w-3.5" />}
        label="Open issues"
        value={`${snapshot.issues_open.length}`}
        sub={snapshot.issues_open[0]?.title ?? "Nothing flagged"}
      />
      <Tile
        icon={<CheckSquare className="h-3.5 w-3.5" />}
        label="To-dos this week"
        value={`${snapshot.todos_due_this_week.length}`}
        sub={snapshot.todos_due_this_week[0]?.title ?? "All clear"}
      />
    </div>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex items-center gap-2 text-foreground">
        {icon}
        <p
          className="text-[15px] font-semibold leading-none"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          {label}
        </p>
      </div>
      <p className="mt-3 font-display text-2xl leading-none">{value}</p>
      <p className="mt-2 truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function PulseSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[104px] animate-pulse rounded-xl border border-border bg-muted/40" />
      ))}
    </div>
  );
}

function UnlinkedState({
  reason,
  previouslyLinked,
  waiting,
  isFetching,
  onOpenAos,
  onRecheck,
}: {
  reason: string;
  previouslyLinked: boolean;
  waiting: boolean;
  isFetching: boolean;
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
            className="inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90"
          >
            Refresh AOS session <ArrowUpRight className="h-3 w-3" />
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
          className="inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90"
        >
          Open AOS in new tab <ArrowUpRight className="h-3 w-3" />
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
