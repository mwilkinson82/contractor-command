import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Play, ExternalLink } from "lucide-react";
import { PageHeader, Container } from "@/components/portal/page-header";
import { replaysQueryOptions } from "@/lib/library-queries";

export const Route = createFileRoute("/replays")({
  head: () => ({
    meta: [
      { title: "Replays — ALP Contractor Circle" },
      { name: "description", content: "Archive of every biweekly working session and monthly bootcamp." },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.prefetchQuery(replaysQueryOptions());
  },
  component: ReplaysPage,
});

function ReplaysPage() {
  const { data: rows } = useQuery(replaysQueryOptions());
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string>("All");
  const [playing, setPlaying] = useState<Record<string, boolean>>({});


  const allTags = useMemo(() => {
    const set = new Set<string>();
    rows?.forEach((r) => r.tags.forEach((t) => set.add(t)));
    return ["All", ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (tag !== "All" && !r.tags.includes(tag)) return false;
      if (!needle) return true;
      const hay = [r.title, r.description ?? "", ...r.tags].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, tag]);

  return (
    <Container>
      <PageHeader
        eyebrow="Replay library"
        title={<>Every call, on demand.</>}
        lede="Every past biweekly call and monthly bootcamp. Search by topic. Watch what's already been worked so you don't bring it cold."
      />

      <div className="mt-8 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search replays…"
            className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-2 text-[13px] focus:border-ink focus:outline-none"
          />
        </div>
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-2 text-[13px] focus:border-ink focus:outline-none"
        >
          {allTags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="mt-6 grid gap-3">
        {rows === null ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No replays match.
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
                        Replay pending
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
    </Container>
  );
}
