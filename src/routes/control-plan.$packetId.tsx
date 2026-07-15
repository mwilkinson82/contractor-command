import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Circle, Loader2, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Container } from "@/components/portal/page-header";
import { vault, type CommandPacket } from "@/lib/vault";
import {
  controlPlanProgress,
  controlPlanState,
  type ControlPlan,
  type ControlPlanMilestone,
  type ControlPlanStatus,
} from "@/lib/control-plan";
import { markControlPlanStarted, markControlProgress } from "@/lib/control-progress";

export const Route = createFileRoute("/control-plan/$packetId")({
  head: () => ({ meta: [{ title: "90-Day Control Plan - ALP Contractor Circle" }] }),
  component: ControlPlanPage,
});

const statusLabels: Record<ControlPlanStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  complete: "Complete",
};

function ControlPlanPage() {
  const { packetId } = Route.useParams();
  const [packet, setPacket] = useState<CommandPacket | null>(null);
  const [plan, setPlan] = useState<ControlPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const loaded = await vault.getById(packetId, { fresh: true });
      if (!alive) return;
      if (!loaded || loaded.kind !== "command" || loaded.source !== "COS Navigator") {
        setError("This State of Control baseline could not be found.");
        setLoading(false);
        return;
      }
      if (!loaded.controlPlan) {
        setError(
          "This baseline predates the live 90-day plan. Run State of Control again to create one.",
        );
        setPacket(loaded);
        setLoading(false);
        return;
      }
      setPacket(loaded);
      setPlan(loaded.controlPlan);
      setLoading(false);
      void markControlPlanStarted();
    })();
    return () => {
      alive = false;
    };
  }, [packetId]);

  const progress = controlPlanProgress(plan ?? undefined);
  const planState = controlPlanState(plan ?? undefined);

  function updateMilestone(id: string, updates: Partial<ControlPlanMilestone>) {
    setPlan((current) =>
      current
        ? {
            ...current,
            milestones: current.milestones.map((milestone) =>
              milestone.id === id ? { ...milestone, ...updates } : milestone,
            ),
          }
        : current,
    );
    setDirty(true);
  }

  function toggleAction(milestoneId: string, actionId: string) {
    if (!plan) return;
    const milestone = plan.milestones.find((item) => item.id === milestoneId);
    if (!milestone) return;
    const actions = milestone.actions.map((action) =>
      action.id === actionId ? { ...action, complete: !action.complete } : action,
    );
    const allComplete = actions.length > 0 && actions.every((action) => action.complete);
    const anyComplete = actions.some((action) => action.complete);
    updateMilestone(milestoneId, {
      actions,
      status: allComplete
        ? "complete"
        : milestone.status === "blocked"
          ? "blocked"
          : anyComplete
            ? "in_progress"
            : "not_started",
    });
  }

  async function savePlan() {
    if (!plan || !packet || saving) return;
    setSaving(true);
    const nextPlan = { ...plan, updatedAt: new Date().toISOString() };
    const saved = await vault.updateAndPersist(packet.id, { controlPlan: nextPlan });
    if (!saved || saved.kind !== "command") {
      toast.error("The 90-day plan could not be saved.");
      setSaving(false);
      return;
    }
    const state = controlPlanState(nextPlan);
    const now = new Date().toISOString();
    await markControlProgress({
      plan_updated_at: now,
      plan_completed_at: state === "complete" ? now : null,
    });
    setPacket(saved);
    setPlan(nextPlan);
    setDirty(false);
    setSaving(false);
    toast.success("90-day control plan saved.");
  }

  if (loading) {
    return (
      <Container className="py-12">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the plan…
        </div>
      </Container>
    );
  }

  if (error || !packet || !plan) {
    return (
      <Container className="py-12">
        <Link
          to="/tools/cos-navigator"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to State of Control
        </Link>
        <div className="mt-6 max-w-2xl rounded-2xl border border-border bg-card p-6">
          <ShieldAlert className="h-5 w-5 text-clay" />
          <h1 className="mt-4 font-display text-3xl">A current baseline is required.</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p>
          <Link
            to="/tools/cos-navigator"
            className="mt-5 inline-flex rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-cream"
          >
            Run State of Control
          </Link>
        </div>
      </Container>
    );
  }

  const score = Number(packet.inputs.totalScore ?? 0);
  const maturity = String(packet.inputs.maturity ?? "Current baseline");

  return (
    <Container className="py-10">
      <div className="flex flex-wrap items-end justify-between gap-5 border-b border-border pb-6">
        <div>
          <Link
            to="/tools/cos-navigator"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> State of Control
          </Link>
          <p className="mt-4 label-mono">Professional Contractor Control</p>
          <h1 className="mt-2 font-display text-4xl sm:text-5xl">My 90-Day Control Plan</h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Turn the diagnosis into owned work. Update this plan on rhythm, bring blockers to the
            room, and reassess after 90 days.
          </p>
        </div>
        <button
          type="button"
          onClick={savePlan}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Saving…" : dirty ? "Save plan" : "Plan saved"}
        </button>
      </div>

      <section className="mt-6 grid gap-4 md:grid-cols-4">
        <Summary label="Baseline" value={`${score}/100`} copy={maturity} />
        <Summary
          label="Primary constraint"
          value={packet.primaryConstraint}
          copy={String(packet.inputs.primaryCategory ?? "Operating control")}
        />
        <Summary
          label="Plan progress"
          value={`${progress.percent}%`}
          copy={`${progress.completed} of ${progress.total} actions complete`}
        />
        <Summary
          label="90-day review"
          value={formatDate(plan.reviewDate)}
          copy={statusLabels[planState]}
        />
      </section>

      <div className="mt-8 space-y-6">
        {plan.milestones.map((milestone, index) => (
          <MilestoneCard
            key={milestone.id}
            milestone={milestone}
            index={index}
            onChange={(updates) => updateMilestone(milestone.id, updates)}
            onToggleAction={(actionId) => toggleAction(milestone.id, actionId)}
          />
        ))}
      </div>

      <section className="mt-8 flex flex-col gap-4 rounded-2xl bg-ink p-6 text-cream sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
            Run the loop
          </p>
          <h2 className="mt-2 font-display text-2xl">
            Review the plan weekly. Remeasure at 90 days.
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream/65">
            Use Ask Marshall and the Contractor Circle calls to pressure-test blockers before they
            become another lost month.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            to="/ask"
            search={{ diagnosis: packet.id } as never}
            className="rounded-md bg-cream px-4 py-2.5 text-sm font-medium text-ink"
          >
            Ask Marshall
          </Link>
          <Link
            to="/tools/cos-navigator"
            className="rounded-md border border-cream/20 px-4 py-2.5 text-sm text-cream"
          >
            Reassess
          </Link>
        </div>
      </section>
    </Container>
  );
}

function Summary({ label, value, copy }: { label: string; value: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="label-mono">{label}</p>
      <p className="mt-3 font-display text-2xl leading-tight">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{copy}</p>
    </div>
  );
}

function MilestoneCard({
  milestone,
  index,
  onChange,
  onToggleAction,
}: {
  milestone: ControlPlanMilestone;
  index: number;
  onChange: (updates: Partial<ControlPlanMilestone>) => void;
  onToggleAction: (actionId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="flex items-start gap-4">
            <span className="font-display text-4xl text-foreground/12">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <p className="label-mono">{milestone.period}</p>
              <h2 className="mt-1 font-display text-3xl">{milestone.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {milestone.impact}
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-2">
            {milestone.actions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => onToggleAction(action.id)}
                aria-pressed={action.complete}
                aria-label={`${action.complete ? "Mark incomplete" : "Mark complete"}: ${action.title}`}
                className="flex w-full items-start gap-3 rounded-xl border border-border bg-background p-3 text-left hover:bg-muted/50"
              >
                {action.complete ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={`text-sm leading-relaxed ${action.complete ? "text-muted-foreground line-through" : ""}`}
                >
                  {action.title}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="label-mono">Ownership and review</p>
          <label className="mt-4 block text-xs text-muted-foreground">
            Owner
            <input
              value={milestone.owner}
              onChange={(event) => onChange({ owner: event.target.value })}
              placeholder="Name the owner"
              className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="mt-4 block text-xs text-muted-foreground">
            Due date
            <input
              type="date"
              value={milestone.dueDate}
              onChange={(event) => onChange({ dueDate: event.target.value })}
              className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
            />
          </label>
          <label className="mt-4 block text-xs text-muted-foreground">
            Status
            <select
              value={milestone.status}
              onChange={(event) => onChange({ status: event.target.value as ControlPlanStatus })}
              className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground"
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 block text-xs text-muted-foreground">
            Management note
            <textarea
              value={milestone.notes}
              onChange={(event) => onChange({ notes: event.target.value })}
              rows={4}
              placeholder="What changed? What is blocked? What decision is needed?"
              className="mt-1.5 w-full resize-y rounded-md border border-border bg-card px-3 py-2 text-sm leading-relaxed text-foreground"
            />
          </label>
          <div className="mt-4 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Playbook:</span> {milestone.playbook}
            </p>
            <p className="mt-1">
              <span className="font-medium text-foreground">Worksheet:</span> {milestone.worksheet}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
        date,
      );
}
