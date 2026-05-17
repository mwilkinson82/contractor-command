import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { vault, AOS_URL } from "@/lib/vault";
import { PacketCard } from "@/components/portal/packet-card";
import { Check } from "lucide-react";

export const Route = createFileRoute("/tools/owner-dependency")({
  head: () => ({ meta: [{ title: "Owner Dependency Scorecard — ALP Contractor Circle" }] }),
  component: OwnerDependencyTool,
});

const AREAS = [
  { key: "sales", label: "Sales" },
  { key: "estimating", label: "Estimating" },
  { key: "client_decisions", label: "Client decisions" },
  { key: "project_launch", label: "Project launch" },
  { key: "pm_oversight", label: "PM oversight" },
  { key: "change_orders", label: "Change orders" },
  { key: "billing", label: "Billing" },
  { key: "collections", label: "Collections" },
  { key: "hiring", label: "Hiring" },
  { key: "financial_controls", label: "Financial controls" },
  { key: "project_leadership", label: "Project leadership" },
  { key: "sops", label: "SOPs / process" },
] as const;

type Scores = Record<(typeof AREAS)[number]["key"], number>;
const DEFAULT: Scores = AREAS.reduce((acc, a) => ({ ...acc, [a.key]: 3 }), {} as Scores);

// 0 = owner does it all, 5 = system runs without owner
function OwnerDependencyTool() {
  const [scores, setScores] = useState<Scores>(DEFAULT);
  const [savedId, setSavedId] = useState<string | null>(null);

  const result = useMemo(() => {
    const total = AREAS.reduce((s, a) => s + scores[a.key], 0);
    const max = AREAS.length * 5;
    const pct = Math.round((total / max) * 100);
    const sorted = [...AREAS].sort((a, b) => scores[a.key] - scores[b.key]);
    const bottlenecks = sorted.slice(0, 3);
    const firstSystem = bottlenecks[0];
    const highRisk = pct < 50;
    return { total, max, pct, bottlenecks, firstSystem, highRisk };
  }, [scores]);

  function save() {
    const finding = `Owner dependency score: ${result.pct}%. The business still leans on the owner most in: ${result.bottlenecks.map((b) => b.label).join(", ")}.`;
    const p = vault.save({
      kind: "command",
      source: "Owner Dependency Scorecard",
      title: `Owner dependency at ${result.pct}%`,
      primaryFinding: finding,
      primaryConstraint: `Highest-risk owner bottleneck: ${result.firstSystem.label}`,
      financialConsequence: result.highRisk
        ? "Owner is the single point of failure. Growth, sale value, and time-off are all blocked."
        : "Bottlenecks are slowing the business but not breaking it. Cost is mostly speed and owner time.",
      missingSystem: `Install the first system around ${result.firstSystem.label}.`,
      recommendedAction: `Define the seat, the scorecard, and the weekly cadence for ${result.firstSystem.label}. Pull the owner out within 90 days.`,
      relatedAos: "Accountability Chart + Process + Scorecard",
      bringOneIssuePrompt: `What would have to be true for ${result.firstSystem.label} to run without you next month?`,
      intensiveRecommended: result.highRisk,
      inputs: scores as unknown as Record<string, number>,
    });
    setSavedId(p.id);
  }

  return (
    <div className="grid gap-10 lg:grid-cols-12">
      <section className="lg:col-span-6">
        <p className="label-mono">Twelve areas</p>
        <h2 className="mt-2 font-display text-3xl">Owner Dependency Scorecard</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          For each area, rate how much the business still depends on the owner.
          <span className="mt-1 block text-xs">0 = owner runs it · 5 = system runs it without the owner</span>
        </p>
        <div className="mt-6 divide-y divide-border rounded-2xl border border-border bg-card">
          {AREAS.map((a) => (
            <div key={a.key} className="flex items-center justify-between gap-6 px-5 py-3">
              <span className="text-sm">{a.label}</span>
              <div className="flex items-center gap-1">
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => { setScores((p) => ({ ...p, [a.key]: n })); setSavedId(null); }}
                    className={`h-7 w-7 rounded-md text-xs tabular-nums transition-colors ${
                      scores[a.key] === n
                        ? "bg-ink text-cream"
                        : "border border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="lg:col-span-6 lg:sticky lg:top-24 lg:self-start">
        <div className="overflow-hidden rounded-3xl bg-ink text-cream shadow-[var(--shadow-focus)]">
          <div className="px-8 py-7">
            <p className="label-mono !text-cream/55">Owner dependency</p>
            <div className="mt-3 flex items-baseline gap-3">
              <span className="font-display text-6xl text-cream tabular-nums">{result.pct}%</span>
              <span className="text-sm text-cream/55">system-run</span>
            </div>
            <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-cream/10">
              <div className="h-full bg-gold transition-all" style={{ width: `${result.pct}%` }} />
            </div>
          </div>
          <div className="space-y-3 border-t border-cream/10 px-8 py-6">
            <p className="label-mono !text-cream/55">Top owner bottlenecks</p>
            {result.bottlenecks.map((b) => (
              <div key={b.key} className="flex items-center justify-between text-sm">
                <span className="text-cream">{b.label}</span>
                <span className="font-mono text-cream/60 tabular-nums">{scores[b.key]} / 5</span>
              </div>
            ))}
          </div>
          <div className="border-t border-cream/10 px-8 py-6 text-sm text-cream/80">
            <p>
              First system to install: <strong className="text-cream">{result.firstSystem.label}</strong>.
              Define the seat, the weekly metric, and pull yourself out within 90 days.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-cream/10 bg-ink/60 px-8 py-5">
            <button onClick={save} className="inline-flex items-center gap-1.5 rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:opacity-90">
              {savedId ? <><Check className="h-4 w-4" /> Saved</> : "Save Command Packet"}
            </button>
            <a href={AOS_URL} target="_blank" rel="noreferrer" className="rounded-md border border-cream/15 px-3 py-2 text-sm text-cream hover:bg-cream/5">
              Open AOS
            </a>
            {result.highRisk ? (
              <Link to="/work-with-marshall" className="ml-auto rounded-md border border-gold bg-gold/15 px-3 py-2 text-sm text-gold hover:bg-gold/25">
                Consider the Intensive
              </Link>
            ) : null}
          </div>
        </div>
        {savedId ? (
          <div className="mt-6">
            <PacketCard packet={vault.get(savedId)!} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
