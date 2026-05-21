import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Play, ExternalLink, Lock } from "lucide-react";
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

const SHELF_META: Record<ShelfKey, { label: string; eyebrow: string; lede: string }> = {
  circle_call: {
    label: "Circle Calls",
    eyebrow: "Bi-weekly + bootcamp",
    lede: "Every past bi-weekly working session and monthly bootcamp.",
  },
  power_hour: {
    label: "Power Hour",
    eyebrow: "Daily · Mon–Fri 8AM PT",
    lede: "Daily Power Hour replays from the ALP Hardcore room.",
  },
  sm_school: {
    label: "Sales & Marketing School",
    eyebrow: "Wednesdays · 7PM PT",
    lede: "Sales & Marketing School class replays.",
  },
  contractor_school: {
    label: "Contractor School",
    eyebrow: "Tuesdays · 7PM PT",
    lede: "Contractor School class replays — Hardcore only.",
  },
};

// What shelves does each tier see?
function unlockedShelves(tier: ReturnType<typeof useTier>["tier"]): ShelfKey[] {
  if (!tier) return [];
  switch (tier) {
    case "aos_only":
      return [];
    case "book_buyer":
      return ["circle_call"];
    case "power_hour":
      return ["power_hour"];
    case "sm_school":
      return ["sm_school"];
    case "intensive":
      return ["circle_call", "power_hour", "sm_school"];
    case "circle":
      return ["circle_call", "power_hour", "sm_school"];
    case "hardcore":
      return ["circle_call", "power_hour", "sm_school", "contractor_school"];
    default:
      return [];
  }
}

function ReplaysPage() {
  const { data: rows } = useQuery(replaysQueryOptions());
  const { tier, loading: tierLoading } = useTier();
  const shelves = useMemo(() => unlockedShelves(tier), [tier]);
  const [shelf, setShelf] = useState<ShelfKey | null>(null);
  const activeShelf: ShelfKey | null = shelf ?? shelves[0] ?? null;
  const [q, setQ] = useState("");
  const [playing, setPlaying] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    if (!activeShelf) return [];
    const needle = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => r.category === activeShelf)
      .filter((r) => {
        if (!needle) return true;
        const hay = [r.title, r.description ?? "", ...r.tags].join(" ").toLowerCase();
        return hay.includes(needle);
      });
  }, [rows, activeShelf, q]);

  return (
    <Container>
      <PageHeader
        eyebrow="Replay library"
        title={<>Every call, on demand.</>}
        lede="Each shelf shows the classes you're enrolled in. Search inside a shelf to find a topic."
      />

      {tierLoading ? (
        <div className="mt-8 text-sm text-muted-foreground">Loading shelves…</div>
      ) : shelves.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          You don't have replay access yet. Join Contractor Circle or pick up a class to unlock the library.
        </div>
      ) : (
        <>
          {/* Shelf tabs */}
          <div className="mt-8 flex flex-wrap gap-2 border-b border-border">
            {shelves.map((key) => {
              const meta = SHELF_META[key];
              const isActive = key === activeShelf;
              return (
                <button
                  key={key}
                  onClick={() => setShelf(key)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "border-ink text-foreground font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>

          {activeShelf && (
            <div className="mt-5">
              <p className="label-mono">{SHELF_META[activeShelf].eyebrow}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">{SHELF_META[activeShelf].lede}</p>
            </div>
          )}

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
    </Container>
  );
}
