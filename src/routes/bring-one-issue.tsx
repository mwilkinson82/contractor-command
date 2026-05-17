import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { vault, AOS_URL } from "@/lib/vault";
import { PageHeader, Container } from "@/components/portal/page-header";
import { Check } from "lucide-react";

export const Route = createFileRoute("/bring-one-issue")({
  head: () => ({ meta: [{ title: "Bring One Issue — ALP Contractor Circle" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ seed: typeof s.seed === "string" ? s.seed : undefined }),
  component: BringOneIssuePage,
});

const QUESTIONS = [
  { key: "needsPressure", label: "What needs pressure?", placeholder: "Name the specific friction. One sentence." },
  { key: "alreadyTried", label: "What have you already tried?", placeholder: "What you've attempted and what happened." },
  { key: "decisionAvoided", label: "What decision are you avoiding?", placeholder: "The call you keep putting off." },
  { key: "financialConsequence", label: "What is the financial consequence?", placeholder: "Dollars, time, or risk if this stays stuck." },
  { key: "winLooksLike", label: "What would make this a win?", placeholder: "Specific. Measurable. Honest." },
] as const;

type Form = Record<(typeof QUESTIONS)[number]["key"], string> & { title: string };

function BringOneIssuePage() {
  const { seed } = Route.useSearch();
  const [form, setForm] = useState<Form>({
    title: "",
    needsPressure: seed ?? "",
    alreadyTried: "",
    decisionAvoided: "",
    financialConsequence: "",
    winLooksLike: "",
  });
  const [savedId, setSavedId] = useState<string | null>(null);

  function save() {
    const p = vault.save({
      kind: "issue",
      source: "Bring One Issue",
      title: form.title || form.needsPressure.slice(0, 80) || "Issue packet",
      needsPressure: form.needsPressure,
      alreadyTried: form.alreadyTried,
      decisionAvoided: form.decisionAvoided,
      financialConsequence: form.financialConsequence,
      winLooksLike: form.winLooksLike,
    });
    setSavedId(p.id);
  }

  return (
    <Container>
      <PageHeader
        eyebrow="Session prep"
        title={<>Bring one issue.<br/>Make it specific.</>}
        lede="Use this before a Contractor Circle session to make one business issue specific enough to learn from. Not every issue will be addressed live, but the process will help you turn friction into operating-system work."
      />

      <div className="mt-10 grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="space-y-6 rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)] sm:p-8">
            <label className="block">
              <span className="label-mono">Title</span>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="One short name for this issue"
                className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:border-ink focus:outline-none"
              />
            </label>
            {QUESTIONS.map((q, i) => (
              <label key={q.key} className="block">
                <span className="label-mono">{i + 1}. {q.label}</span>
                <textarea
                  rows={3}
                  value={form[q.key]}
                  onChange={(e) => setForm({ ...form, [q.key]: e.target.value })}
                  placeholder={q.placeholder}
                  className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm leading-relaxed focus:border-ink focus:outline-none"
                />
              </label>
            ))}
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
              <button
                onClick={save}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm text-cream hover:opacity-90"
              >
                {savedId ? <><Check className="h-4 w-4" /> Saved to Vault</> : "Save issue packet"}
              </button>
              <a href={AOS_URL} target="_blank" rel="noreferrer" className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm hover:bg-muted">
                Open AOS
              </a>
              <Link to="/vault" className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm hover:bg-muted">
                View saved packets
              </Link>
            </div>
          </div>
        </div>

        <aside className="lg:col-span-5">
          <div className="rounded-3xl bg-ink p-8 text-cream shadow-[var(--shadow-focus)]">
            <p className="label-mono !text-cream/55">The frame</p>
            <h3 className="mt-3 font-display text-2xl leading-snug">
              Bring one issue. Carry the output into AOS.
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-cream/75">
              The issue should become one of: a decision, a to-do, an SOP gap, a scorecard metric, or an AOS issue.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-cream/70">
              <li>· This is not unlimited consulting.</li>
              <li>· Marshall will not address every submission live.</li>
              <li>· The prep is the value — the process forces clarity.</li>
            </ul>
            <Link
              to="/work-with-marshall"
              className="mt-7 inline-flex items-center gap-1.5 rounded-md border border-cream/15 px-3 py-2 text-xs text-cream/85 hover:bg-cream/5"
            >
              Need private guidance? See the Intensive
            </Link>
          </div>
        </aside>
      </div>
    </Container>
  );
}
