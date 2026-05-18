// Margin Leak Finder — full-screen drawer tool.
// Mirrors Estimate Throughput: inputs left, compute theater + finding right,
// terminus = vault / calls.

import { useMemo, useState } from "react";
import { Play, RotateCcw, Save, Check, AlertTriangle, ScissorsLineDashed, MessageSquare, TrendingUp } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  calcMarginLeak,
  DEFAULT_MARGIN_LEAK,
  LEAK_SOURCES,
  MARGIN_LEAK_STEPS,
  marginLeakTicker,
  type MarginLeakInputs,
  type LeakSource,
} from "@/lib/tools/margin-leak";
import { ComputeTheater } from "@/components/portal/compute-theater";
import { vault } from "@/lib/vault";

type Stage = "idle" | "running" | "ready";
const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function MarginLeakTool({ onClose }: { onClose: () => void }) {
  const [inputs, setInputs] = useState<MarginLeakInputs>(DEFAULT_MARGIN_LEAK);
  const [stage, setStage] = useState<Stage>("idle");
  const [savedId, setSavedId] = useState<string | null>(null);

  const result = useMemo(() => calcMarginLeak(inputs), [inputs]);
  const ticker = useMemo(() => marginLeakTicker(inputs, result), [inputs, result]);

  function setNum<K extends keyof MarginLeakInputs>(key: K, raw: string, asPct = false) {
    const clean = raw.replace(/[,$%]/g, "");
    const n = Number(clean);
    setInputs((p) => ({ ...p, [key]: Number.isFinite(n) ? (asPct ? n / 100 : n) : 0 } as MarginLeakInputs));
    if (stage === "ready") setStage("idle");
    setSavedId(null);
  }

  function run() {
    setSavedId(null);
    setStage("running");
  }

  function reset() {
    setInputs(DEFAULT_MARGIN_LEAK);
    setStage("idle");
    setSavedId(null);
  }

  function savePacket() {
    const saved = vault.save({
      kind: "command",
      source: "Margin Leak Finder",
      title: result.headline,
      primaryFinding: result.finding,
      primaryConstraint: `${inputs.topLeakSource} · ${(result.gapPct * 100).toFixed(1)}% gap`,
      financialConsequence:
        result.annualLeak > 0
          ? `${fmtMoney(result.annualLeak)}/yr leaving the business; ${fmtMoney(result.perProjectLeak)} per typical job.`
          : `Currently at or above target margin.`,
      missingSystem: `Operational discipline around: ${inputs.topLeakSource}.`,
      recommendedAction: result.recommendedAction,
      bringOneIssuePrompt:
        result.status === "bleeding"
          ? "What's the one job where the leak was most obvious?"
          : "Where do you suspect the leak hides that the numbers can't see yet?",
      intensiveRecommended: result.status === "bleeding",
      inputs: { ...inputs },
    });
    setSavedId(saved.id);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Command Tool · Protect margin and cash
          </p>
          <h1 className="mt-1 font-display text-[1.8rem] leading-tight" style={{ fontFamily: "var(--font-serif)" }}>
            Margin Leak Finder
          </h1>
          <p className="mt-1 max-w-xl text-[13px] text-muted-foreground">
            Compares target margin against what you actually finish jobs at, attaches a dollar number to the gap,
            and points at the structural cause.
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

      <div className="grid gap-6 lg:grid-cols-[minmax(340px,420px)_1fr] lg:items-start">
        <section className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-6">
          <p className="label-mono">Inputs</p>
          <div className="mt-4 grid gap-4">
            <Field
              label="Annual revenue"
              prefix="$"
              value={inputs.annualRevenue}
              onChange={(v) => setNum("annualRevenue", v)}
            />
            <Field
              label="Target gross margin"
              suffix="%"
              value={inputs.targetMarginPct * 100}
              onChange={(v) => setNum("targetMarginPct", v, true)}
            />
            <Field
              label="Actual gross margin (last 12 mo)"
              suffix="%"
              value={inputs.actualMarginPct * 100}
              onChange={(v) => setNum("actualMarginPct", v, true)}
            />
            <Field
              label="Average project size"
              prefix="$"
              value={inputs.avgProjectSize}
              onChange={(v) => setNum("avgProjectSize", v)}
            />
            <Field
              label="Projects showing the leak (out of last 10)"
              value={inputs.projectsAffected}
              onChange={(v) => setNum("projectsAffected", v)}
            />
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Top leak source
              </span>
              <select
                value={inputs.topLeakSource}
                onChange={(e) => {
                  setInputs((p) => ({ ...p, topLeakSource: e.target.value as LeakSource }));
                  if (stage === "ready") setStage("idle");
                  setSavedId(null);
                }}
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40"
              >
                {LEAK_SOURCES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={stage === "running"}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" />
              {stage === "ready" ? "Recompute" : "Find the leak"}
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

        <div className="flex min-w-0 flex-col gap-6">
          {stage === "idle" && (
            <div className="rounded-2xl border border-dashed border-border bg-background/40 p-10 text-center">
              <ScissorsLineDashed className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                Awaiting inputs
              </p>
              <p className="mt-2 text-[13px] text-muted-foreground" style={{ fontFamily: "var(--font-serif)" }}>
                Set your numbers, then run the analysis to see what the margin gap actually costs you each year.
              </p>
            </div>
          )}

          {(stage === "running" || stage === "ready") && (
            <ComputeTheater
              steps={MARGIN_LEAK_STEPS}
              ticker={ticker}
              running={stage === "running"}
              onDone={() => setStage("ready")}
              subtitle="Margin Leak Finder"
              fileLabel="tools/margin-leak.calc"
            />
          )}

          {stage === "ready" && (
            <section className="rounded-2xl border border-border bg-card p-6 reveal-up">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    Finding
                  </p>
                  <h2 className="mt-1 font-display text-[1.5rem] leading-tight" style={{ fontFamily: "var(--font-serif)" }}>
                    {result.headline}
                  </h2>
                </div>
                <StatusPill status={result.status} />
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <Metric label="Margin gap" value={`${(result.gapPct * 100).toFixed(1)}%`} tone={result.gapPct > 0 ? "warn" : "ok"} />
                <Metric label="Annual $ leak" value={fmtMoney(result.annualLeak)} tone={result.annualLeak > 0 ? "warn" : "ok"} />
                <Metric label="Per-project leak" value={fmtMoney(result.perProjectLeak)} tone={result.perProjectLeak > 0 ? "warn" : "ok"} />
              </div>

              <div className="mt-5 space-y-3 text-[14px] leading-relaxed text-foreground/85">
                <p style={{ fontFamily: "var(--font-serif)" }}>{result.finding}</p>
                <div className="rounded-md border border-border bg-background/60 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Recommended next move
                  </p>
                  <p className="mt-1.5 text-[14px] text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
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
                <Link
                  to="/calls"
                  hash="submit-topic"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Bring to next call
                </Link>
                <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Terminus · Vault / Calls
                </span>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, prefix, suffix,
}: {
  label: string; value: number; onChange: (v: string) => void; prefix?: string; suffix?: string;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</span>
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

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "ok" | "warn" | "neutral" }) {
  const color = tone === "warn" ? "text-signal" : tone === "ok" ? "text-signal-success" : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className={`mt-2 font-display text-[1.6rem] leading-none ${color}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: "bleeding" | "leaking" | "tight" | "ahead" }) {
  if (status === "ahead") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-success/40 bg-signal-success/10 px-3 py-1 text-[11px] font-medium text-signal-success">
        <TrendingUp className="h-3 w-3" /> Ahead of target
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
  if (status === "leaking") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-[11px] font-medium text-signal">
        <AlertTriangle className="h-3 w-3" /> Leaking
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/60 bg-signal/15 px-3 py-1 text-[11px] font-medium text-signal">
      <AlertTriangle className="h-3 w-3" /> Bleeding
    </span>
  );
}
