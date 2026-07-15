import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  Compass,
  Lock,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Container, PageHeader } from "@/components/portal/page-header";
import { tierAtLeast, useTier } from "@/hooks/use-tier";

export const Route = createFileRoute("/ecosystem")({
  head: () => ({
    meta: [
      { title: "The ALP Ecosystem — Contractor Circle" },
      {
        name: "description",
        content:
          "The complete ALP path from the Handbook and free applications to Contractor Circle implementation and private advisory work.",
      },
    ],
  }),
  component: EcosystemPage,
});

function EcosystemPage() {
  const { tier, loading } = useTier();
  const hasHandbook = !loading && tierAtLeast(tier, "book_buyer");
  const hasCircle = !loading && tierAtLeast(tier, "circle");
  const isHardcore = tier === "hardcore";

  return (
    <Container>
      <PageHeader
        eyebrow="The ALP ecosystem"
        title={<>Learn it. Run it. Install it.</>}
        lede="One professional contracting system with multiple ways in. Start with the doctrine, put the applications into the company, then add the room and direct pressure when you are ready to implement faster."
        actions={
          hasCircle ? (
            <Link
              to="/start-here"
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[13px] font-medium text-cream hover:opacity-90"
            >
              Open Start Here <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <Link
              to="/upgrade"
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[13px] font-medium text-cream hover:opacity-90"
            >
              Explore Contractor Circle <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )
        }
      />

      <section className="mt-10 overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="grid lg:grid-cols-[0.72fr_1fr_1.15fr_0.78fr]">
          <EcosystemStage
            number="01"
            icon={<BookOpen className="h-4 w-4" />}
            eyebrow="Learn"
            title="The ALP Handbook"
            description="The doctrine and field manual for building the company behind the projects."
            access={hasHandbook ? "Included in your access" : "$47 · updates included"}
            active={hasHandbook}
          />
          <EcosystemStage
            number="02"
            icon={<Compass className="h-4 w-4" />}
            eyebrow="Run"
            title="AOS + OverWatch"
            description="AOS runs the company. OverWatch runs IOR, project control, and Daily Project WIP."
            access={
              hasCircle
                ? "Full application tiers included"
                : hasHandbook
                  ? "Free application tiers included"
                  : "Start with the Handbook"
            }
            active={hasHandbook || tier === "aos_only"}
          />
          <EcosystemStage
            number="03"
            icon={<Users className="h-4 w-4" />}
            eyebrow="Install"
            title="Contractor Circle"
            description="The calls, community, replays, templates, and direct pressure that turn the system into operating practice."
            access={hasCircle ? "Your membership" : "$497 / month"}
            active={hasCircle}
            featured
          />
          <EcosystemStage
            number="04"
            icon={<Sparkles className="h-4 w-4" />}
            eyebrow="Intensify"
            title="Hardcore + private"
            description="Daily rooms, specialized schools, and private sessions for the hardest inflection points."
            access={isHardcore ? "Your level" : "Available separately"}
            active={isHardcore}
          />
        </div>
      </section>

      <section className="mt-16 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-3xl bg-ink p-7 text-cream sm:p-9">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
            The control loop
          </p>
          <h2 className="mt-4 font-display text-3xl leading-tight text-cream">
            The products are different doors into one operating system.
          </h2>
          <div className="mt-8 space-y-6">
            <ControlRow
              icon={<Building2 className="h-4 w-4" />}
              title="Company control"
              body="AOS turns direction, ownership, scorecards, issues, and execution into weekly rhythm."
            />
            <ControlRow
              icon={<ShieldCheck className="h-4 w-4" />}
              title="Project control"
              body="OverWatch turns forecast, schedule, billing, cost, and risk into an indicated outcome."
            />
            <ControlRow
              icon={<Check className="h-4 w-4" />}
              title="Field truth"
              body="Daily Logs and Daily Project WIP show what was installed, earned, and spent while the outcome can still change."
            />
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card p-7 sm:p-9">
          <p className="label-mono">What Contractor Circle adds</p>
          <h2 className="mt-3 font-display text-3xl leading-tight">
            The implementation layer around the applications.
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            The Handbook teaches the standard and the applications hold the work. Contractor Circle
            adds the cadence, context, working assets, and accountability that help the company
            install it.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              "Bi-weekly calls and bootcamps",
              "Private operator community",
              "Complete replay archive",
              "Templates and implementation files",
              "Ask Marshall and live issue pressure",
              "Unlimited AOS + OverWatch Pro",
            ].map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-xl bg-muted/45 p-4">
                {hasCircle ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
                ) : (
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-clay" />
                )}
                <span className="text-[13px] leading-relaxed text-foreground/78">{item}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3 border-t border-border pt-6">
            {hasCircle ? (
              <>
                <Link
                  to="/calls"
                  className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[13px] font-medium text-cream hover:opacity-90"
                >
                  Open the member room <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  to="/operating-playbook"
                  className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2.5 text-[13px] font-medium hover:bg-muted"
                >
                  Open Contractor OS
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/upgrade"
                  className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2.5 text-[13px] font-semibold text-ink hover:opacity-90"
                >
                  See membership options <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  to="/start-here"
                  className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2.5 text-[13px] font-medium hover:bg-muted"
                >
                  Use what I have now
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="mt-16 rounded-3xl border border-border bg-[var(--paper-deep)] p-7 sm:p-9">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:items-center">
          <div>
            <p className="label-mono">Choose the depth you need</p>
            <h2 className="mt-3 font-display text-3xl leading-tight">
              Start where confidence is high enough to move.
            </h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelfSelect
              title="I need the method"
              body="Start with the $47 ALP Handbook and keep every future update."
              href="https://alphandbook.com"
              external
            />
            <SelfSelect
              title="I need the system"
              body="Use AOS and OverWatch to put company and project control into practice."
              to="/start-here"
            />
            <SelfSelect
              title="I need implementation"
              body="Join Contractor Circle for the room, the assets, and direct pressure."
              to="/upgrade"
            />
          </div>
        </div>
      </section>
    </Container>
  );
}

function EcosystemStage({
  number,
  icon,
  eyebrow,
  title,
  description,
  access,
  active,
  featured = false,
}: {
  number: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  access: string;
  active: boolean;
  featured?: boolean;
}) {
  return (
    <article
      className={`relative flex min-h-[330px] flex-col border-b border-border p-6 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0 ${
        featured ? "bg-ink text-cream" : "bg-card"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={featured ? "text-signal" : "text-clay"}>{icon}</span>
        <span
          className={`font-mono text-[10px] ${featured ? "text-cream/45" : "text-muted-foreground"}`}
        >
          {number}
        </span>
      </div>
      <p
        className={`mt-8 font-mono text-[9px] uppercase tracking-[0.24em] ${featured ? "text-signal" : "text-clay"}`}
      >
        {eyebrow}
      </p>
      <h2 className={`mt-3 font-display text-2xl leading-tight ${featured ? "text-cream" : ""}`}>
        {title}
      </h2>
      <p
        className={`mt-3 text-[13px] leading-relaxed ${featured ? "text-cream/65" : "text-muted-foreground"}`}
      >
        {description}
      </p>
      <div className="mt-auto pt-7">
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em] ${
            active
              ? featured
                ? "border-good/35 bg-good/12 text-good"
                : "border-good/25 bg-good/8 text-good"
              : featured
                ? "border-cream/15 text-cream/55"
                : "border-border text-muted-foreground"
          }`}
        >
          {active ? <Check className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          {access}
        </span>
      </div>
    </article>
  );
}

function ControlRow({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="grid grid-cols-[2rem_1fr] gap-3 border-t border-cream/12 pt-5 first:border-t-0 first:pt-0">
      <span className="mt-0.5 text-signal">{icon}</span>
      <div>
        <h3 className="text-[14px] font-medium text-cream">{title}</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-cream/60">{body}</p>
      </div>
    </div>
  );
}

function SelfSelect({
  title,
  body,
  to,
  href,
  external = false,
}: {
  title: string;
  body: string;
  to?: "/start-here" | "/upgrade";
  href?: string;
  external?: boolean;
}) {
  const content = (
    <>
      <h3 className="font-display text-xl">{title}</h3>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{body}</p>
      <span className="mt-5 inline-flex items-center gap-1 text-[11px] font-medium text-clay">
        Explore <ArrowRight className="h-3 w-3" />
      </span>
    </>
  );
  const className =
    "flex min-h-[180px] flex-col rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-[var(--shadow-soft)]";

  if (external && href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link to={to ?? "/start-here"} className={className}>
      {content}
    </Link>
  );
}
