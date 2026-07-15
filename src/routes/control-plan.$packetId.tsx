import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  History,
  Loader2,
  Save,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Container } from "@/components/portal/page-header";
import { vault, type CommandPacket } from "@/lib/vault";
import {
  controlPlanProgress,
  controlPlanState,
  createWeeklyControlReview,
  latestWeeklyControlReview,
  type ControlPlan,
  type ControlPlanMilestone,
  type ControlPlanStatus,
  type ConstraintTrend,
  type WeeklyControlReview,
  type WeeklyControlReviewInput,
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

const trendLabels: Record<ConstraintTrend, string> = {
  growing: "Growing",
  unchanged: "Unchanged",
  shrinking: "Shrinking",
  resolved: "Resolved",
};

function emptyWeeklyReview(): WeeklyControlReviewInput {
  return {
    movement: "",
    constraintTrend: "unchanged",
    blocked: false,
    blocker: "",
    nextAction: "",
    nextOwner: "",
    needsPressure: false,
    pressureNote: "",
  };
}

function ControlPlanPage() {
  const { packetId } = Route.useParams();
  const [packet, setPacket] = useState<CommandPacket | null>(null);
  const [plan, setPlan] = useState<ControlPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<WeeklyControlReviewInput>(emptyWeeklyReview);

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

  async function persistPlan(nextPlan: ControlPlan, successMessage: string) {
    if (!packet || saving) return false;
    setSaving(true);
    const saved = await vault.updateAndPersist(packet.id, { controlPlan: nextPlan });
    if (!saved || saved.kind !== "command") {
      toast.error("The 90-day plan could not be saved.");
      setSaving(false);
      return false;
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
    toast.success(successMessage);
    return true;
  }

  async function savePlan() {
    if (!plan || saving) return;
    await persistPlan(
      { ...plan, updatedAt: new Date().toISOString() },
      "90-day control plan saved.",
    );
  }

  async function saveWeeklyReview() {
    if (!plan || saving) return;
    if (
      !reviewDraft.movement.trim() ||
      !reviewDraft.nextAction.trim() ||
      !reviewDraft.nextOwner.trim()
    ) {
      toast.error("Add the movement, next action, and owner before saving the weekly review.");
      return;
    }
    if (reviewDraft.blocked && !reviewDraft.blocker.trim()) {
      toast.error("Name the blocker so it can be pressured in the room.");
      return;
    }
    if (reviewDraft.needsPressure && !reviewDraft.pressureNote.trim()) {
      toast.error("Name the decision or pressure you need from Marshall or the group.");
      return;
    }

    const review = createWeeklyControlReview(reviewDraft);
    const nextPlan: ControlPlan = {
      ...plan,
      updatedAt: review.reviewedAt,
      weeklyReviews: [review, ...(plan.weeklyReviews ?? [])],
    };
    const saved = await persistPlan(nextPlan, "Weekly control review saved.");
    if (saved) setReviewDraft(emptyWeeklyReview());
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

      <WeeklyControlReviewSection
        draft={reviewDraft}
        onChange={(updates) => setReviewDraft((current) => ({ ...current, ...updates }))}
        onSave={saveWeeklyReview}
        saving={saving}
        reviews={plan.weeklyReviews ?? []}
        primaryConstraint={packet.primaryConstraint}
      />

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

function WeeklyControlReviewSection({
  draft,
  onChange,
  onSave,
  saving,
  reviews,
  primaryConstraint,
}: {
  draft: WeeklyControlReviewInput;
  onChange: (updates: Partial<WeeklyControlReviewInput>) => void;
  onSave: () => void;
  saving: boolean;
  reviews: WeeklyControlReview[];
  primaryConstraint: string;
}) {
  const latest = latestWeeklyControlReview({ weeklyReviews: reviews });

  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border bg-ink px-6 py-5 text-cream">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
              Weekly control review
            </p>
            <h2 className="mt-2 font-display text-3xl">Keep the constraint in the room.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-cream/65">
              Five minutes each week turns the 90-day plan into a management rhythm: movement,
              constraint trend, blocker, owned action, and pressure needed.
            </p>
          </div>
          <div className="rounded-xl border border-cream/15 bg-cream/5 px-4 py-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/45">
              Active constraint
            </p>
            <p className="mt-1 max-w-xs text-sm font-medium">{primaryConstraint}</p>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <div className="p-6">
          <label className="block text-xs font-medium text-foreground">
            What moved this week?
            <textarea
              value={draft.movement}
              onChange={(event) => onChange({ movement: event.target.value })}
              rows={3}
              placeholder="Name the measurable movement, decision, or completed work."
              className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground"
            />
          </label>

          <fieldset className="mt-5">
            <legend className="text-xs font-medium text-foreground">
              Is the active constraint growing, shrinking, or resolved?
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(trendLabels) as ConstraintTrend[]).map((trend) => (
                <button
                  key={trend}
                  type="button"
                  aria-pressed={draft.constraintTrend === trend}
                  onClick={() => onChange({ constraintTrend: trend })}
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    draft.constraintTrend === trend
                      ? "border-ink bg-ink text-cream"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {trendLabels[trend]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-medium text-foreground">
              Next owned action
              <input
                value={draft.nextAction}
                onChange={(event) => onChange({ nextAction: event.target.value })}
                placeholder="What happens next?"
                className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground"
              />
            </label>
            <label className="block text-xs font-medium text-foreground">
              Owner
              <input
                value={draft.nextOwner}
                onChange={(event) => onChange({ nextOwner: event.target.value })}
                placeholder="Name the person"
                className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground"
              />
            </label>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <ReviewFlag
              checked={draft.blocked}
              onCheckedChange={(blocked) =>
                onChange({ blocked, blocker: blocked ? draft.blocker : "" })
              }
              title="Something is blocked"
              copy="Surface it before it becomes another lost week."
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <ReviewFlag
              checked={draft.needsPressure}
              onCheckedChange={(needsPressure) =>
                onChange({ needsPressure, pressureNote: needsPressure ? draft.pressureNote : "" })
              }
              title="I need pressure from the room"
              copy="Flag a decision, introduction, or issue for Marshall and the group."
              icon={<Activity className="h-4 w-4" />}
            />
          </div>

          {draft.blocked ? (
            <label className="mt-4 block text-xs font-medium text-foreground">
              What is blocked?
              <textarea
                value={draft.blocker}
                onChange={(event) => onChange({ blocker: event.target.value })}
                rows={2}
                placeholder="Name the blocker and the decision required to remove it."
                className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground"
              />
            </label>
          ) : null}

          {draft.needsPressure ? (
            <label className="mt-4 block text-xs font-medium text-foreground">
              What do you need from Marshall or the group?
              <textarea
                value={draft.pressureNote}
                onChange={(event) => onChange({ pressureNote: event.target.value })}
                rows={2}
                placeholder="Make the ask specific enough to bring into the next call or Discord thread."
                className="mt-2 w-full resize-y rounded-md border border-border bg-background px-3 py-2.5 text-sm leading-relaxed text-foreground"
              />
            </label>
          ) : null}

          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="mt-5 inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {saving ? "Saving review…" : "Complete weekly review"}
          </button>
        </div>

        <div className="border-t border-border bg-background/60 p-6 lg:border-l lg:border-t-0">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-clay" />
            <p className="label-mono">Review history</p>
          </div>
          {latest ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Last reviewed {formatDateTime(latest.reviewedAt)} ·{" "}
              {trendLabels[latest.constraintTrend]}
            </p>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              No weekly review yet. Complete the first one to establish the rhythm.
            </p>
          )}
          <div className="mt-4 space-y-3">
            {reviews.slice(0, 4).map((review) => (
              <article key={review.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium">{formatDateTime(review.reviewedAt)}</p>
                  <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-medium">
                    {trendLabels[review.constraintTrend]}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed">{review.movement}</p>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Next:</span> {review.nextAction} ·{" "}
                  {review.nextOwner}
                </p>
                {review.blocked ? (
                  <p className="mt-2 text-xs leading-relaxed text-clay">
                    <span className="font-medium">Blocked:</span> {review.blocker}
                  </p>
                ) : null}
                {review.needsPressure ? (
                  <p className="mt-2 text-xs leading-relaxed text-clay">
                    <span className="font-medium">Pressure needed:</span> {review.pressureNote}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ReviewFlag({
  checked,
  onCheckedChange,
  title,
  copy,
  icon,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  title: string;
  copy: string;
  icon: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${
        checked ? "border-clay/50 bg-clay/5" : "border-border bg-background"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 accent-[var(--clay)]"
      />
      <span>
        <span className="flex items-center gap-2 text-xs font-medium text-foreground">
          {icon} {title}
        </span>
        <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{copy}</span>
      </span>
    </label>
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

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date);
}
