import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, Container } from "@/components/portal/page-header";
import {
  addToCalendarUrl,
  formatSessionDate,
  nextOfKind,
  relativeDay,
  type Session,
} from "@/lib/program";
import { submitCallTopic } from "@/lib/topics.functions";
import { ArrowUpRight, Calendar, Check, Loader2, Video } from "lucide-react";

export const Route = createFileRoute("/calls")({
  head: () => ({
    meta: [
      { title: "Calls & Replays — ALP Contractor Circle" },
      { name: "description", content: "Next biweekly call, next monthly bootcamp, topic submission, and the full replay library." },
    ],
  }),
  component: CallsPage,
});

function CallsPage() {
  const biweekly = nextOfKind("Biweekly Call");

  return (
    <Container>
      <PageHeader
        eyebrow="The room"
        title={<>Calls and bootcamps.</>}
        lede="One Zoom for the bi-weekly working sessions and the monthly bootcamps — every other Sunday. Submit the topic you want pressured before the room sees it."
      />

      {/* Single unified session card */}
      <section className="mt-10">
        {biweekly ? <SessionCard session={biweekly} primary /> : null}
      </section>

      {/* Topic submission */}
      <section id="submit-topic" className="mt-16 scroll-mt-24">
        <TopicSubmit defaultKind="Biweekly Call" />
      </section>

      {/* Replays moved to /replays */}
      <section className="mt-16 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/40 p-6">
        <div>
          <p className="label-mono">Replay archive</p>
          <p className="mt-1 text-[13px] text-foreground/75">
            Every past biweekly call and monthly bootcamp lives in the Library.
          </p>
        </div>
        <Link
          to="/replays"
          className="inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-[13px] text-cream hover:opacity-90"
        >
          <Video className="h-3.5 w-3.5" /> Open replays
        </Link>
      </section>
    </Container>
  );
}

function SessionCard({ session, primary = false }: { session: Session; primary?: boolean }) {
  return (
    <article
      className={
        primary
          ? "rounded-3xl bg-ink p-8 text-cream shadow-[var(--shadow-focus)]"
          : "rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-soft)]"
      }
    >
      <div className="flex items-center justify-between">
        <p className={`label-mono ${primary ? "!text-cream/60" : ""}`}>
          {session.kind} · {relativeDay(session.date)}
        </p>
        {primary ? (
          <span className="rounded-full bg-cream/10 px-2.5 py-1 text-[10px] tracking-wider text-cream/80">
            NEXT UP
          </span>
        ) : null}
      </div>
      <h3 className={`mt-4 font-display text-2xl leading-snug ${primary ? "text-cream" : ""}`}>
        {session.title}
      </h3>
      <div className={`mt-5 flex items-center gap-2 text-sm ${primary ? "text-cream/75" : "text-muted-foreground"}`}>
        <Calendar className="h-4 w-4" />
        <span>{formatSessionDate(session.date)}</span>
        <span className={primary ? "text-cream/30" : "text-muted-foreground/40"}>·</span>
        <span>{session.durationMin} min</span>
      </div>
      <p className={`mt-5 text-sm leading-relaxed ${primary ? "text-cream/75" : "text-muted-foreground"}`}>
        {session.description}
      </p>
      <div className="mt-7 flex flex-wrap gap-2">
        <a
          href={session.zoomUrl}
          target="_blank"
          rel="noreferrer"
          className={
            primary
              ? "inline-flex items-center gap-2 rounded-lg bg-cream px-4 py-2.5 text-sm font-medium text-ink hover:opacity-90"
              : "inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-cream hover:opacity-90"
          }
        >
          Join Zoom <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
        <a
          href={addToCalendarUrl(session)}
          target="_blank"
          rel="noreferrer"
          className={
            primary
              ? "inline-flex items-center gap-2 rounded-lg border border-cream/15 px-4 py-2.5 text-sm text-cream hover:bg-cream/5"
              : "inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm hover:bg-muted"
          }
        >
          Add to calendar
        </a>
        <a
          href="#submit-topic"
          className={
            primary
              ? "inline-flex items-center gap-2 rounded-lg border border-cream/15 px-4 py-2.5 text-sm text-cream hover:bg-cream/5"
              : "inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm hover:bg-muted"
          }
        >
          Submit a topic
        </a>
      </div>
      {session.zoomId ? (
        <p className={`mt-6 border-t pt-4 font-mono text-xs ${primary ? "border-cream/10 text-cream/50" : "border-border text-muted-foreground"}`}>
          Zoom ID · {session.zoomId}
          {session.passcode ? <>  ·  Passcode · {session.passcode}</> : null}
        </p>
      ) : null}
    </article>
  );
}

const QUESTIONS = [
  { key: "needsPressure", label: "What needs pressure?", placeholder: "Name the specific friction. One sentence." },
  { key: "alreadyTried", label: "What have you already tried?", placeholder: "What you've attempted and what happened." },
  { key: "decisionAvoided", label: "What decision are you avoiding?", placeholder: "The call you keep putting off." },
  { key: "financialConsequence", label: "What is the financial consequence?", placeholder: "Dollars, time, or risk if this stays stuck." },
  { key: "winLooksLike", label: "What would make this a win?", placeholder: "Specific. Measurable. Honest." },
] as const;

type Form = Record<(typeof QUESTIONS)[number]["key"], string> & { title: string };

function TopicSubmit({ defaultKind }: { defaultKind: Session["kind"] }) {
  const [kind, setKind] = useState<Session["kind"]>(defaultKind);
  const [form, setForm] = useState<Form>({
    title: "",
    needsPressure: "",
    alreadyTried: "",
    decisionAvoided: "",
    financialConsequence: "",
    winLooksLike: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = useServerFn(submitCallTopic);

  async function save() {
    setError(null);
    const title = form.title.trim() || form.needsPressure.slice(0, 80).trim() || `${kind} topic`;
    setSubmitting(true);
    try {
      const res = await submit({
        data: {
          kind,
          title,
          needsPressure: form.needsPressure,
          alreadyTried: form.alreadyTried,
          decisionAvoided: form.decisionAvoided,
          financialConsequence: form.financialConsequence,
          winLooksLike: form.winLooksLike,
        },
      });
      if (res.ok) {
        setSavedId(res.id);
        setForm({
          title: "",
          needsPressure: "",
          alreadyTried: "",
          decisionAvoided: "",
          financialConsequence: "",
          winLooksLike: "",
        });
      } else {
        setError(res.error || "Could not submit. Try again.");
      }
    } catch (err) {
      console.error(err);
      setError("Could not submit. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-12">
      <div className="lg:col-span-5">
        <p className="label-mono">Submit a topic</p>
        <h2 className="mt-3 font-display text-3xl leading-tight">
          Pressure-test one issue before the room sees it.
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Five questions. The prep is the value — the answers force the issue to become specific enough to learn from. Marshall reviews submissions before each session and pulls the ones that earn live time.
        </p>
        <div className="mt-6 inline-flex rounded-lg border border-border bg-card p-1">
          {(["Biweekly Call", "Monthly Bootcamp"] as const).map((k) => (
            <button
              key={k}
              onClick={() => { setKind(k); setSavedId(null); }}
              className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                kind === k ? "bg-ink text-cream" : "text-foreground/70 hover:bg-muted"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="lg:col-span-7">
        <div className="space-y-5 rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8">
          <label className="block">
            <span className="label-mono">Title</span>
            <input
              value={form.title}
              onChange={(e) => { setForm({ ...form, title: e.target.value }); setSavedId(null); }}
              placeholder="One short name for this topic"
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-ink focus:outline-none"
            />
          </label>
          {QUESTIONS.map((q, i) => (
            <label key={q.key} className="block">
              <span className="label-mono">{i + 1}. {q.label}</span>
              <textarea
                rows={2}
                value={form[q.key]}
                onChange={(e) => { setForm({ ...form, [q.key]: e.target.value }); setSavedId(null); }}
                placeholder={q.placeholder}
                className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed focus:border-ink focus:outline-none"
              />
            </label>
          ))}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
            <button
              onClick={save}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm text-cream hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
              ) : savedId ? (
                <><Check className="h-4 w-4" /> Submitted</>
              ) : (
                "Submit topic"
              )}
            </button>
            {savedId ? (
              <span className="text-xs text-muted-foreground">Sent to Marshall — you'll get an email if it's picked for the next {kind}.</span>
            ) : null}
            {error ? (
              <span className="text-xs text-destructive">{error}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

