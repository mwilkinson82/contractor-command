import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Container } from "@/components/portal/page-header";

export const Route = createFileRoute("/templates")({
  head: () => ({ meta: [{ title: "Templates — ALP Contractor Circle" }] }),
  component: TemplatesPage,
});

const FEATURED = [
  { title: "ALP/EOS Operating System — Complete Playbook", problem: "Install the system the company runs on." },
  { title: "Command Center Blueprint", problem: "Stand up the owner's weekly operating cockpit." },
  { title: "V/TO — Vision / Traction Organizer", problem: "Make the vision concrete enough to run against." },
  { title: "Weekly Scorecard", problem: "Five to seven numbers that prove the engine is moving." },
  { title: "Owner Dependency Scorecard", problem: "Find where the business still leans on the owner." },
];

const GROUPS: { name: string; items: { title: string; problem: string }[] }[] = [
  {
    name: "Sell the work",
    items: [
      { title: "Qualified Lead Definition", problem: "Stop wasting estimating on the wrong opportunities." },
      { title: "Proposal Scorecard", problem: "Rate every proposal before it leaves." },
    ],
  },
  {
    name: "Estimate the work",
    items: [
      { title: "Estimate Throughput Tracker", problem: "Defend estimate volume every week." },
      { title: "Pricing Assumptions Sheet", problem: "Make pricing decisions traceable." },
    ],
  },
  {
    name: "Contract the work",
    items: [
      { title: "Contract Readiness Checklist", problem: "Don't sign until terms protect the business." },
      { title: "Change Order Playbook", problem: "Capture scope creep as revenue, not friction." },
    ],
  },
  {
    name: "Launch the work",
    items: [
      { title: "Project Launch Readiness", problem: "Don't start a project until the launch packet is complete." },
    ],
  },
  {
    name: "Manage the work",
    items: [
      { title: "PM Weekly Cadence", problem: "Make PM oversight a system, not a personality." },
      { title: "Client Decision Tracker", problem: "Stop letting client indecision delay the schedule." },
    ],
  },
  {
    name: "Bill and collect",
    items: [
      { title: "Billing Event Planner", problem: "Bill on time, every time." },
      { title: "Collections Cadence", problem: "Make the call before the receivable goes cold." },
    ],
  },
  {
    name: "Lead people",
    items: [
      { title: "Accountability Chart", problem: "Define the seats before you hire to them." },
      { title: "People Analyzer", problem: "Rate the seat objectively, not emotionally." },
    ],
  },
  {
    name: "Install systems",
    items: [
      { title: "SOP Priority Builder", problem: "Write the right SOPs first, not all of them at once." },
    ],
  },
];

function TemplatesPage() {
  return (
    <Container>
      <PageHeader
        eyebrow="Implementation assets"
        title={<>Templates that install<br/>the missing system.</>}
        lede="Every template here answers one question: what operating problem does this help solve? Organized by where it belongs in the business, not by file type."
      />

      <section className="mt-12">
        <p className="label-mono">Top prescribed path</p>
        <ol className="mt-4 grid gap-2">
          {FEATURED.map((t, i) => (
            <li key={t.title} className="flex items-center justify-between gap-6 rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-5">
                <span className="font-mono text-xs text-gold">0{i + 1}</span>
                <div>
                  <h3 className="font-display text-lg leading-tight">{t.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t.problem}</p>
                </div>
              </div>
              <button className="rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted">Open</button>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-16">
        <p className="label-mono">By operating problem</p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.name} className="rounded-2xl border border-border bg-card p-6">
              <h3 className="font-display text-lg">{g.name}</h3>
              <ul className="mt-4 space-y-3">
                {g.items.map((it) => (
                  <li key={it.title} className="flex items-start justify-between gap-4 border-t border-border pt-3 first:border-0 first:pt-0">
                    <div>
                      <p className="text-sm">{it.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{it.problem}</p>
                    </div>
                    <button className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted">Open</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </Container>
  );
}
