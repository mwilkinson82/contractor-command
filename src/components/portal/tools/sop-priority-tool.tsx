// SOP Priority Builder v2 — two modes:
//  A) Owner extraction — owner still in the work; rank what to systemize first.
//  B) Department build-out — owner is out; AI generates a prioritized SOP
//     backlog for a specific seat/silo (AOS-native), ordered by dependency.

import { useEffect, useMemo, useRef, useState } from "react";
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
  type SopScored,
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
import type { OwnerPlaysResult } from "@/lib/tools/owner-plays";
import { ComputeTheater } from "@/components/portal/compute-theater";
import { SopDocumentBuilder } from "@/components/portal/tools/sop-document-builder";
import { vault } from "@/lib/vault";
import { supabase } from "@/integrations/supabase/client";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

type Mode = "owner" | "department";
type Stage = "idle" | "running" | "ready" | "error";

export function SopPriorityTool({ onClose }: { onClose?: () => void }) {
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
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground/70 hover:bg-muted"
          >
            Close
          </button>
        )}
      </header>

      <div className="inline-flex w-fit gap-1 rounded-full border border-border bg-background/60 p-1">
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
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[12px] font-medium transition ${
        active
          ? "bg-foreground/10 text-foreground shadow-sm"
          : "bg-transparent text-foreground/60 hover:bg-foreground/5 hover:text-foreground/80"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/* ---------------------------- Mode A: Owner ---------------------------- */

const OWNER_STORAGE_KEY = "sop-priority:owner-mode-v1";

type OwnerPersisted = {
  areas: SopArea[];
  ownerContext: string;
  stage: Stage;
  buildingSop: {
    item: SopBacklogItem;
    parentPlay: OptimizationPlay | null;
    area: string;
  } | null;
};

function loadOwnerPersisted(): Partial<OwnerPersisted> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(OWNER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<OwnerPersisted>) : {};
  } catch {
    return {};
  }
}

function OwnerMode() {
  const initial = loadOwnerPersisted();
  const [areas, setAreas] = useState<SopArea[]>(initial.areas ?? DEFAULT_SOP_AREAS);
  const [ownerContext, setOwnerContext] = useState(initial.ownerContext ?? "");
  const [stage, setStage] = useState<Stage>(
    initial.stage === "ready" ? "ready" : "idle",
  );
  const [savedId, setSavedId] = useState<string | null>(null);

  // Per-area cached plays results (keyed by area name).
  const [playsByArea, setPlaysByArea] = useState<Record<string, OwnerPlaysResult>>({});
  const [loadingArea, setLoadingArea] = useState<string | null>(null);
  const [areaError, setAreaError] = useState<Record<string, string>>({});
  const [expandedArea, setExpandedArea] = useState<string | null>(null);

  // SOP doc builder takes over the right pane when set.
  const [buildingSop, setBuildingSop] = useState<{
    item: SopBacklogItem;
    parentPlay: OptimizationPlay | null;
    area: string;
  } | null>(initial.buildingSop ?? null);

  // Persist core state so navigating away and returning restores the SOP draft.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload: OwnerPersisted = { areas, ownerContext, stage, buildingSop };
      window.localStorage.setItem(OWNER_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [areas, ownerContext, stage, buildingSop]);


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
    setOwnerContext("");
    setStage("idle");
    setSavedId(null);
    setPlaysByArea({});
    setAreaError({});
    setExpandedArea(null);
    setBuildingSop(null);
    try { if (typeof window !== "undefined") window.localStorage.removeItem(OWNER_STORAGE_KEY); } catch {}
  }


  async function loadPlaysFor(area: SopScored) {
    if (playsByArea[area.name] || loadingArea === area.name) return;
    setLoadingArea(area.name);
    setAreaError((prev) => ({ ...prev, [area.name]: "" }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setAreaError((prev) => ({ ...prev, [area.name]: "You need to be signed in." }));
        return;
      }
      const res = await fetch("/api/owner-plays", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          area: area.name,
          hoursPerWeek: area.ownerHoursPerWeek,
          blastRadius: area.blastRadius,
          setupEffort: area.setupEffort,
          frequency: area.frequency,
          context: ownerContext,
        }),
      });
      if (!res.ok) {
        const msg = (await res.text()) || `Failed (${res.status})`;
        setAreaError((prev) => ({ ...prev, [area.name]: msg }));
        return;
      }
      const data = (await res.json()) as OwnerPlaysResult;
      setPlaysByArea((prev) => ({ ...prev, [area.name]: data }));
    } catch (e) {
      setAreaError((prev) => ({
        ...prev,
        [area.name]: e instanceof Error ? e.message : "Failed to load extraction plays.",
      }));
    } finally {
      setLoadingArea(null);
    }
  }

  function toggleArea(area: SopScored) {
    setExpandedArea((cur) => {
      const next = cur === area.name ? null : area.name;
      if (next && !playsByArea[area.name]) {
        void loadPlaysFor(area);
      }
      return next;
    });
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
          <div>
            <p className="label-mono">Step 1 · Your inputs</p>
            <p
              className="mt-1 font-display text-[18px] leading-tight"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              Touchpoints you still own
            </p>
          </div>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
          Every row below is editable. Rename it, change the numbers, delete what doesn't apply, and add anything missing. This list drives the ranking.
        </p>

        <div className="mt-4 space-y-3">
          {areas.map((a, i) => (
            <div
              key={i}
              className="group rounded-md border border-border bg-background/60 p-3 transition hover:-translate-y-px hover:border-foreground/30 hover:shadow-sm"
            >
              <div className="flex items-center gap-2">
                <input
                  ref={i === 0 ? newAreaRef : undefined}
                  type="text"
                  value={a.name}
                  onChange={(e) => updateArea(i, { name: e.target.value })}
                  placeholder="Name this touchpoint (e.g. Estimating new bids)"
                  title="Click to edit"
                  className="w-full rounded-md border border-dashed border-foreground/25 bg-background px-3 py-1.5 text-[13.5px] font-medium text-foreground outline-none transition placeholder:font-normal placeholder:italic placeholder:text-muted-foreground/70 hover:border-foreground/60 focus:border-foreground focus:border-solid focus:ring-2 focus:ring-signal/20"
                />
                <button
                  type="button"
                  onClick={() => removeArea(i)}
                  className="rounded-md p-1.5 text-muted-foreground opacity-40 transition hover:bg-muted hover:text-foreground group-hover:opacity-100"
                  aria-label="Remove touchpoint"
                  title="Remove this touchpoint"
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

          <button
            type="button"
            onClick={addArea}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-foreground/30 bg-background/30 px-3 py-3 text-[12.5px] font-medium text-foreground/70 transition hover:border-foreground/60 hover:bg-background hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Add another touchpoint you still own
          </button>
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

        <label className="mt-4 block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Owner context (optional)
          </span>
          <textarea
            value={ownerContext}
            onChange={(e) => setOwnerContext(e.target.value)}
            placeholder="What keeps pulling you back in? Decisions only you can make, relationships only you hold, info that lives in your head."
            className="mt-1 h-[88px] w-full resize-y rounded-md border border-border bg-background p-2.5 text-[13.5px] leading-relaxed text-foreground outline-none focus:border-foreground/40"
          />
          <span className="mt-1 block text-[12px] text-muted-foreground">
            Used when generating extraction plays for a specific area.
          </span>
        </label>
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

        {stage === "ready" && buildingSop && (
          <SopDocumentBuilder
            item={buildingSop.item}
            department={buildingSop.area}
            parentPlay={buildingSop.parentPlay}
            ownerContext={ownerContext}
            onBack={() => setBuildingSop(null)}
          />
        )}

        {stage === "ready" && !buildingSop && (
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

            <p className="mt-3 text-[13.5px] leading-relaxed text-foreground/85" style={{ fontFamily: "var(--font-serif)" }}>
              {result.finding}
            </p>

            <div className="mt-5">
              <p className="label-mono">Ranked areas · click any to build extraction plays</p>
              <p className="mt-2 text-[16px] italic leading-relaxed text-foreground/80" style={{ fontFamily: "var(--font-serif)", fontWeight: 400 }}>
                Each area gets its own Optimization Plays (delegate · batch · eliminate · systematize · automate) and a small SOP backlog to make the transfer stick. The #1 area is the highest leverage — start there.
              </p>
              <ol className="mt-3 space-y-3">
                {result.ranked.map((s) => (
                  <OwnerAreaCard
                    key={s.name + s.rank}
                    area={s}
                    expanded={expandedArea === s.name}
                    loading={loadingArea === s.name}
                    plays={playsByArea[s.name]}
                    error={areaError[s.name]}
                    onToggle={() => toggleArea(s)}
                    onBuildSop={(item: SopBacklogItem, parentPlay: OptimizationPlay | null) =>
                      setBuildingSop({ item, parentPlay, area: s.name })
                    }
                  />
                ))}
              </ol>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={savePacket}
                disabled={!!savedId}
                className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-70"
              >
                {savedId ? <Check className="h-3.5 w-3.5 text-signal-success" /> : <Save className="h-3.5 w-3.5" />}
                {savedId ? "Saved to vault" : "Save ranking to vault"}
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

const DEPT_STORAGE_KEY = "sop-priority:department-mode-v1";

type DeptPersisted = {
  department: SopDepartment;
  companyStage: CompanyStage;
  seatHeadcount: number;
  context: string;
  stage: Stage;
  result: SopBacklogResult | null;
  buildingSop: SopBacklogItem | null;
};

function loadDeptPersisted(): Partial<DeptPersisted> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DEPT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<DeptPersisted>) : {};
  } catch {
    return {};
  }
}

function DepartmentMode() {
  const initial = loadDeptPersisted();
  const [department, setDepartment] = useState<SopDepartment>(initial.department ?? "Project Management");
  const [companyStage, setCompanyStage] = useState<CompanyStage>(initial.companyStage ?? "scaling");
  const [seatHeadcount, setSeatHeadcount] = useState<number>(initial.seatHeadcount ?? 1);
  const [context, setContext] = useState(initial.context ?? "");

  const hasInitialResult = !!initial.result && initial.stage === "ready";
  const [stage, setStage] = useState<Stage>(hasInitialResult ? "ready" : "idle");
  const [result, setResult] = useState<SopBacklogResult | null>(initial.result ?? null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [buildingSop, setBuildingSop] = useState<SopBacklogItem | null>(initial.buildingSop ?? null);
  const [openPlayId, setOpenPlayId] = useState<string | null>(null);
  const [theaterComplete, setTheaterComplete] = useState(false);

  // Persist so user returns to the SOP they were drafting.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const payload: DeptPersisted = {
        department, companyStage, seatHeadcount, context,
        stage: stage === "running" || stage === "error" ? "idle" : stage,
        result, buildingSop,
      };
      window.localStorage.setItem(DEPT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [department, companyStage, seatHeadcount, context, stage, result, buildingSop]);


  const pending = useRef<SopBacklogResult | null>(null);
  const theaterDone = useRef(false);
  const fetchDone = useRef(false);
  const waitingForResult = stage === "running" && theaterComplete && !fetchDone.current;

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
    setTheaterComplete(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError("You need to be signed in to generate a backlog.");
        setStage("error");
        return;
      }
      const controller = new AbortController();
      // Server tries up to three models with its own per-model timeouts; give
      // the request enough headroom to actually walk the chain on cold start.
      const timeout = window.setTimeout(() => controller.abort(), 75000);

      const res = await fetch("/api/sop-backlog", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ department, stage: companyStage, seatHeadcount, context }),
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));
      if (!res.ok) {
        setError((await res.text()) || `Failed (${res.status})`);
        setStage("error");
        return;
      }
      pending.current = (await res.json()) as SopBacklogResult;
      fetchDone.current = true;
      maybeReveal();
    } catch (e) {
      setError(e instanceof DOMException && e.name === "AbortError" ? "SOP generation timed out. Try again with a shorter chokepoint description." : e instanceof Error ? e.message : "Failed.");
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
    setTheaterComplete(false);
    try { if (typeof window !== "undefined") window.localStorage.removeItem(DEPT_STORAGE_KEY); } catch {}
  }


  function savePacket() {
    if (!result) return;
    // Save one packet per SOP in the backlog so each one shows up in the
    // Vault and is individually editable. Each packet stores the backlog
    // item metadata + department + parent play, so the edit route can
    // AI-draft the SOP document on first open and persist edits back to
    // the same packet (no duplicates).
    const stackId = `stack_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    let firstId: string | null = null;
    for (const s of result.backlog) {
      const parent = result.plays.find((p) => p.id === s.playId) ?? null;
      const saved = vault.save({
        kind: "command",
        source: "SOP Builder · Stack item",
        title: `SOP · ${s.name}`,
        primaryFinding: s.purpose,
        primaryConstraint: `${result.department} — ${s.owner}`,
        financialConsequence: parent ? `Operationalizes ${parent.id} · ${parent.name}` : "",
        missingSystem: s.name,
        recommendedAction: `Trigger: ${s.trigger}. Owner: ${s.owner}. ${s.why}`,
        bringOneIssuePrompt: `What's blocking the ${result.department} seat from owning "${s.name}"?`,
        intensiveRecommended: false,
        inputs: {
          mode: "department-stack-item",
          department: result.department,
          stage: companyStage,
          seatHeadcount,
          stackId,
          stackRank: s.rank,
          stackSize: result.backlog.length,
          sopBacklogItem: JSON.stringify(s),
          parentPlay: parent ? JSON.stringify(parent) : "",
          ownerContext: context,
        },
      });
      if (!firstId) firstId = saved.id;
    }
    setSavedId(firstId ?? `stack-${stackId}`);
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
          <>
            <ComputeTheater
              steps={SOP_BACKLOG_STEPS}
              ticker={ticker}
              running={stage === "running"}
              onDone={() => { theaterDone.current = true; setTheaterComplete(true); maybeReveal(); }}
              subtitle={`SOP Priority Builder · ${department}`}
              fileLabel="tools/sop-backlog.generate"
            />
            {waitingForResult && (
              <p className="-mt-3 rounded-md border border-border bg-background/70 px-4 py-2 text-[12px] text-muted-foreground">
                Still finalizing the SOP stack — if the model stalls, the tool will fall back to a built-in optimization plan automatically.
              </p>
            )}
          </>
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
              <p className="label-mono">Optimization plays · click any to read in detail</p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Structural moves first — these are the system redesigns. Click a play to open the full read and jump to the SOPs that operationalize it.
              </p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {result.plays.map((p) => (
                  <PlayCard
                    key={p.id}
                    play={p}
                    recommended={p.id === result.topPlayId}
                    selected={p.id === openPlayId}
                    onClick={() => setOpenPlayId(p.id)}
                  />
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-md border border-foreground/40 bg-background p-4 ring-1 ring-foreground/10">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Build this first · #{result.topSop.rank} · <span className="text-signal-success">operationalizes {result.topSop.playId}</span>
                {(() => {
                  const parent = result.plays.find((p) => p.id === result.topSop.playId);
                  return parent ? ` · ${parent.name.split("·").slice(-1)[0].trim()}` : "";
                })()}
              </p>
              <p className="mt-1.5 font-display text-[1.2rem] leading-tight text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
                {result.topSop.name}
              </p>
              <p className="mt-2 text-[13.5px] leading-relaxed text-foreground/85">{result.topSop.purpose}</p>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                <span className="font-mono uppercase tracking-[0.18em]">Why:</span> {result.topSop.why}
              </p>
              <button
                type="button"
                onClick={() => setBuildingSop(result.topSop)}
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-ink px-3.5 py-2 text-[13px] font-medium text-cream hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" /> Build this SOP
              </button>
            </div>

            <div className="mt-5">
              <p className="label-mono">
                SOP backlog · <span className="text-signal-success">operationalizes {result.topPlayId}</span>
                {openPlayId && openPlayId !== result.topPlayId && <> · highlighting <span className="text-foreground">{openPlayId}</span></>}
              </p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Ordered by dependency. Click any row to draft the full SOP document — purpose, steps, KPIs, escalation.
              </p>
              <ol className="mt-3 space-y-3">
                {result.backlog.map((s) => {
                  const parent = result.plays.find((p) => p.id === s.playId) ?? null;
                  return (
                    <BacklogRow
                      key={s.rank}
                      item={s}
                      onBuild={() => setBuildingSop(s)}
                      highlighted={!!openPlayId && s.playId === openPlayId}
                      parentPlayName={parent?.name}
                    />
                  );
                })}
              </ol>
            </div>

            <PlayDetailDialog
              play={result.plays.find((p) => p.id === openPlayId) ?? null}
              recommended={openPlayId === result.topPlayId}
              sops={result.backlog.filter((s) => s.playId === openPlayId)}
              onClose={() => setOpenPlayId(null)}
              onBuildSop={(s) => {
                setOpenPlayId(null);
                setBuildingSop(s);
              }}
            />

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={savePacket}
                disabled={!!savedId}
                className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-70"
              >
                {savedId ? <Check className="h-3.5 w-3.5 text-signal-success" /> : <Save className="h-3.5 w-3.5" />}
                {savedId
                  ? `Saved ${result.backlog.length} SOPs to vault`
                  : `Save stack (${result.backlog.length} SOPs) to vault`}
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

function PlayCard({
  play,
  recommended,
  selected,
  onClick,
}: {
  play: OptimizationPlay;
  recommended: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const base = selected
    ? "border-foreground bg-background ring-2 ring-foreground/20"
    : recommended
      ? "border-foreground/40 bg-background"
      : "border-border bg-background/60";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group w-full rounded-xl border p-4 text-left transition hover:border-foreground/60 hover:shadow-sm ${base}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={`font-mono text-[11px] uppercase tracking-[0.22em] ${recommended ? "text-signal-success" : "text-foreground"}`}>
          {play.id}
          {recommended && <span className="ml-1">· recommended</span>}
        </p>
        <span className="text-[12.5px] italic leading-snug text-foreground/70" style={{ fontFamily: "var(--font-serif)" }}>{play.expectedLift}</span>
      </div>
      <p className="mt-2 text-[15.5px] font-medium leading-snug text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
        {play.name}
      </p>
      <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-foreground/75">
        {play.diagnosis}
      </p>
      <p className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.22em] text-foreground/60 group-hover:text-foreground">
        Read full play →
      </p>
    </button>
  );
}

function BacklogRow({
  item,
  onBuild,
  highlighted,
  parentPlayName,
}: {
  item: SopBacklogItem;
  onBuild: () => void;
  highlighted?: boolean;
  parentPlayName?: string;
}) {
  return (
    <li
      className={`rounded-md border p-3.5 transition ${
        highlighted ? "border-foreground bg-background ring-2 ring-foreground/20" : "border-border bg-background/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-foreground/30 font-mono text-[10px] text-foreground">
          {item.rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="text-[15px] font-medium text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
              {item.name}
            </p>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              effort {item.effort} · <span className="text-signal-success">{item.playId}</span>
            </span>
          </div>
          {parentPlayName && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground/60">
              Operationalizes: <span className="normal-case tracking-normal text-foreground/80" style={{ fontFamily: "var(--font-serif)" }}>{parentPlayName}</span>
            </p>
          )}
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-foreground/85">{item.purpose}</p>
          <div className="mt-2 grid gap-1 text-[12.5px] text-muted-foreground sm:grid-cols-2">
            <p><span className="font-mono uppercase tracking-[0.18em]">Trigger:</span> {item.trigger}</p>
            <p><span className="font-mono uppercase tracking-[0.18em]">Owner:</span> {item.owner}</p>
          </div>
          {item.dependsOn.length > 0 && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              <span className="font-mono uppercase tracking-[0.18em]">Depends on:</span> {item.dependsOn.join(" · ")}
            </p>
          )}
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            <span className="font-mono uppercase tracking-[0.18em]">Why:</span> {item.why}
          </p>
          <button
            type="button"
            onClick={onBuild}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-cream hover:opacity-90"
          >
            <Sparkles className="h-3.5 w-3.5" /> Build this SOP
          </button>
        </div>
      </div>
    </li>
  );
}

function PlayDetailDialog({
  play,
  recommended,
  sops,
  onClose,
  onBuildSop,
}: {
  play: OptimizationPlay | null;
  recommended: boolean;
  sops: SopBacklogItem[];
  onClose: () => void;
  onBuildSop: (item: SopBacklogItem) => void;
}) {
  return (
    <Dialog open={!!play} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl border-border bg-card p-0 sm:rounded-2xl">
        {play && (
          <div className="max-h-[85vh] overflow-y-auto p-7">
            <div className="pr-8">
              <p className={`font-mono text-[11px] uppercase tracking-[0.22em] ${recommended ? "text-signal-success" : "text-foreground"}`}>
                Play {play.id}
                {recommended && <span className="ml-1">· recommended</span>}
              </p>
              <h3 className="mt-1.5 text-[1.75rem] leading-tight text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
                {play.name}
              </h3>
              <p className="mt-3 text-[15px] italic leading-relaxed text-foreground/80" style={{ fontFamily: "var(--font-serif)" }}>
                <span className="not-italic font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted-foreground mr-2 align-middle">Expected lift</span>
                {play.expectedLift}
              </p>
            </div>

            <div className="mt-5 space-y-4 text-[14.5px] leading-relaxed text-foreground/90">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Diagnosis</p>
                <p className="mt-1">{play.diagnosis}</p>
              </div>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Mechanism</p>
                <p className="mt-1">{play.mechanism}</p>
              </div>
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Risks to watch</p>
                <p className="mt-1">{play.risks}</p>
              </div>
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-foreground">
                SOPs that operationalize this play
              </p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Each SOP below makes <span className="text-foreground">{play.id}</span> stick. Build them in order.
              </p>
              {sops.length === 0 ? (
                <p className="mt-3 rounded-md border border-dashed border-border bg-background/60 p-4 text-[13px] text-muted-foreground">
                  No SOPs are tied directly to {play.id} yet. The recommended play's SOPs are listed in the main backlog.
                </p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {sops.map((s) => (
                    <BacklogRow
                      key={s.rank}
                      item={s}
                      onBuild={() => onBuildSop(s)}
                      highlighted
                    />
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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

/* ------------------------- Owner area card ------------------------- */

function OwnerAreaCard({
  area,
  expanded,
  loading,
  plays,
  error,
  onToggle,
  onBuildSop,
}: {
  area: SopScored;
  expanded: boolean;
  loading: boolean;
  plays?: OwnerPlaysResult;
  error?: string;
  onToggle: () => void;
  onBuildSop: (item: SopBacklogItem, parentPlay: OptimizationPlay | null) => void;
}) {
  const isTop = area.rank === 1;
  return (
    <li className={`rounded-xl border ${isTop ? "border-foreground/30 bg-background" : "border-border bg-background/60"}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
      >
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-foreground/30 font-mono text-[10px] text-foreground">
          {area.rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
            {area.name}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {area.ownerHoursPerWeek}h/wk · blast {area.blastRadius} · effort {area.setupEffort} · leverage {area.leverageScore.toFixed(1)}
          </p>
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-foreground/60" />
        ) : expanded ? (
          <ChevronDown className="h-4 w-4 text-foreground/60" />
        ) : (
          <ChevronRight className="h-4 w-4 text-foreground/60" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {error && (
            <p className="rounded-md border border-signal/40 bg-signal/10 p-3 text-[13px] text-foreground">
              {error}
            </p>
          )}
          {!error && !plays && loading && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Generating extraction plays for {area.name}… (10–20s)</span>
            </div>
          )}
          {plays && (
            <OwnerAreaBody
              plays={plays}
              onBuildSop={(it, parent) => onBuildSop(it, parent)}
            />
          )}
        </div>
      )}
    </li>
  );
}

function OwnerAreaBody({
  plays,
  onBuildSop,
}: {
  plays: OwnerPlaysResult;
  onBuildSop: (item: SopBacklogItem, parentPlay: OptimizationPlay | null) => void;
}) {
  const [openPlayId, setOpenPlayId] = useState<string | null>(null);
  const openPlay = plays.plays.find((p) => p.id === openPlayId) ?? null;
  const sopsForOpenPlay = openPlay ? plays.backlog.filter((s) => s.playId === openPlay.id) : [];

  return (
    <div className="space-y-4">
      <p className="text-[13.5px] leading-relaxed text-foreground/85">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Reframe: </span>
        {plays.constraintReframe}
      </p>
      <p className="text-[14px] leading-relaxed text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
        {plays.headline}
      </p>

      <div>
        <p className="label-mono">Optimization plays · click any to read in detail</p>
        <div className="mt-2 grid gap-2.5 md:grid-cols-2">
          {plays.plays.map((p) => (
            <PlayCard
              key={p.id}
              play={p}
              recommended={p.id === plays.topPlayId}
              selected={p.id === openPlayId}
              onClick={() => setOpenPlayId(p.id)}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="label-mono">
          SOP backlog · <span className="text-signal-success">operationalizes {plays.topPlayId}</span>
          {openPlayId && openPlayId !== plays.topPlayId && (
            <> · highlighting <span className="text-foreground">{openPlayId}</span></>
          )}
        </p>
        <ol className="mt-2 space-y-2.5">
          {plays.backlog.map((it) => {
            const parent = plays.plays.find((p) => p.id === it.playId) ?? null;
            return (
              <BacklogRow
                key={it.rank}
                item={it}
                onBuild={() => onBuildSop(it, parent)}
                highlighted={!!openPlayId && it.playId === openPlayId}
                parentPlayName={parent?.name}
              />
            );
          })}
        </ol>
      </div>

      <PlayDetailDialog
        play={openPlay}
        recommended={openPlay?.id === plays.topPlayId}
        sops={sopsForOpenPlay}
        onClose={() => setOpenPlayId(null)}
        onBuildSop={(it) => {
          const parent = plays.plays.find((p) => p.id === it.playId) ?? null;
          setOpenPlayId(null);
          onBuildSop(it, parent);
        }}
      />
    </div>
  );
}
