import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Container } from "@/components/portal/page-header";

export const Route = createFileRoute("/field-tools")({
  head: () => ({ meta: [{ title: "Field Tools — ALP Contractor Circle" }] }),
  component: FieldToolsPage,
});

function FieldToolsPage() {
  return (
    <Container>
      <PageHeader
        eyebrow="Field tools"
        title={<>In the shop.</>}
        lede="The pursuit, takeoff, and pricing tools are being rebuilt to match the rest of the portal. They'll come back online here once they're ready."
      />
      <div className="mt-10 rounded-2xl border border-border bg-card p-10 text-center">
        <p className="label-mono text-muted-foreground">Coming back soon</p>
        <p className="mt-3 text-sm text-muted-foreground">
          ConstructLine Hub, Basis, Baseline, Cost Library, and Trade Rate Library are temporarily hidden while we redesign them.
        </p>
      </div>
    </Container>
  );
}
