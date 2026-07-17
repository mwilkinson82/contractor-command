import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Container } from "@/components/portal/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { TEMPLATE_BUCKET, type ReplayRow, type TemplateRow } from "@/lib/library";
import { Trash2, Plus, Upload, ExternalLink, Loader2, Eye, EyeOff, Star } from "lucide-react";

export const Route = createFileRoute("/admin/library")({
  head: () => ({ meta: [{ title: "Library admin — ALP Contractor Circle" }] }),
  component: AdminLibraryPage,
});

function AdminLibraryPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"templates" | "replays">("templates");

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  if (isAdmin === null) {
    return (
      <Container className="py-10">
        <p className="text-sm text-muted-foreground">Checking access…</p>
      </Container>
    );
  }
  if (!isAdmin) return null;

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="label-mono">Admin · Library</p>
          <h1 className="mt-2 font-display text-3xl" style={{ fontFamily: "var(--font-serif)" }}>
            Templates &amp; Replays
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Add, edit, and publish what members see in the Library.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/templates"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            View Templates
          </Link>
          <Link
            to="/replays"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            View Replays
          </Link>
        </div>
      </div>

      <div className="mt-6 flex rounded-md border border-border bg-card p-0.5 w-fit">
        {(["templates", "replays"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded px-3 py-1.5 text-[12px] capitalize ${
              tab === k ? "bg-ink text-cream" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="mt-6">{tab === "templates" ? <TemplatesAdmin /> : <ReplaysAdmin />}</div>
    </Container>
  );
}

// ---------------- Templates ----------------

function TemplatesAdmin() {
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    const { data } = await supabase
      .from("templates")
      .select("*")
      .order("category", { ascending: true })
      .order("title", { ascending: true });
    setRows((data as TemplateRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function addBlank() {
    const { error } = await supabase.from("templates").insert({
      title: "New template",
      category: "Operating System",
      description: "",
      file_type: "pdf",
      published: false,
      featured: false,
      highlights: [],
    });
    if (error) {
      alert(error.message);
      return;
    }
    await reload();
  }

  const grouped = useMemo(() => {
    const m = new Map<string, TemplateRow[]>();
    for (const r of rows) {
      const list = m.get(r.category) ?? [];
      list.push(r);
      m.set(r.category, list);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">
          {rows.length} template{rows.length === 1 ? "" : "s"} ·{" "}
          {rows.filter((r) => r.published).length} published
        </p>
        <button
          onClick={addBlank}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12px] text-cream hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> Add template
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No templates yet. Add one to get started.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, items]) => (
            <section key={category}>
              <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
                <h3 className="label-mono">{category}</h3>
                <span className="text-[11px] text-muted-foreground">{items.length}</span>
              </div>
              <div className="grid gap-3">
                {items.map((r) => (
                  <TemplateRowEditor key={r.id} row={r} onChange={reload} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateRowEditor({ row, onChange }: { row: TemplateRow; onChange: () => void }) {
  const [draft, setDraft] = useState<TemplateRow>(row);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(row);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("templates")
      .update({
        title: draft.title,
        category: draft.category,
        description: draft.description,
        long_description: draft.long_description,
        download_url: draft.download_url,
        file_type: draft.file_type,
        pages: draft.pages,
        badge: draft.badge,
        published: draft.published,
        featured: draft.featured,
        highlights: draft.highlights,
      })
      .eq("id", row.id);
    setSaving(false);
    if (error) {
      alert(error.message);
      return;
    }
    onChange();
  }

  async function togglePublished() {
    const next = !draft.published;
    setDraft({ ...draft, published: next });
    await supabase.from("templates").update({ published: next }).eq("id", row.id);
    onChange();
  }
  async function toggleFeatured() {
    const next = !draft.featured;
    setDraft({ ...draft, featured: next });
    await supabase.from("templates").update({ featured: next }).eq("id", row.id);
    onChange();
  }

  async function remove() {
    if (!confirm(`Delete "${row.title}"?`)) return;
    const { error } = await supabase.from("templates").delete().eq("id", row.id);
    if (error) {
      alert(error.message);
      return;
    }
    onChange();
  }

  async function uploadFile(file: File) {
    setUploading(true);
    const ext = file.name.split(".").pop() || "pdf";
    const path = `${row.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(TEMPLATE_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) {
      setUploading(false);
      alert(error.message);
      return;
    }
    setDraft({ ...draft, download_url: path, file_type: ext });
    await supabase
      .from("templates")
      .update({ download_url: path, file_type: ext })
      .eq("id", row.id);
    setUploading(false);
    onChange();
  }

  const hasFile = !!draft.download_url;
  const isExternal = hasFile && /^https?:\/\//i.test(draft.download_url!);

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Category">
          <input
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <textarea
            rows={2}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="File URL (or upload below)">
          <input
            value={draft.download_url ?? ""}
            onChange={(e) => setDraft({ ...draft, download_url: e.target.value || null })}
            placeholder="https://… or storage path"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Pages / Badge">
          <div className="flex gap-2">
            <input
              value={draft.pages ?? ""}
              onChange={(e) => setDraft({ ...draft, pages: e.target.value || null })}
              placeholder="12 pages"
              className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
            />
            <input
              value={draft.badge ?? ""}
              onChange={(e) => setDraft({ ...draft, badge: e.target.value || null })}
              placeholder="NEW"
              className="w-24 rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
            />
          </div>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <label
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted ${uploading ? "opacity-60" : ""}`}
        >
          {uploading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          {uploading ? "Uploading…" : "Upload file"}
          <input
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadFile(f);
              e.target.value = "";
            }}
          />
        </label>
        {hasFile && (
          <span className="inline-flex items-center gap-1 rounded-full bg-foreground/5 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {isExternal ? (
              <>
                <ExternalLink className="h-3 w-3" /> external
              </>
            ) : (
              "stored"
            )}
          </span>
        )}
        <button
          onClick={togglePublished}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs ${draft.published ? "bg-signal/15 text-signal" : "border border-border text-muted-foreground hover:bg-muted"}`}
        >
          {draft.published ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          {draft.published ? "Published" : "Draft"}
        </button>
        <button
          onClick={toggleFeatured}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs ${draft.featured ? "bg-gold/15 text-gold" : "border border-border text-muted-foreground hover:bg-muted"}`}
        >
          <Star className="h-3 w-3" /> {draft.featured ? "Featured" : "Feature"}
        </button>
        <div className="ml-auto flex gap-2">
          <button
            onClick={remove}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-destructive hover:bg-muted"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className={`rounded-md px-3 py-1.5 text-xs text-cream ${dirty ? "bg-ink hover:opacity-90" : "bg-muted-foreground/40 cursor-not-allowed"}`}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- Replays ----------------

function ReplaysAdmin() {
  const [rows, setRows] = useState<ReplayRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [resourceLinks, setResourceLinks] = useState<
    Array<{ replay_id: string; template_id: string }>
  >([]);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    const [replaysResult, templatesResult, resourcesResult] = await Promise.all([
      supabase.from("replays").select("*").order("recorded_at", { ascending: false }),
      supabase.from("templates").select("*").order("category").order("title"),
      supabase.from("replay_resources").select("replay_id, template_id"),
    ]);
    setRows((replaysResult.data as ReplayRow[]) ?? []);
    setTemplates((templatesResult.data as TemplateRow[]) ?? []);
    setResourceLinks(resourcesResult.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function addBlank() {
    const { error } = await supabase.from("replays").insert({
      title: "New replay",
      description: "",
      recorded_at: new Date().toISOString(),
      published: false,
      featured: false,
      tags: [],
    });
    if (error) {
      alert(error.message);
      return;
    }
    await reload();
  }

  const grouped = useMemo(() => {
    const m = new Map<string, ReplayRow[]>();
    for (const r of rows) {
      const d = new Date(r.recorded_at);
      const key = d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
      const list = m.get(key) ?? [];
      list.push(r);
      m.set(key, list);
    }
    return Array.from(m.entries());
  }, [rows]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] text-muted-foreground">
          {rows.length} replay{rows.length === 1 ? "" : "s"} ·{" "}
          {rows.filter((r) => r.published).length} published
        </p>
        <button
          onClick={addBlank}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12px] text-cream hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> Add replay
        </button>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No replays yet.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([month, items]) => (
            <section key={month}>
              <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
                <h3 className="label-mono">{month}</h3>
                <span className="text-[11px] text-muted-foreground">{items.length}</span>
              </div>
              <div className="grid gap-3">
                {items.map((r) => (
                  <ReplayRowEditor
                    key={r.id}
                    row={r}
                    templates={templates}
                    linkedTemplateIds={resourceLinks
                      .filter((link) => link.replay_id === r.id)
                      .map((link) => link.template_id)}
                    onChange={reload}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplayRowEditor({
  row,
  templates,
  linkedTemplateIds,
  onChange,
}: {
  row: ReplayRow;
  templates: TemplateRow[];
  linkedTemplateIds: string[];
  onChange: () => void;
}) {
  const [draft, setDraft] = useState<ReplayRow>(row);
  const [tagsInput, setTagsInput] = useState(row.tags.join(", "));
  const [resourceTemplateIds, setResourceTemplateIds] = useState(linkedTemplateIds);
  const [saving, setSaving] = useState(false);

  const tags = useMemo(
    () =>
      tagsInput
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    [tagsInput],
  );
  const normalizedResourceIds = [...resourceTemplateIds].sort();
  const normalizedLinkedIds = [...linkedTemplateIds].sort();
  const dirty =
    JSON.stringify({ ...draft, tags, resourceTemplateIds: normalizedResourceIds }) !==
    JSON.stringify({ ...row, tags: row.tags, resourceTemplateIds: normalizedLinkedIds });

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("replays")
      .update({
        title: draft.title,
        description: draft.description,
        video_url: draft.video_url,
        share_url: draft.share_url,
        thumbnail_url: draft.thumbnail_url,
        duration_minutes: draft.duration_minutes,
        recorded_at: draft.recorded_at,
        published: draft.published,
        tags,
      })
      .eq("id", row.id);
    if (error) {
      setSaving(false);
      alert(error.message);
      return;
    }
    const { error: deleteResourcesError } = await supabase
      .from("replay_resources")
      .delete()
      .eq("replay_id", row.id);
    if (deleteResourcesError) {
      setSaving(false);
      alert(deleteResourcesError.message);
      return;
    }
    if (resourceTemplateIds.length > 0) {
      const { error: insertResourcesError } = await supabase.from("replay_resources").insert(
        resourceTemplateIds.map((templateId, index) => ({
          replay_id: row.id,
          template_id: templateId,
          sort_order: index,
        })),
      );
      if (insertResourcesError) {
        setSaving(false);
        alert(insertResourcesError.message);
        return;
      }
    }
    setSaving(false);
    onChange();
  }
  async function togglePublished() {
    const next = !draft.published;
    setDraft({ ...draft, published: next });
    await supabase.from("replays").update({ published: next }).eq("id", row.id);
    onChange();
  }
  async function toggleFeatured() {
    const next = !draft.featured;
    if (next) {
      const { error: clearError } = await supabase
        .from("replays")
        .update({ featured: false })
        .neq("id", row.id);
      if (clearError) {
        alert(clearError.message);
        return;
      }
    }
    const { error } = await supabase.from("replays").update({ featured: next }).eq("id", row.id);
    if (error) {
      alert(error.message);
      return;
    }
    setDraft({ ...draft, featured: next });
    onChange();
  }
  async function remove() {
    if (!confirm(`Delete "${row.title}"?`)) return;
    const { error } = await supabase.from("replays").delete().eq("id", row.id);
    if (error) {
      alert(error.message);
      return;
    }
    onChange();
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2">
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <textarea
            rows={2}
            value={draft.description ?? ""}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Video URL">
          <input
            value={draft.video_url ?? ""}
            onChange={(e) => setDraft({ ...draft, video_url: e.target.value || null })}
            placeholder="https://zoom.us/rec/share/…"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Share URL">
          <input
            value={draft.share_url ?? ""}
            onChange={(e) => setDraft({ ...draft, share_url: e.target.value || null })}
            placeholder="https://video.alpcontractorcircle.com/…"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Thumbnail URL" className="sm:col-span-2">
          <input
            value={draft.thumbnail_url ?? ""}
            onChange={(e) => setDraft({ ...draft, thumbnail_url: e.target.value || null })}
            placeholder="https://…"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Recorded at">
          <input
            type="datetime-local"
            value={toLocalInput(draft.recorded_at)}
            onChange={(e) =>
              setDraft({ ...draft, recorded_at: new Date(e.target.value).toISOString() })
            }
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Duration (min)">
          <input
            type="number"
            value={draft.duration_minutes ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                duration_minutes: e.target.value ? Number(e.target.value) : null,
              })
            }
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Tags (comma-separated)" className="sm:col-span-2">
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="Biweekly Call, Cash, Billing"
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Companion resources" className="sm:col-span-2">
          <div className="max-h-52 overflow-y-auto rounded border border-border bg-background p-2">
            {templates.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                Add a template first, then link it to this replay.
              </p>
            ) : (
              <div className="grid gap-1 sm:grid-cols-2">
                {templates.map((template) => {
                  const checked = resourceTemplateIds.includes(template.id);
                  return (
                    <label
                      key={template.id}
                      className={`flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-xs ${checked ? "bg-signal/10" : "hover:bg-muted"}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setResourceTemplateIds((current) =>
                            checked
                              ? current.filter((id) => id !== template.id)
                              : [...current, template.id],
                          )
                        }
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block font-medium">{template.title}</span>
                        <span className="text-muted-foreground">
                          {template.category}
                          {template.pages ? ` · ${template.pages}` : ""}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          onClick={togglePublished}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs ${draft.published ? "bg-signal/15 text-signal" : "border border-border text-muted-foreground hover:bg-muted"}`}
        >
          {draft.published ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          {draft.published ? "Published" : "Draft"}
        </button>
        <button
          onClick={toggleFeatured}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs ${draft.featured ? "bg-gold/15 text-gold" : "border border-border text-muted-foreground hover:bg-muted"}`}
        >
          <Star className="h-3 w-3" /> {draft.featured ? "Featured on Home" : "Feature on Home"}
        </button>
        <div className="ml-auto flex gap-2">
          <button
            onClick={remove}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-destructive hover:bg-muted"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className={`rounded-md px-3 py-1.5 text-xs text-cream ${dirty ? "bg-ink hover:opacity-90" : "bg-muted-foreground/40 cursor-not-allowed"}`}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label-mono">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
