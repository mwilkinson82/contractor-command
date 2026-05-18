import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { FileText, Search, ExternalLink, Download, X } from "lucide-react";
import { PageHeader, Container } from "@/components/portal/page-header";
import { supabase } from "@/integrations/supabase/client";
import { openTemplateFile, type TemplateRow } from "@/lib/library";

export const Route = createFileRoute("/templates")({
  head: () => ({ meta: [{ title: "Templates — ALP Contractor Circle" }] }),
  component: TemplatesPage,
});

const AOS_CATEGORY = "AOS";
type SortMode = "newest" | "az";

function TemplatesPage() {
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");
  const [sort, setSort] = useState<SortMode>("newest");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) {
        console.error("[templates] load failed", error);
        setRows([]);
        return;
      }
      setRows((data as TemplateRow[]) ?? []);
    })();
  }, []);

  const aosItems = useMemo(
    () => (rows ?? []).filter((r) => r.category === AOS_CATEGORY),
    [rows],
  );

  const libraryRows = useMemo(
    () => (rows ?? []).filter((r) => r.category !== AOS_CATEGORY),
    [rows],
  );

  const categories = useMemo(() => {
    const set = new Set<string>();
    libraryRows.forEach((r) => set.add(r.category));
    return ["All", ...Array.from(set).sort()];
  }, [libraryRows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return libraryRows.filter((r) => {
      if (cat !== "All" && r.category !== cat) return false;
      if (!needle) return true;
      return (
        r.title.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle) ||
        r.category.toLowerCase().includes(needle)
      );
    });
  }, [libraryRows, q, cat]);

  const grouped = useMemo(() => {
    const m = new Map<string, TemplateRow[]>();
    filtered.forEach((r) => {
      const list = m.get(r.category) ?? [];
      list.push(r);
      m.set(r.category, list);
    });
    const sortItems = (items: TemplateRow[]) =>
      [...items].sort((a, b) => {
        if (sort === "az") return a.title.localeCompare(b.title);
        return (b.created_at ?? "").localeCompare(a.created_at ?? "");
      });
    return Array.from(m.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([g, items]) => [g, sortItems(items)] as const);
  }, [filtered, sort]);

  return (
    <Container>
      <PageHeader
        eyebrow="Implementation assets"
        title={<>Templates that install<br/>the missing system.</>}
        lede="Every template here answers one question: what operating problem does this help solve? Organized by where it belongs in the business, not by file type."
      />

      {rows === null ? (
        <div className="mt-10 space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-md bg-muted/40" />
          ))}
        </div>
      ) : (
        <>
          {aosItems.length > 0 && <AOSBand items={aosItems} />}

          <section className="mt-16">
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-3">
              <h2 className="font-display text-xl">The Library</h2>
              <span className="text-xs text-muted-foreground">
                {filtered.length} {filtered.length === 1 ? "template" : "templates"}
              </span>
            </div>

            {/* Controls */}
            <div className="sticky top-0 z-10 -mx-2 mt-4 flex flex-wrap items-center gap-3 bg-background/90 px-2 py-2 backdrop-blur">
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search templates…"
                  className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-2 text-[13px] focus:border-ink focus:outline-none"
                />
              </div>
              <div className="ml-auto flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Sort</span>
                <button
                  type="button"
                  onClick={() => setSort("newest")}
                  className={`rounded-md border px-2.5 py-1 ${sort === "newest" ? "border-ink bg-ink text-background" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
                >
                  Newest
                </button>
                <button
                  type="button"
                  onClick={() => setSort("az")}
                  className={`rounded-md border px-2.5 py-1 ${sort === "az" ? "border-ink bg-ink text-background" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
                >
                  A–Z
                </button>
              </div>
            </div>

            {/* Category chips */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {categories.map((c) => {
                const active = cat === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCat(c)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${active ? "border-ink bg-ink text-background" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>

            {grouped.length === 0 ? (
              <div className="mt-12 flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
                <FileText className="h-5 w-5" />
                {q.trim() ? (
                  <>
                    <p>No templates match &ldquo;{q}&rdquo;.</p>
                    <button
                      type="button"
                      onClick={() => { setQ(""); setCat("All"); }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      <X className="h-3 w-3" /> Clear
                    </button>
                  </>
                ) : (
                  <p>No templates available yet.</p>
                )}
              </div>
            ) : (
              <div className="mt-8 space-y-12">
                {grouped.map(([group, items]) => (
                  <section key={group}>
                    <div className="flex items-baseline justify-between border-b border-border pb-2">
                      <h3 className="label-mono">{group}</h3>
                      <span className="text-[11px] text-muted-foreground">
                        {items.length} {items.length === 1 ? "item" : "items"}
                      </span>
                    </div>
                    <ul>
                      {items.map((it) => (
                        <TemplateListRow key={it.id} template={it} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </Container>
  );
}

function AOSBand({ items }: { items: TemplateRow[] }) {
  return (
    <section className="mt-12 rounded-2xl border border-border bg-card p-8 md:p-10">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-gold" />
        <p className="label-mono">The Operating System</p>
      </div>
      <h2 className="mt-3 font-display text-3xl md:text-4xl leading-tight">
        AOS — Augmented Operating System
      </h2>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        The foundation. Owner dependency scorecards, V/TO, weekly L10 measurables, and the complete
        playbook for installing a real operating cadence in a contracting business.
      </p>

      <ul className="mt-8 grid gap-x-8 gap-y-0 md:grid-cols-2 xl:grid-cols-3">
        {items.map((it) => (
          <li
            key={it.id}
            className="flex items-start justify-between gap-4 border-t border-border py-4"
          >
            <div className="min-w-0">
              <p className="font-display text-[15px] leading-snug">{it.title}</p>
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{it.description}</p>
            </div>
            <OpenButton template={it} compact />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TemplateListRow({ template }: { template: TemplateRow }) {
  const added = template.created_at
    ? new Date(template.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;
  const metaBits = [
    template.file_type?.toUpperCase(),
    template.pages,
    added ? `Added ${added}` : null,
  ].filter(Boolean);

  return (
    <li className="flex items-center justify-between gap-6 border-b border-border py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="font-display text-[15px] leading-snug">{template.title}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {template.description}
          {metaBits.length > 0 && <span className="ml-2 text-muted-foreground/70">· {metaBits.join(" · ")}</span>}
        </p>
      </div>
      <OpenButton template={template} compact />
    </li>
  );
}

function OpenButton({ template, compact }: { template: TemplateRow; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const hasFile = !!template.download_url;
  const isExternal = !!template.download_url && /^https?:\/\//i.test(template.download_url);

  async function handleOpen() {
    if (!hasFile) return;
    setBusy(true);
    const url = await openTemplateFile(template.download_url);
    setBusy(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  if (!hasFile) {
    return (
      <span
        className={`shrink-0 rounded-md border border-dashed border-border bg-background px-2.5 py-1 text-xs text-muted-foreground ${compact ? "" : "px-3 py-1.5"}`}
      >
        Coming soon
      </span>
    );
  }

  const Icon = isExternal ? ExternalLink : Download;
  return (
    <button
      type="button"
      onClick={handleOpen}
      disabled={busy}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background hover:bg-muted ${compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-xs"} ${busy ? "opacity-60" : ""}`}
    >
      <Icon className="h-3 w-3" />
      {busy ? "Opening…" : "Open"}
    </button>
  );
}
