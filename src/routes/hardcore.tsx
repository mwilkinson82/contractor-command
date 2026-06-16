import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Container } from "@/components/portal/page-header";

export const Route = createFileRoute("/hardcore")({
  head: () => ({
    meta: [
      { title: "Hardcore — ALP Contractor Circle" },
      { name: "description", content: "Hardcore class materials are not housed inside the Contractor Circle hub." },
    ],
  }),
  component: HardcorePage,
});

function HardcorePage() {
  return (
    <Container>
      <section className="max-w-2xl py-14">
        <p className="label-mono">Outside this hub</p>
        <h1 className="mt-4 font-display text-4xl leading-tight text-foreground md:text-5xl">
          Hardcore class materials are not housed here.
        </h1>
        <p className="mt-5 text-sm leading-6 text-muted-foreground">
          This Contractor Circle portal includes the Circle hub, Vault, calls, replays, AOS,
          tools, Ask Marshall, templates, and community access. Hardcore recorded classes are
          managed separately and are not part of this hub.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-cream transition-opacity hover:opacity-90"
          >
            Back to hub
          </Link>
          <Link
            to="/replays"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Circle replays
          </Link>
        </div>
      </section>
    </Container>
  );
}
