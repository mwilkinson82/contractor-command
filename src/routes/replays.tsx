import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Play, ExternalLink, Lock, ArrowRight } from "lucide-react";
import { PageHeader, Container } from "@/components/portal/page-header";
import { replaysQueryOptions } from "@/lib/library-queries";
import { useTier } from "@/hooks/use-tier";
import type { ReplayCategory } from "@/lib/library";

export const Route = createFileRoute("/replays")({
  head: () => ({
    meta: [
      { title: "Replays — ALP Contractor Circle" },
      { name: "description", content: "Archive of every working session, Power Hour, and class replay." },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.prefetchQuery(replaysQueryOptions());
  },
  component: ReplaysPage,
});

type ShelfKey = ReplayCategory;
// Only Circle Calls live in the replay portal. Power Hour, S&M School, and
// Contractor School recordings live inside the Google Meet calendar invite
// itself — Meet records and attaches them to the event automatically.
const ALL_SHELVES: ShelfKey[] = ["circle_call"];

const SHELF_META: Record<ShelfKey, { label: string; eyebrow: string; lede: string; unlockCopy: string }> = {
  circle_call: {
    label: "Circle Calls",
    eyebrow: "Bi-weekly + bootcamp",
    lede: "Every past bi-weekly working session and monthly bootcamp.",
    unlockCopy: "Unlock with Contractor Circle or higher.",
  },
  power_hour: {
    label: "Power Hour",
    eyebrow: "",
    lede: "",
    unlockCopy: "",
  },
  sm_school: {
    label: "Sales & Marketing School",
    eyebrow: "",
    lede: "",
    unlockCopy: "",
  },
  contractor_school: {
    label: "Contractor School",
    eyebrow: "",
    lede: "",
    unlockCopy: "",
  },
};

// What shelves does each tier see? Book buyers and AOS-only are locked.
function unlockedShelves(tier: ReturnType<typeof useTier>["tier"]): ShelfKey[] {
  if (!tier) return [];
  switch (tier) {
    case "aos_only":
    case "book_buyer":
      return [];
    case "intensive":
    case "power_hour":
    case "sm_school":
    case "contractor_school":
    case "circle":
    case "hardcore":
      return ["circle_call"];
    default:
      return [];
  }
}

function ReplaysPage() {
  const { data: rows } = useQuery(replaysQueryOptions());
  const { tier, loading: tierLoading } = useTier();
  const unlocked = useMemo(() => new Set(unlockedShelves(tier)), [tier]);
  const defaultShelf: ShelfKey = ALL_SHELVES.find((k) => unlocked.has(k)) ?? ALL_SHELVES[0];
  const [shelf, setShelf] = useState<ShelfKey | null>(null);
  const activeShelf: ShelfKey = shelf ?? defaultShelf;
  const activeUnlocked = unlocked.has(activeShelf);
  const [q, setQ] = useState("");
  const [playing, setPlaying] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    if (!activeUnlocked) return [];
    const needle = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => r.category === activeShelf)
      .filter((r) => {
        if (!needle) return true;
        const hay = [r.title, r.description ?? "", ...r.tags].join(" ").toLowerCase();
        return hay.includes(needle);
      });
  }, [rows, activeShelf, activeUnlocked, q]);

  return (
    <Container>
      <PageHeader
        eyebrow="Replay library"
        title={<>Every call, on demand.</>}
        lede="Each shelf shows the classes you're enrolled in. Locked shelves show what you're missing."
      />

      {tierLoading ? (
        <div className="mt-8 text-sm text-muted-foreground">Loading shelves…</div>
      ) : (
        <>
          {/* Shelf tabs — always render all 4 */}
          <div className="mt-8 flex flex-wrap gap-2 border-b border-border">
            {ALL_SHELVES.map((key) => {
              const meta = SHELF_META[key];
              const isActive = key === activeShelf;
              const isLocked = !unlocked.has(key);
              return (
                <button
                  key={key}
                  onClick={() => setShelf(key)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors inline-flex items-center gap-1.5 ${
                    isActive
                      ? "border-ink text-foreground font-medium"
                      : isLocked
                      ? "border-transparent text-muted-foreground/60 hover:text-foreground/70"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {isLocked && <Lock className="h-3 w-3" />}
                  {meta.label}
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            <p className="label-mono">{SHELF_META[activeShelf].eyebrow}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{SHELF_META[activeShelf].lede}</p>
          </div>

          {!activeUnlocked ? (
            <LockedShelf shelfKey={activeShelf} />
          ) : (
            <>


          <div className="mt-6 flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search this shelf…"
                className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-2 text-[13px] focus:border-ink focus:outline-none"
              />
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            {rows === undefined ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                No replays here yet.
              </div>
            ) : (
              filtered.map((r) => {
                const isPlaying = !!playing[r.id];
                const isEmbeddable =
                  !!r.video_url &&
                  (r.video_url.includes("iframe.videodelivery.net") ||
                    r.video_url.includes("zoom.us/clips/embed"));
                return (
                  <article key={r.id} className="overflow-hidden rounded-2xl border border-border bg-card">
                    <div className="p-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="max-w-2xl">
                          <p className="label-mono">
                            {new Date(r.recorded_at).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                            {r.duration_minutes ? ` · ${r.duration_minutes} min` : ""}
                          </p>
                          <h3 className="mt-2 font-display text-xl leading-snug">{r.title}</h3>
                          {r.description ? (
                            <p className="mt-3 text-sm text-muted-foreground">{r.description}</p>
                          ) : null}
                        </div>
                        {r.video_url ? (
                          isEmbeddable ? (
                            <button
                              onClick={() => setPlaying((p) => ({ ...p, [r.id]: !p[r.id] }))}
                              className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm text-cream hover:opacity-90"
                            >
                              <Play className="h-3.5 w-3.5" /> {isPlaying ? "Hide" : "Watch"} replay
                            </button>
                          ) : (
                            <a
                              href={r.video_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm text-cream hover:opacity-90"
                            >
                              <ExternalLink className="h-3.5 w-3.5" /> Open replay
                            </a>
                          )
                        ) : (
                          <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-4 py-2 text-sm text-muted-foreground">
                            <Lock className="h-3.5 w-3.5" /> Replay pending
                          </span>
                        )}
                      </div>
                      {r.tags.length > 0 && (
                        <div className="mt-5 flex flex-wrap gap-1.5 border-t border-border pt-4">
                          {r.tags.map((t) => (
                            <span
                              key={t}
                              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {isPlaying && isEmbeddable && r.video_url && (
                      <div className="aspect-video w-full border-t border-border bg-black">
                        <iframe
                          src={r.video_url}
                          className="h-full w-full"
                          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                          allowFullScreen
                          title={r.title}
                        />
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
            </>
          )}
        </>
      )}
    </Container>
  );
}

function LockedShelf({ shelfKey }: { shelfKey: ShelfKey }) {
  return (
    <div className="relative mt-6">
      <div className="grid gap-3 opacity-40 pointer-events-none select-none" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-6">
            <p className="label-mono">— · — min</p>
            <div className="mt-2 h-5 w-2/3 rounded bg-muted" />
            <div className="mt-3 h-3 w-full rounded bg-muted" />
            <div className="mt-1.5 h-3 w-5/6 rounded bg-muted" />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="rounded-2xl border border-ink/15 bg-[var(--paper-deep)] px-6 py-5 text-center shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> Locked
          </div>
          <p className="mt-2 max-w-sm text-[14px]">{SHELF_META[shelfKey].unlockCopy}</p>
          <Link
            to="/upgrade"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[11px] uppercase tracking-[0.22em] text-cream hover:opacity-90"
          >
            See upgrade options <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
