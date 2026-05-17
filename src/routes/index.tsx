import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AOS_URL,
  DISCORD_URL,
  REPLAYS,
  addToCalendarUrl,
  formatSessionDate,
  greeting,
  nextAny,
  relativeDay,
} from "@/lib/program";
import { ArrowUpRight, Calendar, MessagesSquare, Video, Compass, FileText } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Command Center — ALP Contractor Circle" },
      {
        name: "description",
        content:
          "Your command center: next session, topics, AOS, command tools, replays, and the room.",
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const session = nextAny();
  const latestReplay = REPLAYS[0];

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-10 sm:py-14">
      {/* Greeting strip */}
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="label-signal">· LIVE · Contractor Circle</p>
          <h1 className="mt-3 font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl">
            {greeting()}, Marshall.
          </h1>
          <p className="mt-3 max-w-xl text-base text-muted-foreground">
            One screen. One next move. Run the company from here.
          </p>
        </div>
        <p className="label-mono">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
      </div>

      {/* Next session — the centerpiece */}
      <section className="relative mt-10 overflow-hidden rounded-[2rem] bg-ink p-8 text-cream shadow-[var(--shadow-focus)] sm:p-12">
        <div className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, var(--cream) 1px, transparent 0)", backgroundSize: "24px 24px" }} />
        <div className="relative grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-signal" />
              <p className="label-mono !text-cream/60">Next session · {session.kind} · {relativeDay(session.date)}</p>
            </div>
            <h2 className="mt-5 font-display text-3xl leading-[1.1] text-cream sm:text-4xl">
              {session.title}
            </h2>
            <div className="mt-6 flex items-center gap-2 text-sm text-cream/70">
              <Calendar className="h-4 w-4" />
              <span>{formatSessionDate(session.date)}</span>
              <span className="text-cream/30">·</span>
              <span>{session.durationMin} min</span>
            </div>
            <div className="mt-7 flex flex-wrap gap-2">
              <a
                href={session.zoomUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-cream px-5 py-3 text-sm font-medium text-ink hover:opacity-90"
              >
                Join Zoom <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <a
                href={addToCalendarUrl(session)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-cream/15 px-5 py-3 text-sm text-cream hover:bg-cream/5"
              >
                Add to calendar
              </a>
              <Link
                to="/calls"
                hash="submit-topic"
                className="inline-flex items-center gap-2 rounded-lg border border-cream/15 px-5 py-3 text-sm text-cream hover:bg-cream/5"
              >
                Submit a topic
              </Link>
            </div>
          </div>

          <div className="border-t border-cream/10 pt-7 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
            <p className="label-mono !text-cream/55">The frame</p>
            <p className="mt-3 text-sm leading-relaxed text-cream/80">
              {session.description}
            </p>
            <p className="mt-5 text-xs text-cream/50">
              Bring one specific issue. Make it small enough to pressure-test in the room.
            </p>
          </div>
        </div>
      </section>

      {/* Quick rows — not cards */}
      <section className="mt-10 grid divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <QuickRow
          href={AOS_URL}
          external
          icon={<Compass className="h-4 w-4" />}
          label="Open AOS"
          desc="The operating system the business runs on."
        />
        <QuickRow
          to="/tools/growth-constraint"
          icon={<svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>}
          label="Run a command tool"
          desc="Growth Constraint Map · Owner Dependency Scorecard"
        />
      </section>

      {/* Three slim rows */}
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <SlimRow
          to="/calls"
          icon={<Video className="h-4 w-4" />}
          eyebrow="Latest replay"
          title={latestReplay.title}
          meta={`${latestReplay.kind} · ${new Date(latestReplay.date).toLocaleDateString()}`}
        />
        <SlimRow
          to="/templates"
          icon={<FileText className="h-4 w-4" />}
          eyebrow="Templates"
          title="Install the missing system."
          meta="Sell · Estimate · Contract · Launch · Manage · Bill"
        />
        <SlimRow
          to="/work-with-marshall"
          icon={<ArrowUpRight className="h-4 w-4" />}
          eyebrow="When the room is not enough"
          title="Six-Week Contractor Intensive."
          meta="Six private sessions · $5,000"
        />
      </section>

      {/* Community strip */}
      <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card px-6 py-5">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-cream">
            <MessagesSquare className="h-4 w-4" />
          </span>
          <div>
            <p className="label-mono">The room between sessions</p>
            <p className="mt-1 text-sm">
              Discord is where members post wins, debate pricing, and tee up issues for the call.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            to="/community"
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
          >
            How we use Discord
          </Link>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm text-cream hover:opacity-90"
          >
            Open Discord <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </section>
    </div>
  );
}

function QuickRow({
  to,
  href,
  external,
  icon,
  label,
  desc,
}: {
  to?: string;
  href?: string;
  external?: boolean;
  icon: React.ReactNode;
  label: string;
  desc: string;
}) {
  const cls =
    "group flex items-center justify-between gap-6 p-6 transition-colors hover:bg-muted/50";
  const inner = (
    <>
      <div className="flex items-center gap-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink text-cream">{icon}</span>
        <div>
          <p className="font-display text-base">{label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </>
  );
  return external && href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
  ) : (
    <Link to={to!} className={cls}>{inner}</Link>
  );
}

function SlimRow({
  to,
  icon,
  eyebrow,
  title,
  meta,
}: {
  to: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  meta: string;
}) {
  return (
    <Link
      to={to}
      className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
    >
      <div className="flex items-center justify-between">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-muted text-foreground/80">{icon}</span>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
      <p className="label-mono mt-5">{eyebrow}</p>
      <h3 className="mt-2 font-display text-base leading-snug">{title}</h3>
      <p className="mt-3 text-xs text-muted-foreground">{meta}</p>
    </Link>
  );
}
