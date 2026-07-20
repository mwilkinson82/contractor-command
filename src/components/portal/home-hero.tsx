import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Download, ExternalLink, Map, Route as RouteIcon } from "lucide-react";
import { GreetingIcon, type GreetingIconKey } from "@/components/portal/greeting-icon";
import type { DashboardMove } from "@/components/portal/dashboard-moves";
import { isGoogleDrivePreviewUrl, openTemplateFile, type ReplayWithResources } from "@/lib/library";

export function HomeHero({
  companyName,
  greeting,
  firstName,
  today,
  greetingIcon,
  moves,
  aosLinked,
  featuredTraining,
}: {
  companyName: string;
  greeting: string;
  firstName: string;
  today: string;
  greetingIcon?: GreetingIconKey | null;
  moves: DashboardMove[];
  aosLinked: boolean;
  featuredTraining: ReplayWithResources | null;
}) {
  const primaryMove = moves[0];
  const ownerMove = moves.find((move) => move.owner);
  const commandMove = moves.find((move) => move.source !== "AOS");
  const moveCount = moves.length;
  const activeDay = today ? new Date().getDay() : 0;
  const week = [
    {
      day: "Monday",
      label: "Choose the move",
      detail: primaryMove?.title ?? "Name the constraint",
    },
    {
      day: "Tuesday",
      label: "Run the instrument",
      detail: commandMove?.source ?? "COS Navigator",
    },
    {
      day: "Wednesday",
      label: "Assign the owner",
      detail: ownerMove?.owner ?? "Put one name on it",
    },
    {
      day: "Thursday",
      label: "Pressure-test it",
      detail: "Bring one issue to the room",
    },
    {
      day: "Friday",
      label: "Record the win",
      detail: "Close the loop in Vault",
    },
  ];

  return (
    <section className="relative px-4 pb-8 pt-10 sm:px-6 sm:pb-10 sm:pt-14">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="grid gap-6 border-b border-border pb-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)] lg:items-start">
          <div className="max-w-[760px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="h-8 w-[3px] rounded-full bg-signal" aria-hidden="true" />
              <p className="label-mono">Daily brief · {today || "Today"}</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {companyName}
              </span>
            </div>

            <p className="mt-7 text-[14px] text-muted-foreground">
              {greeting}, {firstName}.
              {greetingIcon ? (
                <GreetingIcon
                  iconKey={greetingIcon}
                  className="ml-2 inline-block align-middle text-xl"
                />
              ) : null}
            </p>
            <h1 className="mt-3 max-w-[720px] font-display text-[2.8rem] leading-[0.98] tracking-[-0.035em] sm:text-[4.35rem]">
              The company is moving.{" "}
              {moveCount === 1 ? "One commitment is" : `${moveCount} commitments are`} waiting on a
              move.
            </h1>
            <p className="mt-5 max-w-[650px] text-[15px] leading-relaxed text-muted-foreground sm:text-[16px]">
              {aosLinked
                ? "Your AOS operating read and Contractor Circle signals are together here. Choose the move that removes the most drag, then put an owner and a deadline on it."
                : "This read comes from your Contractor Circle tools and Vault. Connect AOS below to add the company operating view without replacing the work already here."}
            </p>
          </div>

          {featuredTraining ? <FeaturedTrainingCard training={featuredTraining} /> : null}
        </div>

        <div className="grid border-b border-border sm:grid-cols-5">
          {week.map((step, index) => {
            const isToday =
              activeDay >= 1 && activeDay <= 5 ? activeDay === index + 1 : index === 0;
            return (
              <div
                key={step.day}
                className={`relative min-w-0 border-border px-3 py-4 sm:border-r sm:last:border-r-0 ${isToday ? "bg-card" : ""}`}
              >
                {isToday ? <span className="absolute inset-x-0 top-0 h-0.5 bg-signal" /> : null}
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                  {step.day}
                </p>
                <p className="mt-2 text-[12px] font-semibold text-foreground">{step.label}</p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Map className="h-3.5 w-3.5 text-foreground" />
            <span>Contractor OS path</span>
            <span aria-hidden="true">·</span>
            <span>Every finding lands in your Vault.</span>
          </div>
          <div className="flex gap-4">
            <Link
              to="/operating-playbook"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              Open path <ArrowRight className="h-3 w-3" />
            </Link>
            <Link
              to="/tools"
              search={{ t: "cos-navigator" } as never}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              Navigator <RouteIcon className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturedTrainingCard({ training }: { training: ReplayWithResources }) {
  const [busyResourceId, setBusyResourceId] = useState<string | null>(null);
  const resources = training.resources.filter((resource) => resource.template.download_url);
  const isGoogleDrivePreview = isGoogleDrivePreviewUrl(training.video_url);

  async function openResource(resource: ReplayWithResources["resources"][number]) {
    setBusyResourceId(resource.id);
    const url = await openTemplateFile(resource.template.download_url);
    setBusyResourceId(null);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <article className="overflow-hidden rounded-xl border border-ink/15 bg-ink shadow-[0_18px_50px_-38px_color-mix(in_oklab,var(--ink)_55%,transparent)]">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-clay">
            <span
              className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-clay"
              aria-hidden="true"
            />
            New training · Contractor Circle
            {training.duration_minutes ? ` · ${training.duration_minutes} min` : ""}
          </p>
          <h2 className="mt-1 font-display text-[20px] leading-tight text-cream">
            {training.title}
          </h2>
        </div>
        {training.share_url ? (
          <a
            href={training.share_url}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-cream/15 text-cream/70 hover:bg-cream/10 hover:text-cream"
            aria-label={`Open ${training.title} in a new tab`}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      {training.video_url ? (
        <div
          className={
            isGoogleDrivePreview
              ? "relative aspect-[4/3] overflow-hidden bg-black"
              : "relative h-0 overflow-hidden bg-black pb-[53.7927%]"
          }
        >
          <iframe
            src={training.video_url}
            title={`${training.title} — Contractor Circle training`}
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            loading="lazy"
            className="absolute inset-0 block h-full w-full border-0"
          />
        </div>
      ) : null}
      {resources.length > 0 ? (
        <div className="grid gap-1.5 border-t border-cream/10 p-2 sm:grid-cols-2">
          {resources.map((resource) => {
            const label = resource.template.title.includes("Field Guide")
              ? "Field Guide"
              : resource.template.title.includes("Deck")
                ? "Teaching Deck"
                : resource.template.title;
            return (
              <button
                key={resource.id}
                type="button"
                onClick={() => void openResource(resource)}
                disabled={busyResourceId === resource.id}
                className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-md border border-cream/15 px-2.5 py-2 text-[10px] font-medium text-cream/80 hover:bg-cream/10 hover:text-cream disabled:opacity-50"
              >
                <Download className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {busyResourceId === resource.id ? "Opening…" : label}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
