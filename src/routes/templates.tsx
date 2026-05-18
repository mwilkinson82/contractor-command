import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { FileText, Search, ExternalLink, Download } from "lucide-react";
import { PageHeader, Container } from "@/components/portal/page-header";
import { supabase } from "@/integrations/supabase/client";
import { openTemplateFile, type TemplateRow } from "@/lib/library";

export const Route = createFileRoute("/templates")({
  head: () => ({ meta: [{ title: "Templates — ALP Contractor Circle" }] }),
  component: TemplatesPage,
});

function TemplatesPage() {
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("All");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("templates")
        .select("*")
        .order("featured", { ascending: false })
        .order("category", { ascending: true })
        .order("title", { ascending: true });
      if (error) {
        console.error("[templates] load failed", error);
        setRows([]);
        return;
      }
      setRows((data as TemplateRow[]) ?? []);
    })();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    rows?.forEach((r) => set.add(r.category));
    return ["All", ...Array.from(set).sort()];
  }, [rows]);

  const featured = useMemo(() => rows?.filter((r) => r.featured) ?? [], [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (cat !== "All" && r.category !== cat) return false;
      if (!needle) return true;
      return (
        r.title.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle) ||
        r.category.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, cat]);

  const grouped = useMemo(() => {
    const m = new Map<string, TemplateRow[]>();
    filtered.forEach((r) => {
      const list = m.get(r.category) ?? [];
      list.push(r);
      m.set(r.category, list);
    });
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <Container>
      <PageHeader
        eyebrow="Implementation assets"
        title={<>Templates that install<br/>the missing system.</>}
        lede="Every template here answers one question: what operating problem does this help solve? Organized by where it belongs in the business, not by file type."
      />

      {rows === null ? (
        <div className="mt-10 text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          {featured.length > 0 && (
            <section className="mt-12">
              <p className="label-mono">Top prescribed path</p>
              <ol className="mt-4 grid gap-2">
                {featured.map((t, i) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-6 rounded-xl border border-border bg-card p-5"
                  >
                    <div className="flex items-center gap-5">
                      <span className="font-mono text-xs text-gold">0{i + 1}</span>
                      <div>
                        <h3 className="font-display text-lg leading-tight">{t.title}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                      </div>
                    </div>
                    <OpenButton template={t} />
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="mt-12">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search templates…"
                  className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-2 text-[13px] focus:border-ink focus:outline-none"
                />
              </div>
              <select
                value={cat}
                onChange={(e) => setCat(e.target.value)}
                className="rounded-md border border-border bg-card px-3 py-2 text-[13px] focus:border-ink focus:outline-none"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {grouped.length === 0 ? (
              <div className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                <FileText className="mx-auto h-5 w-5" />
                <p className="mt-3">No templates available yet.</p>
              </div>
            ) : (
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                {grouped.map(([group, items]) => (
                  <div key={group} className="rounded-2xl border border-border bg-card p-6">
                    <h3 className="font-display text-lg">{group}</h3>
                    <ul className="mt-4 space-y-3">
                      {items.map((it) => (
                        <li
                          key={it.id}
                          className="flex items-start justify-between gap-4 border-t border-border pt-3 first:border-0 first:pt-0"
                        >
                          <div>
                            <p className="text-sm">{it.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{it.description}</p>
                          </div>
                          <OpenButton template={it} compact />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </Container>
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
