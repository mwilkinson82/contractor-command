// Estimate Throughput Tracker — full-screen drawer experience.
// Inputs → "computing" theater → finding card with two terminus paths:
// Save to vault, or Bring to next call.

import { useMemo, useState } from "react";
import { Play, RotateCcw, Save, Check, AlertTriangle, TrendingUp, MessageSquare } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { calcEtt, DEFAULT_ETT, ettTickerLines, type EttInputs } from "@/lib/tools/estimate-throughput";
import { ComputeTheater, type ComputeStep } from "@/components/portal/compute-theater";
import { vault } from "@/lib/vault";

type Stage = "idle" | "running" | "ready";

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function EstimateThroughputTool({ onClose }: { onClose: () => void }) {
  const [inputs, setInputs] = useState<EttInputs>(DEFAULT_ETT);
  const [stage, setStage] = useState<Stage>("idle");
  const [savedId, setSavedId] = useState<string | null>(null);

  const result = useMemo(() => calcEtt(inputs), [inputs]);

  const steps: ComputeStep[] = useMemo(
    () => [
      { label: "Loading inputs and normalizing units…", ms: 360 },
      { label: "Deriving contracts and estimate volume from the revenue target…", ms: 440 },
      { label: "Comparing required throughput to current cadence…", ms: 420 },
      { label: "Projecting revenue at risk if the gap holds…", ms: 460 },
      { label: "Composing Command Packet for the vault…", ms: 380 },
    ],
    [],
  );

  const ticker = useMemo(() => ettTickerLines(inputs, result), [inputs, result]);

  function update<K extends keyof EttInputs>(key: K, raw: string) {
    const clean = raw.replace(/[,$%]/g, "");
    const n = Number(clean);
    setInputs((p) => ({ ...p, [key]: Number.isFinite(n) ? n : 0 }));
    if (stage === "ready") setStage("idle");
    setSavedId(null);
  }

  function run() {
    setSavedId(null);
    setStage("running");
  }

  function reset() {
    setInputs(DEFAULT_ETT);
    setStage("idle");
    setSavedId(null);
  }

  function savePacket() {
    const saved = vault.save({
      kind: "command",
      source: "Estimate Throughput Tracker",
      title: result.headline,
      primaryFinding: result.finding,
      primaryConstraint: result.headline,
      financialConsequence:
        result.revenueAtRisk > 0
          ? `Revenue at risk ${fmtMoney(result.revenueAtRisk)} against a ${fmtMoney(inputs.revenueTarget)} target.`
          : `On pace against ${fmtMoney(inputs.revenueTarget)} revenue target.`,
      missingSystem: "Weekly estimating cadence tied to revenue target.",
      recommendedAction: result.recommendedAction,
      bringOneIssuePrompt:
        result.status === "on-pace"
          ? "What would protect this cadence the next time a PM gets pulled into the field?"
          : "Where do you actually lose the estimating hours each week?",
      intensiveRecommended: result.status === "short",
      inputs: { ...inputs },
    });
    setSavedId(saved.id);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-6 px-6 py-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Command Tool · Make more money
          </p>
          <h1
            className="mt-1 font-display text-[1.8rem] leading-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Estimate Throughput Tracker
          </h1>
          <p className="mt-1 max-w-xl text-[13px] text-muted-foreground">
            Pressure-tests whether the estimates leaving your shop each week can
            actually carry the revenue target you set.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground/70 hover:bg-muted"
        >
          Close
        </button>
      </header>

      {/* Split: inputs left, computation + result right */}
      <div className="grid gap-6 lg:grid-cols-[minmax(340px,420px)_1fr] lg:items-start">
        {/* Inputs */}
        <section className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-6">
          <p className="label-mono">Inputs</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <Field
              label="Annual revenue target"
              prefix="$"
              value={inputs.revenueTarget}
              onChange={(v) => update("revenueTarget", v)}
            />
            <Field
              label="Average contract size"
              prefix="$"
              value={inputs.avgContractSize}
              onChange={(v) => update("avgContractSize", v)}
            />
            <Field
              label="Win rate"
              suffix="%"
              value={inputs.winRate * 100}
              onChange={(v) => {
                const n = Number(v.replace(/[,$%]/g, ""));
                setInputs((p) => ({ ...p, winRate: Number.isFinite(n) ? n / 100 : 0 }));
                if (stage === "ready") setStage("idle");
                setSavedId(null);
              }}
            />
            <Field
              label="Estimates sent / week (current)"
              value={inputs.currentEstimatesPerWeek}
              onChange={(v) => update("currentEstimatesPerWeek", v)}
            />
            <Field
              label="Working weeks per year"
              value={inputs.workingWeeks}
              onChange={(v) => update("workingWeeks", v)}
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={stage === "running"}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" />
              {stage === "ready" ? "Recompute" : "Run analysis"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12px] text-foreground/70 hover:bg-muted"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          </div>
        </section>

        {/* Right column: theater + result */}
        <div className="flex flex-col gap-6 min-w-0">
          {stage === "idle" && (
            <div className="rounded-2xl border border-dashed border-border bg-background/40 p-10 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                Awaiting inputs
              </p>
              <p className="mt-2 text-[13px] text-muted-foreground" style={{ fontFamily: "var(--font-serif)" }}>
                Set your numbers, then hit Run analysis to see what your estimate cadence can actually carry.
              </p>
            </div>
          )}

          {(stage === "running" || stage === "ready") && (
            <ComputeTheater
              steps={steps}
              ticker={ticker}
              running={stage === "running"}
              onDone={() => setStage("ready")}
              subtitle="Estimate Throughput Tracker"
            />
          )}

          {stage === "ready" && (
            <section className="rounded-2xl border border-border bg-card p-6 reveal-up">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    Finding
                  </p>
                  <h2
                    className="mt-1 font-display text-[1.5rem] leading-tight"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {result.headline}
                  </h2>
                </div>
                <StatusPill status={result.status} />
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <Metric label="Required" value={`${result.requiredEstimatesPerWeek.toFixed(1)}/wk`} />
                <Metric label="Current" value={`${result.currentEstimatesPerWeek}/wk`} />
                <Metric
                  label={result.deficitPerWeek < 0 ? "Revenue at risk" : "Cushion"}
                  value={
                    result.deficitPerWeek < 0
                      ? fmtMoney(result.revenueAtRisk)
                      : `${Math.round((result.coveragePct - 1) * 100)}%`
                  }
                  tone={result.deficitPerWeek < 0 ? "warn" : "ok"}
                />
              </div>

              <div className="mt-5 space-y-3 text-[14px] leading-relaxed text-foreground/85">
                <p style={{ fontFamily: "var(--font-serif)" }}>{result.finding}</p>
                <div className="rounded-md border border-border bg-background/60 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Recommended next move
                  </p>
                  <p
                    className="mt-1.5 text-[14px] text-foreground"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {result.recommendedAction}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={savePacket}
                  disabled={!!savedId}
                  className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-70"
                >
                  {savedId ? <Check className="h-3.5 w-3.5 text-signal-success" /> : <Save className="h-3.5 w-3.5" />}
                  {savedId ? "Saved to vault" : "Save to vault"}
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  prefix,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </span>
      <div className="mt-1.5 flex items-center rounded-md border border-border bg-background focus-within:border-foreground/40">
        {prefix && <span className="pl-3 text-[13px] text-muted-foreground">{prefix}</span>}
        <input
          inputMode="decimal"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent px-3 py-2 text-[14px] text-foreground outline-none"
        />
        {suffix && <span className="pr-3 text-[13px] text-muted-foreground">{suffix}</span>}
      </div>
    </label>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "neutral";
}) {
  const color =
    tone === "warn" ? "text-signal" : tone === "ok" ? "text-signal-success" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className={`mt-2 font-display text-[1.6rem] leading-none ${color}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: "on-pace" | "tight" | "short" }) {
  if (status === "on-pace") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-success/40 bg-signal-success/10 px-3 py-1 text-[11px] font-medium text-signal-success">
        <TrendingUp className="h-3 w-3" /> On pace
      </span>
    );
  }
  if (status === "tight") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[11px] font-medium text-gold">
        <AlertTriangle className="h-3 w-3" /> Tight
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-[11px] font-medium text-signal">
      <AlertTriangle className="h-3 w-3" /> Short
    </span>
  );
}
