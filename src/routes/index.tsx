import { createFileRoute, Link } from "@tanstack/react-router";
import { AOS_URL } from "@/lib/vault";
import { Container } from "@/components/portal/page-header";
import { ArrowUpRight, Calendar, Video, Compass, MessageSquare } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ALP Contractor Circle — Command Center" },
      { name: "description", content: "Build the company behind the projects. Live guidance, AOS, templates, and owner tools for serious construction businesses." },
    ],
  }),
  component: HomePage,
});

// Demo session — wire to real schedule later.
const NEXT_SESSION = {
  kind: "Contractor Circle — Group Session",
  title: "Estimate throughput & weekly scorecard discipline",
  dateLabel: "Thursday, May 29 · 11:00 AM CT",
  zoomUrl: "https://zoom.us",
  duration: "90 min",
};

function HomePage() {
  return (
    <Container className="py-10 sm:py-14">
      {/* Hero */}
      <section className="grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="label-mono">Contractor Circle</p>
          <h1 className="mt-4 font-display text-[2.75rem] leading-[1.02] tracking-tight sm:text-6xl">
            Build the company<br/>behind the projects.
          </h1>
          <p className="mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-muted-foreground">
            Live guidance, AOS, templates, archived judgment, and owner tools to turn stuck decisions into structure.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/bring-one-issue"
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-medium text-cream transition-opacity hover:opacity-90"
            >
              Bring one issue <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link
              to="/tools/growth-constraint"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-3 text-sm font-medium hover:bg-muted"
            >
              Open Growth Constraint Map
            </Link>
          </div>
        </div>

        {/* Next session — charcoal focus panel */}
        <div className="lg:col-span-5">
          <div className="rounded-3xl bg-ink p-8 text-cream shadow-[var(--shadow-focus)]">
            <div className="flex items-center justify-between">
              <p className="label-mono !text-cream/60">Next session</p>
              <span className="rounded-full bg-cream/10 px-2.5 py-1 text-[10px] tracking-wider text-cream/80">LIVE WITH MARSHALL</span>
            </div>
            <p className="mt-5 text-xs text-cream/60">{NEXT_SESSION.kind}</p>
            <h2 className="mt-2 font-display text-2xl leading-snug text-cream">{NEXT_SESSION.title}</h2>
            <div className="mt-6 flex items-center gap-2 text-sm text-cream/80">
              <Calendar className="h-4 w-4" />
              <span>{NEXT_SESSION.dateLabel}</span>
              <span className="text-cream/30">·</span>
              <span>{NEXT_SESSION.duration}</span>
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              <a
                href={NEXT_SESSION.zoomUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-medium text-ink hover:opacity-90"
              >
                Join Zoom <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <button className="inline-flex items-center gap-2 rounded-lg border border-cream/15 px-4 py-2.5 text-sm text-cream hover:bg-cream/5">
                Add to calendar
              </button>
            </div>
            <p className="mt-8 border-t border-cream/10 pt-5 text-xs text-cream/55">
              Bring one specific issue. Make it small enough to pressure-test in the room.
            </p>
          </div>
        </div>
      </section>

      {/* Next useful moves */}
      <section className="mt-20">
        <p className="label-mono">Next moves</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NextMove
            to="/bring-one-issue"
            icon={<MessageSquare className="h-4 w-4" />}
            title="Bring One Issue"
            body="Pressure-test one real business issue before the next call."
          />
          <NextMove
            to="/tools/growth-constraint"
            icon={<Compass className="h-4 w-4" />}
            title="Growth Constraint Map"
            body="Find what is actually blocking your next revenue tier."
          />
          <NextMove
            href={AOS_URL}
            external
            icon={<ArrowUpRight className="h-4 w-4" />}
            title="Open AOS"
            body="Install the operating system. Carry your packets in."
          />
          <NextMove
            to="/calls"
            icon={<Video className="h-4 w-4" />}
            title="Latest replay"
            body="Owner dependency: where the business still leans on you."
          />
        </div>
      </section>

      {/* Operating pillars */}
      <section className="mt-20 grid gap-6 lg:grid-cols-3">
        <Pillar
          eyebrow="The room"
          title="Live guidance with Marshall."
          body="Biweekly Contractor Circle sessions and monthly bootcamps. Group judgment on the issues actually slowing your business."
          cta={{ to: "/calls", label: "Open call library" }}
        />
        <Pillar
          eyebrow="The system"
          title="AOS — the operating system."
          body="Vision, People, Numbers, Issues, Process, Traction. The structure the business runs on, not the projects."
          cta={{ href: AOS_URL, label: "Open AOS", external: true }}
        />
        <Pillar
          eyebrow="The tools"
          title="Command tools and templates."
          body="Owner-grade diagnostics that turn friction into a Command Packet. Templates that install the missing system."
          cta={{ to: "/templates", label: "Open templates" }}
        />
      </section>

      {/* Intensive — restrained */}
      <section className="mt-20 rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-soft)] sm:p-10">
        <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="max-w-2xl">
            <p className="label-mono">When the room is not enough</p>
            <h3 className="mt-3 font-display text-2xl sm:text-3xl">Six-Week Contractor Intensive.</h3>
            <p className="mt-3 text-muted-foreground">
              Six private sessions with Marshall to pressure-test the business, install the right priorities, and move faster with direct guidance. For members who need it — not for everyone.
            </p>
          </div>
          <Link
            to="/work-with-marshall"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-ink bg-card px-5 py-3 text-sm font-medium hover:bg-ink hover:text-cream"
          >
            Learn about the Intensive
          </Link>
        </div>
      </section>
    </Container>
  );
}

function NextMove({
  to,
  href,
  external,
  icon,
  title,
  body,
}: {
  to?: string;
  href?: string;
  external?: boolean;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  const className =
    "group flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]";
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-foreground/80">{icon}</span>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
      <h3 className="mt-6 font-display text-lg">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </>
  );
  if (external && href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={to!} className={className}>
      {inner}
    </Link>
  );
}

function Pillar({
  eyebrow,
  title,
  body,
  cta,
}: {
  eyebrow: string;
  title: string;
  body: string;
  cta: { to?: string; href?: string; label: string; external?: boolean };
}) {
  return (
    <div className="flex h-full flex-col rounded-3xl border border-border bg-card p-7">
      <p className="label-mono">{eyebrow}</p>
      <h3 className="mt-3 font-display text-2xl leading-snug">{title}</h3>
      <p className="mt-3 flex-1 text-sm text-muted-foreground">{body}</p>
      <div className="mt-6">
        {cta.external && cta.href ? (
          <a href={cta.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium hover:text-gold">
            {cta.label} <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        ) : (
          <Link to={cta.to!} className="inline-flex items-center gap-1.5 text-sm font-medium hover:text-gold">
            {cta.label} <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
