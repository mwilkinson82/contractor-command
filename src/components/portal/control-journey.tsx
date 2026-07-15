import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarClock, Check, CheckCircle2, Circle, Gauge } from "lucide-react";
import type {
  ControlJourney,
  ControlJourneyAction,
  ControlJourneyStep,
} from "@/lib/control-journey";

export function ControlJourneyPanel({
  journey,
  loading,
  failed,
}: {
  journey: ControlJourney | undefined;
  loading: boolean;
  failed: boolean;
}) {
  if (loading) return <ControlJourneySkeleton />;
  if (failed || !journey) return <ControlJourneyFallback />;

  const progressPercent = Math.round((journey.completedControls / journey.totalControls) * 100);
  const context = journey.primaryConstraint
    ? `${journey.primaryConstraint}${journey.primaryCategory ? ` · ${journey.primaryCategory}` : ""}`
    : journey.legacyBaseline
      ? "Your earlier State of Control is preserved, but it predates the live 90-day implementation plan."
      : "Establish the current company, project, and field-control baseline.";

  return (
    <section className="relative px-4 pb-10 sm:px-6" aria-labelledby="control-journey-title">
      <div className="mx-auto w-full max-w-[1180px] overflow-hidden rounded-2xl border border-ink/15 bg-card shadow-[0_24px_70px_-55px_color-mix(in_oklab,var(--ink)_45%,transparent)]">
        <div className="grid lg:grid-cols-[340px_minmax(0,1fr)]">
          <div className="flex flex-col bg-ink-panel p-6 text-cream sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-signal">
                Your Control Journey
              </p>
              <Gauge className="h-4 w-4 text-signal" aria-hidden="true" />
            </div>

            <h2
              id="control-journey-title"
              className="mt-5 font-display text-[2.35rem] leading-none"
            >
              {journey.phase}
            </h2>
            <p className="mt-3 text-[12.5px] leading-relaxed text-cream/62">{context}</p>

            <div className="mt-6 grid grid-cols-2 border-y border-cream/14 py-4">
              <div className="border-r border-cream/14 pr-4">
                <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-cream/40">
                  Control score
                </p>
                <p className="mt-2 font-display text-3xl">
                  {journey.score === null ? "—" : journey.score}
                  <span className="ml-1 text-sm text-cream/35">/100</span>
                </p>
              </div>
              <div className="pl-4">
                <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-cream/40">
                  Plan movement
                </p>
                <p className="mt-2 font-display text-3xl">{journey.planPercent}%</p>
                <p className="mt-1 text-[9px] text-cream/42">
                  {journey.planActionsTotal
                    ? `${journey.planActionsCompleted}/${journey.planActionsTotal} actions`
                    : "Plan not started"}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-3 text-[10px] text-cream/55">
                <span>Implementation controls</span>
                <span>
                  {journey.completedControls}/{journey.totalControls}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream/10">
                <div
                  className="h-full rounded-full bg-signal transition-[width]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-cream/12 bg-cream/[0.055] p-4">
              <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-signal">
                Your next move
              </p>
              <p className="mt-2 text-[13px] font-semibold text-cream">
                {journey.nextAction.label}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-cream/55">
                {journey.nextAction.detail}
              </p>
              <JourneyActionLink action={journey.nextAction} />
            </div>
          </div>

          <div className="flex min-h-0 flex-col p-5 sm:p-7">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
              <div>
                <p className="label-mono">The implementation path</p>
                <h3 className="mt-2 font-display text-[1.75rem] leading-none">
                  Keep the loop moving.
                </h3>
              </div>
              <p className="max-w-[360px] text-[11px] leading-relaxed text-muted-foreground">
                Complete the setup once. Update the plan weekly. Remeasure every 90 days.
              </p>
            </div>

            <ol className="mt-1 grid flex-1 sm:grid-cols-2 xl:grid-cols-3 xl:grid-rows-2">
              {journey.steps.map((step, index) => (
                <JourneyStep key={step.id} step={step} index={index} />
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

function JourneyStep({ step, index }: { step: ControlJourneyStep; index: number }) {
  const active = step.status === "active";
  const complete = step.status === "complete";
  const scheduled = step.status === "scheduled";
  const statusClass = complete
    ? "text-good"
    : active
      ? "text-clay"
      : scheduled
        ? "text-foreground/65"
        : "text-muted-foreground";

  return (
    <li
      aria-current={active ? "step" : undefined}
      className="grid min-h-[156px] grid-cols-[34px_minmax(0,1fr)] gap-3 border-b border-border px-2 py-5 sm:odd:border-r sm:px-4 xl:border-r xl:odd:border-r xl:[&:nth-child(3n)]:border-r-0 xl:[&:nth-child(n+4)]:border-b-0"
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full border ${
          complete
            ? "border-good/25 bg-good/10 text-good"
            : active
              ? "border-clay/30 bg-clay/10 text-clay"
              : "border-border bg-background text-muted-foreground"
        }`}
      >
        {complete ? (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        ) : scheduled ? (
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
        ) : active ? (
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Circle className="h-3 w-3" aria-hidden="true" />
        )}
      </span>
      <div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className={`font-mono text-[8px] uppercase tracking-[0.16em] ${statusClass}`}>
            {step.statusLabel}
          </span>
        </div>
        <p className="mt-3 text-[12.5px] font-semibold text-foreground">{step.title}</p>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">{step.detail}</p>
      </div>
    </li>
  );
}

function JourneyActionLink({ action }: { action: ControlJourneyAction }) {
  const className =
    "mt-4 inline-flex items-center gap-2 rounded-md bg-signal px-3.5 py-2 text-[11px] font-semibold text-ink hover:opacity-90";

  if (action.destination.route === "plan") {
    const params = { packetId: action.destination.packetId };
    return (
      <Link to="/control-plan/$packetId" params={params} className={className}>
        Make the move <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    );
  }
  if (action.destination.route === "orientation") {
    return (
      <Link to="/start-here" className={className}>
        Make the move <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    );
  }
  if (action.destination.route === "assessment") {
    return (
      <Link to="/tools/cos-navigator" className={className}>
        Make the move <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    );
  }
  return (
    <Link to="/vault" className={className}>
      Make the move <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

function ControlJourneySkeleton() {
  return (
    <section className="relative px-4 pb-10 sm:px-6" aria-label="Loading your Control Journey">
      <div className="mx-auto grid min-h-[320px] w-full max-w-[1180px] animate-pulse overflow-hidden rounded-2xl border border-border bg-card lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="bg-ink-panel p-7">
          <div className="h-3 w-32 rounded bg-cream/10" />
          <div className="mt-7 h-10 w-52 rounded bg-cream/10" />
          <div className="mt-5 h-16 rounded bg-cream/8" />
          <div className="mt-8 h-28 rounded bg-cream/8" />
        </div>
        <div className="grid gap-4 p-7 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-28 rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    </section>
  );
}

function ControlJourneyFallback() {
  return (
    <section className="relative px-4 pb-10 sm:px-6" aria-labelledby="control-journey-error">
      <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6">
        <div>
          <p className="label-mono">Your Control Journey</p>
          <h2 id="control-journey-error" className="mt-2 font-display text-2xl">
            The live journey could not be loaded.
          </h2>
          <p className="mt-2 text-[12px] text-muted-foreground">
            State of Control is still available while the dashboard read reconnects.
          </p>
        </div>
        <Link
          to="/tools/cos-navigator"
          className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[12px] font-medium text-cream"
        >
          Open State of Control <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
