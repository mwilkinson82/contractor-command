// SOP Priority Builder — full-screen drawer tool.
// Owner lists the areas they still touch; we rank by leverage and surface
// the single system to build first.

import { useMemo, useState } from "react";
import { Play, RotateCcw, Save, Check, ListChecks, MessageSquare, Plus, Trash2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  calcSopPriority,
  DEFAULT_SOP_AREAS,
  SOP_PRIORITY_STEPS,
  sopPriorityTicker,
  type SopArea,
} from "@/lib/tools/sop-priority";
import { ComputeTheater } from "@/components/portal/compute-theater";
import { vault } from "@/lib/vault";

type Stage = "idle" | "running" | "ready";

export function SopPriorityTool({ onClose }: { onClose: () => void }) {
  const [areas, setAreas] = useState<SopArea[]>(DEFAULT_SOP_AREAS);
  const [stage, setStage] = useState<Stage>("idle");
  const [savedId, setSavedId] = useState<string | null>(null);

  const result = useMemo(() => calcSopPriority(areas), [areas]);
  const ticker = useMemo(() => sopPriorityTicker(areas, result), [areas, result]);

  function updateArea(idx: number, patch: Partial<SopArea>) {
    setAreas((prev) => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
    if (stage === "ready") setStage("idle");
    setSavedId(null);
  }

  function addArea() {
    setAreas((prev) => [
      ...prev,
      { name: "", ownerHoursPerWeek: 2, blastRadius: 3, setupEffort: 3, frequency: 3 },
    ]);
    if (stage === "ready") setStage("idle");
    setSavedId(null);
  }

  function removeArea(idx: number) {
    setAreas((prev) => prev.filter((_, i) => i !== idx));
    if (stage === "ready") setStage("idle");
    setSavedId(null);
  }

  function run() {
    setSavedId(null);
    setStage("running");
  }

  function reset() {
    setAreas(DEFAULT_SOP_AREAS);
    setStage("idle");
    setSavedId(null);
  }

  function savePacket() {
    const top = result.top;
    const saved = vault.save({
      kind: "command",
      source: "SOP Priority Builder",
      title: result.headline,
      primaryFinding: result.finding,
      primaryConstraint: `${top.name} — leverage score ${top.leverageScore.toFixed(1)}`,
      financialConsequence:
        `Roughly ${Math.round(top.annualHoursSaved)} owner hours/yr recovered if systematized; ` +
        `currently ${result.totalOwnerHours}h/wk spread across ${result.ranked.length} owner-touched areas.`,
      missingSystem: `SOP for ${top.name}`,
      recommendedAction: result.recommendedAction,
      bringOneIssuePrompt: "What's the one excuse you've used for not writing this SOP yet?",
      intensiveRecommended: result.totalOwnerHours > 30,
      inputs: { areas: JSON.stringify(areas), areaCount: areas.length, topArea: top.name },
    });
    setSavedId(saved.id);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Command Tool · Build the machine
          </p>
          <h1 className="mt-1 font-display text-[1.8rem] leading-tight" style={{ fontFamily: "var(--font-serif)" }}>
            SOP Priority Builder
          </h1>
          <p className="mt-1 max-w-xl text-[13px] text-muted-foreground">
            Lists every area you still touch, scores them by leverage, and tells you which system to build first —
            so you stop writing SOPs in the order they annoy you.
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

      <div className="grid gap-6 lg:grid-cols-[minmax(380px,520px)_1fr] lg:items-start">
        <section className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-6">
          <div className="flex items-center justify-between">
            <p className="label-mono">Owner-touched areas</p>
            <button
              type="button"
              onClick={addArea}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11px] text-foreground/70 hover:bg-muted"
            >
              <Plus className="h-3 w-3" /> Add area
            </button>
          </div>

          <div className="mt-3 space-y-3">
            {areas.map((a, i) => (
              <div key={i} className="rounded-md border border-border bg-background/60 p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={a.name}
                    onChange={(e) => updateArea(i, { name: e.target.value })}
                    placeholder="e.g. Estimating new bids"
                    className="w-full bg-transparent text-[13px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => removeArea(i)}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Remove area"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Num label="Hours/wk" value={a.ownerHoursPerWeek} onChange={(v) => updateArea(i, { ownerHoursPerWeek: v })} />
                  <Scale label="Blast radius" value={a.blastRadius} onChange={(v) => updateArea(i, { blastRadius: v })} />
                  <Scale label="Frequency" value={a.frequency} onChange={(v) => updateArea(i, { frequency: v })} />
                  <Scale label="Setup effort" value={a.setupEffort} onChange={(v) => updateArea(i, { setupEffort: v })} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={stage === "running"}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" />
              {stage === "ready" ? "Re-rank" : "Rank by leverage"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12px] text-foreground/70 hover:bg-muted"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Scales 1–5. Blast = what breaks if you're out. Effort = how hard to systematize (1 easy, 5 hard).
            Frequency = how often it recurs (5 = daily).
          </p>
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          {stage === "idle" && (
            <div className="rounded-2xl border border-dashed border-border bg-background/40 p-10 text-center">
              <ListChecks className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                Awaiting inputs
              </p>
              <p className="mt-2 text-[13px] text-muted-foreground" style={{ fontFamily: "var(--font-serif)" }}>
                List every area the business still pulls you into. Then rank to see which SOP earns its keep first.
              </p>
            </div>
          )}

          {(stage === "running" || stage === "ready") && (
            <ComputeTheater
              steps={SOP_PRIORITY_STEPS}
              ticker={ticker}
              running={stage === "running"}
              onDone={() => setStage("ready")}
              subtitle="SOP Priority Builder"
              fileLabel="tools/sop-priority.rank"
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
                <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/30 bg-background/60 px-3 py-1 text-[11px] font-medium text-foreground">
                  Leverage {result.top.leverageScore.toFixed(1)}
                </span>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {result.ranked.slice(0, 6).map((s) => (
                  <div
                    key={s.name + s.rank}
                    className={`rounded-xl border p-4 ${s.rank === 1 ? "border-foreground/30 bg-background" : "border-border bg-background/60"}`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        #{s.rank}
                      </p>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {s.leverageScore.toFixed(1)}
                      </span>
                    </div>
                    <p className="mt-2 text-[14px] font-medium text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
                      {s.name}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {s.ownerHoursPerWeek}h/wk · blast {s.blastRadius} · effort {s.setupEffort}
                    </p>
                  </div>
                ))}
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

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <input
        inputMode="decimal"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[,$]/g, ""));
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-foreground/40"
      />
    </label>
  );
}

function Scale({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-foreground/40"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </label>
  );
}
