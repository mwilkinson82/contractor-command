import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Container } from "@/components/portal/page-header";

export const Route = createFileRoute("/calls")({
  head: () => ({
    meta: [{ title: "Call Library — ALP Contractor Circle" }],
  }),
  component: CallsPage,
});

type Replay = {
  title: string;
  date: string;
  kind: "Contractor Circle" | "Bootcamp";
  tags: string[];
  description: string;
  usefulFor: string;
  relatedAos: string;
  status: "available" | "pending";
};

const REPLAYS: Replay[] = [
  {
    title: "Owner dependency: where the business still leans on you",
    date: "May 15, 2026",
    kind: "Contractor Circle",
    tags: ["Owner dependency", "Process", "PM leadership"],
    description: "Working through three real members' org charts and finding the seat the owner is silently filling.",
    usefulFor: "Members preparing to install their first PM scorecard or accountability chart.",
    relatedAos: "Accountability Chart + Process",
    status: "available",
  },
  {
    title: "Bootcamp: estimate throughput in a slow market",
    date: "May 2, 2026",
    kind: "Bootcamp",
    tags: ["Estimating", "Scorecard", "Pursuit"],
    description: "Pressure-testing estimate volume vs. close rate when leads are thinner than usual.",
    usefulFor: "Owners whose pipeline looks fine but signed contracts are flat.",
    relatedAos: "Scorecard + Process",
    status: "available",
  },
  {
    title: "Cash control: billing rhythm and collections discipline",
    date: "April 18, 2026",
    kind: "Contractor Circle",
    tags: ["Cash", "Billing", "Collections"],
    description: "Replay link pending. Notes available in the Vault.",
    usefulFor: "Members feeling cash tightness even when projects are profitable.",
    relatedAos: "Numbers + Process",
    status: "pending",
  },
];

function CallsPage() {
  return (
    <Container>
      <PageHeader
        eyebrow="Archived judgment"
        title={<>Replays built for<br/>bid-room judgment.</>}
        lede="Every Contractor Circle session and bootcamp, organized by what it's actually useful for. Not a video library — a working archive."
      />
      <div className="mt-10 grid gap-4">
        {REPLAYS.map((r) => (
          <article key={r.title} className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-soft)] sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <p className="label-mono">{r.kind} · {r.date}</p>
                <h3 className="mt-2 font-display text-2xl leading-snug">{r.title}</h3>
                <p className="mt-3 text-sm text-muted-foreground">{r.description}</p>
              </div>
              {r.status === "available" ? (
                <button className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm text-cream hover:opacity-90">
                  Watch replay
                </button>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                  Replay link pending
                </span>
              )}
            </div>
            <dl className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
              <div>
                <dt className="label-mono">Useful for</dt>
                <dd className="mt-1 text-sm">{r.usefulFor}</dd>
              </div>
              <div>
                <dt className="label-mono">Related AOS area</dt>
                <dd className="mt-1 text-sm">{r.relatedAos}</dd>
              </div>
              <div>
                <dt className="label-mono">Tags</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {r.tags.map((t) => (
                    <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t}</span>
                  ))}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </Container>
  );
}
