import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { calcGcm, DEFAULT_GCM, type GcmInputs } from "@/lib/growth-constraint";
import { vault } from "@/lib/vault";
import { ComputeStream, type ComputeStep } from "@/components/portal/compute-stream";
import { ArrowLeft, Check, Play, RotateCcw, Printer, Save } from "lucide-react";

export const Route = createFileRoute("/tools/growth-constraint")({
  head: () => ({
    meta: [{ title: "Growth Constraint Map — ALP Contractor Circle" }],
  }),
  component: () => <GrowthConstraintTool />,
});

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;

type Stage = "idle" | "running" | "ready";

export function GrowthConstraintTool({ embedded = false }: { embedded?: boolean } = {}) {
  const [inputs, setInputs] = useState<GcmInputs>(DEFAULT_GCM);
  const [stage, setStage] = useState<Stage>("idle");
  const [savedId, setSavedId] = useState<string | null>(null);
  const result = useMemo(() => calcGcm(inputs), [inputs]);

  const steps: ComputeStep[] = useMemo(
    () => [
      { label: "Normalizing revenue and capacity inputs…", ms: 380 },
      { label: "Computing per-project velocity and PM throughput…", ms: 420 },
      { label: "Pressure-testing pipeline against required estimates…", ms: 460 },
      { label: "Ranking candidate constraints by financial leverage…", ms: 500 },
      { label: "Composing Command Packet for your vault…", ms: 420 },
    ],
    [],
  );

  function update<K extends keyof GcmInputs>(key: K, raw: string) {
    const n = Number(raw.replace(/[,$]/g, ""));
    setInputs((p) => ({ ...p, [key]: Number.isFinite(n) ? n : 0 }));
    if (stage === "ready") setStage("idle");
    setSavedId(null);
  }

  function run() {
    setSavedId(null);
    setStage("running");
  }

  function reset() {
    setStage("idle");
    setSavedId(null);
  }

  function savePacket() {
    const p = vault.save({
      kind: "command",
      source: "Growth Constraint Map",
      title: result.headline,
      primaryFinding: result.finding,
      primaryConstraint: result.headline,
      financialConsequence: `Revenue gap ${fmtMoney(result.revenueGap)} · Gross profit attached ${fmtMoney(result.grossProfitAttachedToGap)}`,
      missingSystem: result.missingSystem,
      recommendedAction: result.recommendedAction,
      
      bringOneIssuePrompt: result.bringOneIssuePrompt,
      intensiveRecommended: result.intensiveRecommended,
      inputs: inputs as unknown as Record<string, number>,
    });
    setSavedId(p.id);
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] px-6 py-8 sm:py-10">
      {/* Tool header */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/70 pb-5">
        <div>
          {!embedded && (
            <Link
              to="/tools"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-foreground/70 hover:bg-muted"
            >
              <ArrowLeft className="h-3 w-3" /> All tools
            </Link>
          )}
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Command tool · 01
          </p>
          <h1 className="mt-2 font-display text-2xl tracking-tight sm:text-3xl">Growth Constraint Map</h1>
        </div>
        {!embedded && (
          <Link to="/vault" className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted">
            Open vault
          </Link>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Inputs pane */}
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Business variables</p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Twelve numbers about how the business actually runs. The map will surface what's blocking the next tier.
          </p>

          <div className="mt-6 space-y-5">
            <Group label="Revenue target">
              <Field label="Desired annual revenue" value={inputs.desiredRevenue} onChange={(v) => update("desiredRevenue", v)} money />
              <Field label="Current annual revenue" value={inputs.currentRevenue} onChange={(v) => update("currentRevenue", v)} money />
              <Field label="Average gross margin %" value={inputs.avgGrossMarginPct} onChange={(v) => update("avgGrossMarginPct", v)} suffix="%" />
            </Group>
            <Group label="Project economics">
              <Field label="Average project size" value={inputs.avgProjectSize} onChange={(v) => update("avgProjectSize", v)} money />
              <Field label="Avg duration (months)" value={inputs.avgProjectDurationMonths} onChange={(v) => update("avgProjectDurationMonths", v)} />
            </Group>
            <Group label="Delivery capacity">
              <Field label="Current active projects" value={inputs.currentActiveProjects} onChange={(v) => update("currentActiveProjects", v)} />
              <Field label="Realistic capacity" value={inputs.realisticActiveProjectCapacity} onChange={(v) => update("realisticActiveProjectCapacity", v)} />
              <Field label="PMs / project leaders" value={inputs.pms} onChange={(v) => update("pms", v)} />
              <Field label="Projects per PM" value={inputs.avgProjectsPerPm} onChange={(v) => update("avgProjectsPerPm", v)} />
            </Group>
            <Group label="Pipeline">
              <Field label="Qualified leads / month" value={inputs.qualifiedLeadsPerMonth} onChange={(v) => update("qualifiedLeadsPerMonth", v)} />
              <Field label="Estimates sent / month" value={inputs.estimatesSentPerMonth} onChange={(v) => update("estimatesSentPerMonth", v)} />
              <Field label="Close rate %" value={inputs.closeRatePct} onChange={(v) => update("closeRatePct", v)} suffix="%" />
            </Group>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-border pt-5">
            <button
              onClick={run}
              disabled={stage === "running"}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              {stage === "idle" ? "Run map" : stage === "running" ? "Computing…" : "Re-run"}
            </button>
            <button
              onClick={reset}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-[13px] hover:bg-muted"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          </div>
        </section>

        {/* Compute / Result pane */}
        <section className="relative overflow-hidden rounded-2xl bg-ink text-cream shadow-[var(--shadow-focus)] lg:sticky lg:top-6 lg:self-start">
          {/* Status strip — compact when ready, full theater while running/idle */}
          {stage !== "ready" && (
            <div className="border-b border-cream/10 px-6 py-5">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cream/55">
                  <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${stage === "running" ? "bg-signal animate-signal-pulse" : "bg-cream/30"}`} />
                  {stage === "running" ? "Computing constraint map" : "Idle"}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/35">GCM/v1</p>
              </div>
              <div className="mt-4 min-h-[140px]">
                {stage === "idle" ? (
                  <p className="text-[12px] font-mono text-cream/45">
                    ▸ Awaiting inputs. Press <span className="text-cream">Run map</span> to compute the binding constraint.
                  </p>
                ) : (
                  <ComputeStream
                    key={Date.now()}
                    steps={steps}
                    running={stage === "running"}
                    onDone={() => setStage("ready")}
                  />
                )}
              </div>
            </div>
          )}

          {/* Packet — only after ready */}
          {stage === "ready" && (
            <>
              <div className="flex items-center justify-between border-b border-cream/10 px-6 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cream/55">
                  <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full align-middle bg-signal-success" />
                  Run complete
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/35">GCM/v1</p>
              </div>
              <div className="px-6 py-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55 reveal-up">The constraint</p>
                <h3 className="mt-3 font-display text-2xl leading-snug text-cream reveal-up sm:text-3xl" style={{ animationDelay: "80ms" }}>
                  {result.headline}
                </h3>
                <p className="mt-4 text-[14px] leading-relaxed text-cream/80 reveal-up" style={{ animationDelay: "180ms" }}>
                  {result.finding}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-px bg-cream/5 sm:grid-cols-4">
                <Stat label="Revenue gap" value={fmtMoney(result.revenueGap)} />
                <Stat label="GP attached" value={fmtMoney(result.grossProfitAttachedToGap)} />
                <Stat label="Required projects" value={result.requiredActiveProjects.toFixed(1)} />
                <Stat label="Estimates / yr" value={Math.ceil(result.estimatesRequired).toLocaleString()} />
              </div>

              <div className="space-y-2.5 px-6 py-5 text-[13px]">
                <LineItem k="Monthly billing velocity / project" v={fmtMoney(result.monthlyBillingVelocityPerProject)} />
                <LineItem k="Current annual capacity" v={fmtMoney(result.currentAnnualCapacity)} />
                <LineItem k="Realistic annual capacity" v={fmtMoney(result.realisticAnnualCapacity)} />
                <LineItem k="Estimate capacity (yr)" v={result.estimateCapacity.toLocaleString()} />
                <LineItem k="PM capacity" v={result.pmCapacity.toLocaleString()} />
                <LineItem k="Signed contracts required" v={Math.ceil(result.signedContractsRequired).toLocaleString()} />
              </div>

              <div className="grid gap-3 border-t border-cream/10 bg-ink-panel/60 px-6 py-5 sm:grid-cols-2">
                <PacketRow label="Missing system" value={result.missingSystem} />
                <PacketRow label="Recommended action" value={result.recommendedAction} />
                <PacketRow label="Bring one issue" value={result.bringOneIssuePrompt} />
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-cream/10 px-6 py-4">
                <button
                  onClick={savePacket}
                  className="inline-flex items-center gap-1.5 rounded-md bg-signal px-4 py-2 text-[13px] font-medium text-ink hover:opacity-90"
                >
                  {savedId ? <><Check className="h-3.5 w-3.5" /> Saved</> : <><Save className="h-3.5 w-3.5" /> Save to Vault</>}
                </button>
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-cream/15 px-3 py-2 text-[13px] text-cream hover:bg-cream/5"
                >
                  <Printer className="h-3.5 w-3.5" /> Print
                </button>
                <Link
                  to="/calls"
                  hash="submit-topic"
                  className="rounded-md border border-cream/15 px-3 py-2 text-[13px] text-cream hover:bg-cream/5"
                >
                  Discuss in next call
                </Link>
                {result.intensiveRecommended ? (
                  <Link
                    to="/work-with-marshall"
                    className="ml-auto rounded-md border border-signal/40 bg-signal/15 px-3 py-2 text-[13px] text-signal hover:bg-signal/25"
                  >
                    Consider the Intensive
                  </Link>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  money,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
  money?: boolean;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="relative mt-1">
        {money ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">$</span> : null}
        <input
          type="text"
          inputMode="numeric"
          value={value.toLocaleString()}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] tabular-nums focus:border-ink focus:outline-none ${money ? "pl-7" : ""} ${suffix ? "pr-8" : ""}`}
        />
        {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">{suffix}</span> : null}
      </div>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink px-5 py-4 reveal-up">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50">{label}</p>
      <p className="mt-1 font-display text-lg text-cream tabular-nums">{value}</p>
    </div>
  );
}

function LineItem({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-cream/5 pb-2 last:border-0">
      <span className="text-cream/65">{k}</span>
      <span className="font-mono text-cream tabular-nums">{v}</span>
    </div>
  );
}

function PacketRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="reveal-up">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/45">{label}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-cream/85">{value}</p>
    </div>
  );
}
