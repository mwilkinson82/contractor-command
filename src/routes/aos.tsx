import { createFileRoute } from "@tanstack/react-router";
import { AOS_URL } from "@/lib/vault";
import { PageHeader, Container } from "@/components/portal/page-header";
import { ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/aos")({
  head: () => ({
    meta: [
      { title: "AOS — The ALP Operating System" },
      { name: "description", content: "Install the operating system before you scale the work." },
    ],
  }),
  component: AosPage,
});

const PARTS = [
  { name: "Vision", body: "Where the company is going and why that matters." },
  { name: "People", body: "The right seats and the right people in them." },
  { name: "Numbers", body: "Weekly metrics that prove the engine is moving." },
  { name: "Issues", body: "Surface them, prioritize them, solve them." },
  { name: "Process", body: "The way the work actually gets done — written down." },
  { name: "Traction", body: "Rocks, meeting rhythm, accountability over time." },
];

function AosPage() {
  return (
    <Container>
      <PageHeader
        eyebrow="The system"
        title={<>Install the operating system<br/>before you scale the work.</>}
        lede="AOS is the ALP Operating System — the structure the business runs on, not the projects. Vision, People, Numbers, Issues, Process, Traction. It lives in its own environment. The portal prepares the work; AOS carries it."
        actions={
          <a
            href={AOS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-medium text-cream hover:opacity-90"
          >
            Open AOS <ArrowUpRight className="h-4 w-4" />
          </a>
        }
      />

      <section className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PARTS.map((p, i) => (
          <div key={p.name} className="rounded-2xl border border-border bg-card p-6">
            <p className="label-mono">Part {String(i + 1).padStart(2, "0")}</p>
            <h3 className="mt-2 font-display text-xl">{p.name}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-16 rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-soft)] sm:p-10">
        <p className="label-mono">How the portal carries into AOS</p>
        <div className="mt-4 grid gap-6 sm:grid-cols-3">
          <Step n="1" title="Run a command tool or Bring One Issue." body="Get a specific finding with a recommended action." />
          <Step n="2" title="Save the Command Packet to the Vault." body="The packet names the constraint, the system, and the AOS area." />
          <Step n="3" title="Open AOS and carry the work in." body="Issue list, scorecard metric, process step, or rock — whatever it belongs to." />
        </div>
        <p className="mt-8 max-w-2xl text-sm text-muted-foreground">
          The portal does not write into AOS automatically. The judgment of what belongs where is yours. The packet makes that judgment fast.
        </p>
      </section>
    </Container>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <span className="font-mono text-xs text-gold">{n}</span>
      <h4 className="mt-1 font-display text-lg">{title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
