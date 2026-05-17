import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Container } from "@/components/portal/page-header";
import { ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/field-tools")({
  head: () => ({ meta: [{ title: "Field Tools — ALP Contractor Circle" }] }),
  component: FieldToolsPage,
});

const TOOLS = [
  { name: "ConstructLine Hub", tagline: "Run the pursuit.", body: "Lead intake, qualification, and pursuit tracking for the projects worth chasing.", href: "#" },
  { name: "Basis", tagline: "Quantify the work.", body: "Takeoff and quantification with memory across projects.", href: "#" },
  { name: "Baseline", tagline: "Plan the work.", body: "Scheduling and sequencing for the projects actually entering the field.", href: "#" },
  { name: "Cost Library", tagline: "Price with memory.", body: "Historical cost data so estimates aren't guesses.", href: "#" },
  { name: "Trade Rate Library", tagline: "Know the labor.", body: "Trade rates and labor assumptions across markets.", href: "#" },
];

function FieldToolsPage() {
  return (
    <Container>
      <PageHeader
        eyebrow="Field tools"
        title={<>Support tools for pursuit,<br/>takeoff, and pricing.</>}
        lede="These tools support the work when the issue in front of you is pursuit, estimate, schedule, pricing, or labor assumptions. They live alongside the portal — they don't replace the operating system."
      />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <a key={t.name} href={t.href} target="_blank" rel="noreferrer" className="group rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]">
            <div className="flex items-start justify-between">
              <div>
                <p className="label-mono">{t.tagline}</p>
                <h3 className="mt-2 font-display text-xl">{t.name}</h3>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
            <p className="mt-4 text-sm text-muted-foreground">{t.body}</p>
          </a>
        ))}
      </div>
    </Container>
  );
}
