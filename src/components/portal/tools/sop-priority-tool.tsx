// SOP Priority Builder v2 — two modes:
//  A) Owner extraction — owner still in the work; rank what to systemize first.
//  B) Department build-out — owner is out; AI generates a prioritized SOP
//     backlog for a specific seat/silo (AOS-native), ordered by dependency.

import { useMemo, useRef, useState } from "react";
import {
  Play,
  RotateCcw,
  Save,
  Check,
  ListChecks,
  MessageSquare,
  Plus,
  Trash2,
  Building2,
  UserCog,
  Loader2,
  Copy,
  Sparkles,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  calcSopPriority,
  DEFAULT_SOP_AREAS,
  SOP_PRIORITY_STEPS,
  sopPriorityTicker,
  type SopArea,
} from "@/lib/tools/sop-priority";
import {
  SOP_BACKLOG_STEPS,
  SOP_DEPARTMENTS,
  sopBacklogTicker,
  type CompanyStage,
  type OptimizationPlay,
  type SopBacklogItem,
  type SopBacklogResult,
  type SopDepartment,
} from "@/lib/tools/sop-department";
import { ComputeTheater } from "@/components/portal/compute-theater";
import { SopDocumentBuilder } from "@/components/portal/tools/sop-document-builder";
import { vault } from "@/lib/vault";
import { supabase } from "@/integrations/supabase/client";

type Mode = "owner" | "department";
type Stage = "idle" | "running" | "ready" | "error";

export function SopPriorityTool({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("owner");

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
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            Two ways in. If you're still in the work, rank what to systemize first.
            If you're out and have a seat holder, build their department SOP stack in dependency order.
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

      <div className="inline-flex w-fit gap-1 rounded-md border border-border bg-background/60 p-1">
        <ModeBtn active={mode === "owner"} onClick={() => setMode("owner")} icon={<UserCog className="h-3.5 w-3.5" />}>
          Owner extraction
        </ModeBtn>
        <ModeBtn
          active={mode === "department"}
          onClick={() => setMode("department")}
          icon={<Building2 className="h-3.5 w-3.5" />}
        >
          Department build-out
        </ModeBtn>
      </div>

      {mode === "owner" ? <OwnerMode /> : <DepartmentMode />}
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-medium transition ${
        active ? "bg-ink text-cream" : "text-foreground/70 hover:bg-muted"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/* ---------------------------- Mode A: Owner ---------------------------- */

function OwnerMode() {
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
  const newAreaRef = useRef<HTMLInputElement | null>(null);
  function addArea() {
    setAreas((prev) => [
      { name: "", ownerHoursPerWeek: 2, blastRadius: 3, setupEffort: 3, frequency: 3 },
      ...prev,
    ]);
    if (stage === "ready") setStage("idle");
    setSavedId(null);
    // focus the new (top) input on next paint
    requestAnimationFrame(() => {
      newAreaRef.current?.focus();
      newAreaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
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
      inputs: { mode: "owner", areas: JSON.stringify(areas), areaCount: areas.length, topArea: top.name },
    });
    setSavedId(saved.id);
  }

  return (
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
                  ref={i === 0 ? newAreaRef : undefined}
                  type="text"
                  value={a.name}
                  onChange={(e) => updateArea(i, { name: e.target.value })}
                  placeholder="Name this area (e.g. Estimating new bids)"
                  title="Click to edit area name"
                  className="w-full rounded-full border border-dashed border-border/70 bg-background/60 px-3 py-1.5 text-[13px] font-medium text-foreground outline-none transition placeholder:font-normal placeholder:italic placeholder:text-muted-foreground/70 hover:border-foreground/50 hover:bg-background focus:border-foreground focus:border-solid focus:bg-background"
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
            subtitle="SOP Priority Builder · Owner extraction"
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
  );
}

/* ------------------------- Mode B: Department ------------------------- */

function DepartmentMode() {
  const [department, setDepartment] = useState<SopDepartment>("Project Management");
  const [companyStage, setCompanyStage] = useState<CompanyStage>("scaling");
  const [seatHeadcount, setSeatHeadcount] = useState<number>(1);
  const [context, setContext] = useState("");

  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<SopBacklogResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [buildingSop, setBuildingSop] = useState<SopBacklogItem | null>(null);

  const pending = useRef<SopBacklogResult | null>(null);
  const theaterDone = useRef(false);
  const fetchDone = useRef(false);

  const ticker = useMemo(
    () => sopBacklogTicker(department, companyStage, seatHeadcount),
    [department, companyStage, seatHeadcount],
  );

  function maybeReveal() {
    if (theaterDone.current && fetchDone.current && pending.current) {
      setResult(pending.current);
      setStage("ready");
    }
  }

  async function run() {
    setStage("running");
    setResult(null);
    setError(null);
    setSavedId(null);
    pending.current = null;
    theaterDone.current = false;
    fetchDone.current = false;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError("You need to be signed in to generate a backlog.");
        setStage("error");
        return;
      }
      const res = await fetch("/api/sop-backlog", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ department, stage: companyStage, seatHeadcount, context }),
      });
      if (!res.ok) {
        setError((await res.text()) || `Failed (${res.status})`);
        setStage("error");
        return;
      }
      pending.current = (await res.json()) as SopBacklogResult;
      fetchDone.current = true;
      maybeReveal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
      setStage("error");
    }
  }

  function reset() {
    setStage("idle");
    setResult(null);
    setError(null);
    setSavedId(null);
    setBuildingSop(null);
    pending.current = null;
    theaterDone.current = false;
    fetchDone.current = false;
  }

  function savePacket() {
    if (!result) return;
    const top = result.topSop;
    const saved = vault.save({
      kind: "command",
      source: "SOP Priority Builder",
      title: `${result.department} · Build "${top.name}" first`,
      primaryFinding: result.headline,
      primaryConstraint: `${result.department} seat — ${result.backlog.length} SOPs in backlog`,
      financialConsequence: result.buildOrderRationale,
      missingSystem: `${result.department} SOP stack — ${result.backlog.length} SOPs sequenced by dependency`,
      recommendedAction:
        `Draft "${top.name}" this week. Trigger: ${top.trigger}. Owner: ${top.owner}. ` +
        `It's the foundation the next ${Math.min(3, result.backlog.length - 1)} SOPs depend on.`,
      bringOneIssuePrompt: `What's blocking the ${result.department} seat from owning this stack?`,
      intensiveRecommended: result.backlog.length >= 10,
      inputs: {
        mode: "department",
        department: result.department,
        stage: companyStage,
        seatHeadcount,
        backlogSize: result.backlog.length,
        topSop: top.name,
      },
    });
    setSavedId(saved.id);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(360px,460px)_1fr] lg:items-start">
      <section className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-6">
        <p className="label-mono">Seat / department</p>

        <label className="mt-3 block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Department
          </span>
          <select
            value={department}
            onChange={(e) => {
              setDepartment(e.target.value as SopDepartment);
              if (stage === "ready" || stage === "error") setStage("idle");
              setSavedId(null);
            }}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40"
          >
            {SOP_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Company stage
            </span>
            <select
              value={companyStage}
              onChange={(e) => setCompanyStage(e.target.value as CompanyStage)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40"
            >
              <option value="starting">Starting (&lt; $2M)</option>
              <option value="scaling">Scaling ($2–15M)</option>
              <option value="mature">Mature ($15M+)</option>
            </select>
          </label>
          <label className="block">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-muted-foreground">
              Seat headcount
            </span>
            <input
              type="number"
              min={1}
              max={50}
              value={Number.isFinite(seatHeadcount) ? seatHeadcount : ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  setSeatHeadcount(NaN as unknown as number);
                  return;
                }
                const n = Number(raw);
                if (Number.isFinite(n)) setSeatHeadcount(n);
              }}
              onBlur={() => {
                const n = Number.isFinite(seatHeadcount) ? seatHeadcount : 1;
                setSeatHeadcount(Math.max(1, Math.min(50, Math.round(n) || 1)));
              }}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px] text-foreground outline-none focus:border-foreground/40"
            />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Context (optional)
          </span>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="What's chewing this seat up right now? Recent fires, gaps, hand-off failures."
            className="mt-1 h-[110px] w-full resize-y rounded-md border border-border bg-background p-2.5 text-[13px] leading-relaxed text-foreground outline-none focus:border-foreground/40"
          />
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={run}
            disabled={stage === "running"}
            className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-60"
          >
            {stage === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {stage === "ready" ? "Rebuild SOP stack" : "Build SOP stack"}
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
          AOS-native: SOPs are scoped to the seat's accountabilities, ordered so foundational
          systems exist before the ones that depend on them.
        </p>
      </section>

      <div className="flex min-w-0 flex-col gap-6">
        {stage === "idle" && (
          <div className="rounded-2xl border border-dashed border-border bg-background/40 p-10 text-center">
            <Building2 className="mx-auto h-5 w-5 text-muted-foreground" />
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              Pick a seat
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground" style={{ fontFamily: "var(--font-serif)" }}>
              Select the department, add context, then generate the backlog the seat holder should build through.
            </p>
          </div>
        )}

        {stage === "error" && (
          <div className="rounded-2xl border border-signal/40 bg-signal/10 p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">Generation failed</p>
            <p className="mt-2 text-[14px] text-foreground">{error}</p>
          </div>
        )}

        {(stage === "running" || stage === "ready") && (
          <ComputeTheater
            steps={SOP_BACKLOG_STEPS}
            ticker={ticker}
            running={stage === "running"}
            onDone={() => { theaterDone.current = true; maybeReveal(); }}
            subtitle={`SOP Priority Builder · ${department}`}
            fileLabel="tools/sop-backlog.generate"
          />
        )}

        {stage === "ready" && result && buildingSop && (
          <SopDocumentBuilder
            item={buildingSop}
            department={result.department}
            parentPlay={result.plays.find((p) => p.id === buildingSop.playId) ?? null}
            ownerContext={context}
            onBack={() => setBuildingSop(null)}
          />
        )}

        {stage === "ready" && result && !buildingSop && (
          <section className="rounded-2xl border border-border bg-card p-6 reveal-up">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                  {result.department} · Diagnosis
                </p>
                <h2 className="mt-1 font-display text-[1.5rem] leading-tight" style={{ fontFamily: "var(--font-serif)" }}>
                  {result.headline}
                </h2>
                <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-foreground/85">
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Reframe:</span>{" "}
                  {result.constraintReframe}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/30 bg-background/60 px-3 py-1 text-[11px] font-medium text-foreground">
                {result.plays.length} {result.plays.length === 1 ? "play" : "plays"} · {result.backlog.length} SOPs
              </span>
            </div>

            <div className="mt-5">
              <p className="label-mono">Optimization plays</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Structural moves first — these are the system redesigns. SOPs below operationalize the recommended play.
              </p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {result.plays.map((p) => (
                  <PlayCard key={p.id} play={p} recommended={p.id === result.topPlayId} />
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-md border border-foreground/30 bg-background p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Build this first · #{result.topSop.rank} · operationalizes {result.topSop.playId}
              </p>
              <p className="mt-1.5 font-display text-[1.15rem] leading-tight text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
                {result.topSop.name}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/85">{result.topSop.purpose}</p>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                <span className="font-mono uppercase tracking-[0.18em]">Why:</span> {result.topSop.why}
              </p>
              <button
                type="button"
                onClick={() => setBuildingSop(result.topSop)}
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" /> Build this SOP
              </button>
            </div>

            <div className="mt-5">
              <p className="label-mono">SOP backlog</p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Ordered by dependency. Click any row to draft the full SOP document — purpose, steps, KPIs, escalation.
              </p>
              <ol className="mt-3 space-y-3">
                {result.backlog.map((s) => (
                  <BacklogRow key={s.rank} item={s} onBuild={() => setBuildingSop(s)} />
                ))}
              </ol>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={savePacket}
                disabled={!!savedId}
                className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-70"
              >
                {savedId ? <Check className="h-3.5 w-3.5 text-signal-success" /> : <Save className="h-3.5 w-3.5" />}
                {savedId ? "Saved to vault" : "Save backlog to vault"}
              </button>
              <CopyBacklogBtn result={result} />
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
  );
}

function BacklogRow({ item }: { item: SopBacklogItem }) {
  return (
    <li className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-foreground/30 font-mono text-[10px] text-foreground">
          {item.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-[14px] font-medium text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
              {item.name}
            </p>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              effort {item.effort}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-foreground/85">{item.purpose}</p>
          <div className="mt-1.5 grid gap-1 text-[11.5px] text-muted-foreground sm:grid-cols-2">
            <p><span className="font-mono uppercase tracking-[0.18em]">Trigger:</span> {item.trigger}</p>
            <p><span className="font-mono uppercase tracking-[0.18em]">Owner:</span> {item.owner}</p>
          </div>
          {item.dependsOn.length > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              <span className="font-mono uppercase tracking-[0.18em]">Depends on:</span> {item.dependsOn.join(" · ")}
            </p>
          )}
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            <span className="font-mono uppercase tracking-[0.18em]">Why:</span> {item.why}
          </p>
        </div>
      </div>
    </li>
  );
}

function CopyBacklogBtn({ result }: { result: SopBacklogResult }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    const text =
      `${result.department} — SOP Backlog\n${result.headline}\n${result.buildOrderRationale}\n\n` +
      result.backlog
        .map(
          (s) =>
            `${s.rank}. ${s.name} [${s.effort}]\n   Purpose: ${s.purpose}\n   Trigger: ${s.trigger}\n   Owner: ${s.owner}\n   ${s.dependsOn.length ? `Depends on: ${s.dependsOn.join(", ")}\n   ` : ""}Why: ${s.why}`,
        )
        .join("\n\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[12px] font-medium text-foreground hover:bg-muted"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-signal-success" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied backlog" : "Copy backlog"}
    </button>
  );
}

/* ------------------------- Shared inputs ------------------------- */

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
