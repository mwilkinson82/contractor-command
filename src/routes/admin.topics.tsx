import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Container } from "@/components/portal/page-header";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { selectCallTopic, unselectCallTopic } from "@/lib/topics.functions";
import { Check, Loader2, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/admin/topics")({
  head: () => ({ meta: [{ title: "Topics admin — ALP Contractor Circle" }] }),
  component: AdminTopicsPage,
});

type Topic = {
  id: string;
  user_email: string;
  user_name: string | null;
  kind: string;
  title: string;
  needs_pressure: string | null;
  already_tried: string | null;
  decision_avoided: string | null;
  financial_consequence: string | null;
  win_looks_like: string | null;
  status: string;
  selected_at: string | null;
  created_at: string;
};

function AdminTopicsPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"pending" | "selected">("pending");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const select = useServerFn(selectCallTopic);
  const unselect = useServerFn(unselectCallTopic);

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("call_topics")
      .select("*")
      .order("created_at", { ascending: false });
    setTopics((data as Topic[]) || []);
    setLoading(false);
  }

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  async function handleSelect(id: string) {
    setBusyId(id);
    try {
      await select({ data: { topicId: id } });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleUnselect(id: string) {
    setBusyId(id);
    try {
      await unselect({ data: { topicId: id } });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (isAdmin === null) {
    return <Container className="py-10"><p className="text-sm text-muted-foreground">Checking access…</p></Container>;
  }
  if (!isAdmin) return null;

  const visible = topics.filter((t) =>
    tab === "pending" ? t.status === "pending" : t.status === "selected"
  );

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="label-mono">Admin · Topics</p>
          <h1 className="mt-2 font-display text-3xl">Submitted call topics</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Review what members submitted. Selecting a topic emails the submitter.
          </p>
        </div>
        <Link to="/calls" className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted">View Calls</Link>
      </div>

      <div className="mt-6 flex rounded-md border border-border bg-card p-0.5 w-fit">
        {(["pending", "selected"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded px-3 py-1.5 text-[12px] capitalize ${
              tab === k ? "bg-ink text-cream" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {k} ({topics.filter((t) => t.status === k).length})
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No {tab} topics.</p>
        ) : (
          visible.map((t) => (
            <article key={t.id} className="rounded-2xl border border-border bg-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="label-mono">{t.kind} · {new Date(t.created_at).toLocaleDateString()}</p>
                  <h3 className="mt-1 font-display text-xl leading-snug">{t.title}</h3>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {t.user_name || "—"} · {t.user_email}
                  </p>
                </div>
                {t.status === "pending" ? (
                  <button
                    onClick={() => handleSelect(t.id)}
                    disabled={busyId === t.id}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[12px] text-cream hover:opacity-90 disabled:opacity-60"
                  >
                    {busyId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Select & notify
                  </button>
                ) : (
                  <button
                    onClick={() => handleUnselect(t.id)}
                    disabled={busyId === t.id}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[12px] hover:bg-muted disabled:opacity-60"
                  >
                    {busyId === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    Move back to pending
                  </button>
                )}
              </div>
              <dl className="mt-4 grid gap-3 text-[13px] sm:grid-cols-2">
                {([
                  ["What needs pressure", t.needs_pressure],
                  ["Already tried", t.already_tried],
                  ["Decision avoided", t.decision_avoided],
                  ["Financial consequence", t.financial_consequence],
                  ["Win looks like", t.win_looks_like],
                ] as const).map(([label, val]) =>
                  val ? (
                    <div key={label}>
                      <dt className="label-mono">{label}</dt>
                      <dd className="mt-1 text-foreground/85 whitespace-pre-wrap">{val}</dd>
                    </div>
                  ) : null
                )}
              </dl>
            </article>
          ))
        )}
      </div>
    </Container>
  );
}
