import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Crosshair, ArrowLeft, Trash2 } from "lucide-react";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  listWeeklyMoves,
  upsertWeeklyMove,
  archiveWeeklyMove,
  type WeeklyMove,
} from "@/lib/weekly-move.functions";

export const Route = createFileRoute("/admin/weekly-move")({
  head: () => ({
    meta: [{ title: "Weekly move — Admin · ALP Contractor Circle" }],
  }),
  component: AdminWeeklyMove,
});

type FormState = {
  id?: string;
  headline: string;
  body: string;
  ctaLabel: string;
  ctaTarget: string; // single field; we infer route vs URL
  source: string;
  activeFrom: string; // datetime-local
  activeTo: string; // datetime-local (optional)
};

const EMPTY: FormState = {
  headline: "",
  body: "",
  ctaLabel: "Open in Vault",
  ctaTarget: "/vault",
  source: "Marshall",
  activeFrom: toLocalInput(new Date()),
  activeTo: "",
};

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(s: string): string {
  return new Date(s).toISOString();
}

function AdminWeeklyMove() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchList = useServerFn(listWeeklyMoves);
  const upsert = useServerFn(upsertWeeklyMove);
  const archive = useServerFn(archiveWeeklyMove);

  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const { data: moves, isLoading } = useQuery<WeeklyMove[]>({
    queryKey: ["weekly-moves-admin"],
    queryFn: () => fetchList(),
    enabled: !!isAdmin,
  });

  const upsertMutation = useMutation({
    mutationFn: (input: Parameters<typeof upsert>[0]) => upsert(input),
    onSuccess: () => {
      toast.success("Weekly move saved.");
      setForm(EMPTY);
      queryClient.invalidateQueries({ queryKey: ["weekly-moves-admin"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-move"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not save."),
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => archive({ data: { id } }),
    onSuccess: () => {
      toast.success("Move archived.");
      queryClient.invalidateQueries({ queryKey: ["weekly-moves-admin"] });
      queryClient.invalidateQueries({ queryKey: ["weekly-move"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Could not archive."),
  });

  if (isAdmin === null) {
    return (
      <Container className="py-10">
        <p className="text-sm text-muted-foreground">Checking access…</p>
      </Container>
    );
  }
  if (!isAdmin) return null;

  const now = Date.now();
  const active = (moves ?? []).find((m) => {
    const f = new Date(m.active_from).getTime();
    const t = m.active_to ? new Date(m.active_to).getTime() : Infinity;
    return f <= now && now < t;
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.headline.trim() || !form.body.trim() || !form.ctaLabel.trim()) {
      toast.error("Headline, body, and CTA label are required.");
      return;
    }
    const target = form.ctaTarget.trim();
    const isUrl = /^https?:\/\//i.test(target);
    upsertMutation.mutate({
      data: {
        id: form.id,
        headline: form.headline.trim(),
        body: form.body.trim(),
        ctaLabel: form.ctaLabel.trim(),
        ctaTo: !isUrl && target ? target : null,
        ctaHref: isUrl ? target : null,
        source: form.source.trim() || null,
        activeFrom: form.activeFrom
          ? fromLocalInput(form.activeFrom)
          : new Date().toISOString(),
        activeTo: form.activeTo ? fromLocalInput(form.activeTo) : null,
      },
    });
  }

  function loadIntoForm(m: WeeklyMove) {
    setForm({
      id: m.id,
      headline: m.headline,
      body: m.body,
      ctaLabel: m.cta_label,
      ctaTarget: m.cta_href ?? m.cta_to ?? "",
      source: m.source ?? "",
      activeFrom: toLocalInput(new Date(m.active_from)),
      activeTo: m.active_to ? toLocalInput(new Date(m.active_to)) : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="label-mono inline-flex items-center gap-1.5">
            <Crosshair className="h-3 w-3 text-gold" /> Admin · Today's move
          </p>
          <h1 className="mt-2 font-display text-3xl">
            Marshall's move this week
          </h1>
          <p className="mt-2 max-w-xl text-[13px] text-muted-foreground">
            What you write here replaces the auto-derived "Today's move" card
            on every member's dashboard. Leave end date empty to keep it active
            until you archive it.
          </p>
        </div>
        <Link
          to="/admin"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Admin
        </Link>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-border bg-card p-6"
        >
          <h2 className="font-display text-xl">
            {form.id ? "Edit move" : "New move"}
          </h2>

          <Field label="Headline">
            <Input
              value={form.headline}
              onChange={(e) => setForm({ ...form, headline: e.target.value })}
              placeholder="The one thing this week"
              maxLength={200}
            />
          </Field>

          <Field label="Body">
            <Textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="1–3 sentences explaining why this matters and what to do."
              rows={4}
              maxLength={2000}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CTA label">
              <Input
                value={form.ctaLabel}
                onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
                maxLength={60}
              />
            </Field>
            <Field label="CTA target (route or URL)">
              <Input
                value={form.ctaTarget}
                onChange={(e) => setForm({ ...form, ctaTarget: e.target.value })}
                placeholder="/tools/sop-priority or https://…"
                maxLength={500}
              />
            </Field>
          </div>

          <Field label="Source tag (small caption under the button)">
            <Input
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="Marshall"
              maxLength={120}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Active from">
              <Input
                type="datetime-local"
                value={form.activeFrom}
                onChange={(e) =>
                  setForm({ ...form, activeFrom: e.target.value })
                }
              />
            </Field>
            <Field label="Active until (optional)">
              <Input
                type="datetime-local"
                value={form.activeTo}
                onChange={(e) =>
                  setForm({ ...form, activeTo: e.target.value })
                }
              />
            </Field>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={upsertMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-50"
            >
              {upsertMutation.isPending
                ? "Saving…"
                : form.id
                  ? "Save changes"
                  : "Publish move"}
            </button>
            {form.id && (
              <button
                type="button"
                onClick={() => setForm(EMPTY)}
                className="text-[12px] text-muted-foreground hover:underline"
              >
                Cancel edit
              </button>
            )}
          </div>
        </form>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="label-mono">Currently live</p>
            {active ? (
              <>
                <h3 className="mt-2 font-display text-lg leading-snug">
                  {active.headline}
                </h3>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {active.body}
                </p>
                <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Since {new Date(active.active_from).toLocaleString()}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[12px] text-muted-foreground">
                No curated move active — the dashboard is auto-deriving.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="label-mono">History</p>
            {isLoading ? (
              <p className="mt-2 text-[12px] text-muted-foreground">Loading…</p>
            ) : (moves ?? []).length === 0 ? (
              <p className="mt-2 text-[12px] text-muted-foreground">
                No moves yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {(moves ?? []).map((m) => {
                  const isLive = m.id === active?.id;
                  return (
                    <li
                      key={m.id}
                      className="rounded-lg border border-border bg-background p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">
                            {m.headline}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            {new Date(m.active_from).toLocaleDateString()}
                            {m.active_to
                              ? ` → ${new Date(m.active_to).toLocaleDateString()}`
                              : isLive
                                ? " · live"
                                : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => loadIntoForm(m)}
                            className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted"
                          >
                            Edit
                          </button>
                          {isLive && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm("Archive this move?"))
                                  archiveMutation.mutate(m.id);
                              }}
                              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                              title="Archive"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </Container>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-4 block">
      <span className="label-mono">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
