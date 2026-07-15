import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Compass,
  Download,
  Eye,
  FileText,
  Gauge,
  Lock,
  MessageSquare,
  PlayCircle,
  Users,
  Video,
} from "lucide-react";
import { Container, PageHeader } from "@/components/portal/page-header";
import { DISCORD_URL } from "@/lib/program";
import { markControlProgress } from "@/lib/control-progress";
import { useTier } from "@/hooks/use-tier";
import { startHereExperience } from "@/lib/start-here-access";

const LOOM_EMBED_URL = "https://www.loom.com/embed/440cd1dfa22c4f87b6f6df2c950f6ee5";
const CONTROL_LOOP_IMAGE_URL = "/images/professional-contractor-control-loop.png";
const CONTROL_LOOP_PDF_URL = "/downloads/professional-contractor-control-loop.pdf";

export const Route = createFileRoute("/start-here")({
  head: () => ({
    meta: [
      { title: "Start Here - ALP Contractor Circle" },
      {
        name: "description",
        content:
          "Professional contractor orientation connecting the ALP Handbook, AOS, IOR, field discipline, and Contractor Circle.",
      },
    ],
  }),
  component: StartHerePage,
});

function StartHerePage() {
  const { tier, loading: tierLoading } = useTier();
  const isCircleExperience = startHereExperience(tier) === "circle";
  const isBookBuyer = tier === "book_buyer";

  useEffect(() => {
    void markControlProgress({ orientation_opened_at: new Date().toISOString() });
  }, []);

  if (tierLoading) {
    return (
      <Container>
        <section
          aria-label="Loading your orientation"
          className="mt-8 animate-pulse rounded-3xl border border-border bg-card p-7 sm:p-10"
        >
          <div className="h-3 w-48 rounded bg-muted" />
          <div className="mt-6 h-12 max-w-xl rounded bg-muted" />
          <div className="mt-4 h-16 max-w-3xl rounded bg-muted" />
          <div className="mt-10 aspect-video w-full rounded-2xl bg-ink/10" />
        </section>
      </Container>
    );
  }

  return (
    <Container>
      <PageHeader
        eyebrow={
          isCircleExperience
            ? "Member orientation / Start here"
            : "Professional contractor orientation / Start here"
        }
        title={
          isCircleExperience ? (
            <>Welcome to Contractor Circle.</>
          ) : (
            <>Start with the control loop.</>
          )
        }
        lede={
          isCircleExperience
            ? "Watch this first. It explains how the community, the teaching, AOS, OverWatch, and the work happening in the field operate as one professional contracting system."
            : "Watch this first. It connects the ALP Handbook, AOS, IOR, and daily field discipline into one professional contracting system you can begin installing now."
        }
        actions={
          isCircleExperience ? (
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[13px] font-medium text-cream hover:opacity-90"
            >
              Join Discord <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
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

      <section className="mt-10 overflow-hidden rounded-3xl bg-ink text-cream shadow-[var(--shadow-focus)]">
        <div className="border-b border-cream/10 px-6 py-5 sm:px-8">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-cream/60">
            <PlayCircle className="h-3.5 w-3.5 text-signal" />
            Your orientation
          </p>
          <h2 className="mt-2 font-display text-2xl text-cream sm:text-[2rem]">
            The Professional Contractor Control Loop
          </h2>
          <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-cream/70">
            Marshall walks through the company, project, and field disciplines that let a contractor
            see risk early, act while the outcome can still change, and scale without losing
            control.
          </p>
        </div>

        <div className="aspect-video w-full bg-black">
          <iframe
            src={LOOM_EMBED_URL}
            title="Contractor Circle orientation - The Professional Contractor Control Loop"
            className="h-full w-full"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
          />
        </div>
      </section>

      <section className="mt-16 grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.75fr)] lg:items-start">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="label-mono">The operating model</p>
              <h2 className="mt-2 font-display text-3xl leading-tight">
                One system. Three levels of control.
              </h2>
            </div>
            <a
              href={CONTROL_LOOP_PDF_URL}
              download
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-[13px] font-medium hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" /> Download the one-pager
            </a>
          </div>

          <a
            href={CONTROL_LOOP_PDF_URL}
            target="_blank"
            rel="noreferrer"
            className="group mt-6 block overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]"
          >
            <img
              src={CONTROL_LOOP_IMAGE_URL}
              alt="The Professional Contractor Control Loop showing AOS at the company level, OverWatch and IOR at the project level, and Daily Logs plus Daily Project WIP at the field level."
              className="h-auto w-full transition-transform duration-300 group-hover:scale-[1.005]"
              loading="lazy"
            />
          </a>
        </div>

        <aside className="rounded-2xl border border-border bg-card p-6 sm:p-7">
          <p className="label-mono">What to understand</p>
          <div className="mt-6 space-y-6">
            <ControlLevel
              number="01"
              title="AOS runs the company."
              body="Direction, accountability, scorecards, issues, priorities, and execution."
            />
            <ControlLevel
              number="02"
              title="OverWatch controls the projects."
              body="IOR turns schedule, billing, cost, and risk into a current indicated outcome."
            />
            <ControlLevel
              number="03"
              title="Field truth starts daily."
              body="Daily Logs and Daily Project WIP show what was installed, earned, and spent."
            />
          </div>
          <p className="mt-7 border-t border-border pt-5 font-display text-xl leading-snug">
            Month-end should confirm the trend - not reveal it.
          </p>
        </aside>
      </section>

      <section className="mt-16 grid gap-6 rounded-3xl border border-border bg-card p-7 shadow-[var(--shadow-soft)] sm:p-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="max-w-3xl">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-clay">
            <Gauge className="h-3.5 w-3.5" /> Your operating baseline
          </p>
          <h2 className="mt-3 font-display text-3xl leading-tight sm:text-4xl">
            Get your State of Control.
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            Assess company control through AOS, project control through IOR, and field control
            through Daily Logs and Daily Project WIP. You will leave with the active constraint and
            a focused 90-day implementation route.
          </p>
        </div>
        <Link
          to="/tools/cos-navigator"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-signal px-5 py-3 text-[13px] font-semibold text-ink hover:opacity-90"
        >
          Run the assessment <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </section>

      <section className="mt-16 border-t border-border pt-12">
        <div className="max-w-3xl">
          <p className="label-mono">Your first moves</p>
          <h2 className="mt-2 font-display text-3xl">
            {isCircleExperience ? "Do these four things next." : "Put the system to work."}
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            {isCircleExperience
              ? "Contractor Circle becomes more valuable when you participate. Get connected, catch up, and bring the real issues from your company into the room."
              : "Use the doctrine, establish the baseline, and begin running the company and projects through the connected applications."}
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {isCircleExperience ? (
            <>
              <FirstMove
                icon={<MessageSquare className="h-4 w-4" />}
                step="01"
                title="Join Discord"
                body="Introduce yourself and use the daily conversations, guidance, and shared experience."
                href={DISCORD_URL}
                external
              />
              <FirstMove
                icon={<Video className="h-4 w-4" />}
                step="02"
                title="Catch the replays"
                body="Review the recent calls so the language, lessons, and current conversations are familiar."
                href="/replays"
              />
              <FirstMove
                icon={<CalendarDays className="h-4 w-4" />}
                step="03"
                title="Make the calls"
                body="Put the live sessions on your calendar and bring one specific issue that needs pressure."
                href="/calls"
              />
              <FirstMove
                icon={<FileText className="h-4 w-4" />}
                step="04"
                title="Use the resources"
                body="Open the playbook and templates when you are ready to install the method in your company."
                href="/operating-playbook"
              />
            </>
          ) : (
            <>
              <FirstMove
                icon={<BookOpen className="h-4 w-4" />}
                step="01"
                title="Read the Handbook"
                body="Use the field manual to understand the doctrine behind the operating system."
                href="/handbook"
              />
              <FirstMove
                icon={<Gauge className="h-4 w-4" />}
                step="02"
                title="Get your State of Control"
                body="Find the active constraint and build the first focused 90-day implementation route."
                href="/tools/cos-navigator"
              />
              <FirstMove
                icon={<Compass className="h-4 w-4" />}
                step="03"
                title="Open AOS"
                body="Turn company direction, accountability, scorecards, issues, and execution into rhythm."
                href="/aos"
              />
              <FirstMove
                icon={<Eye className="h-4 w-4" />}
                step="04"
                title={isBookBuyer ? "Open OverWatch Free" : "Open OverWatch"}
                body={
                  isBookBuyer
                    ? "Handbook buyers can use OverWatch Free to manage one real project through forecast, schedule, billing, cost, and risk."
                    : "Manage project forecast, schedule, billing, cost, and risk while the outcome can change."
                }
                href="/overwatch"
              />
            </>
          )}
        </div>
      </section>

      {!isCircleExperience && (
        <section className="mt-16 overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
            <div className="bg-[var(--paper-deep)] p-7 sm:p-9">
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-clay">
                <Users className="h-3.5 w-3.5" /> Contractor Circle
              </p>
              <h2 className="mt-4 font-display text-3xl leading-tight">
                See the implementation layer before you join it.
              </h2>
              <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
                Your Handbook, State of Control, AOS, OverWatch Free, and included tools stay
                available. Contractor Circle adds the room, the teaching archive, and the working
                assets that help install the system faster.
              </p>
              <Link
                to="/ecosystem"
                className="mt-7 inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-[13px] font-medium hover:bg-muted"
              >
                Map the ALP ecosystem <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7">
              <LockedCircleCard
                icon={<CalendarDays className="h-4 w-4" />}
                title="Live calls + bootcamps"
                body="Bring the real issue into the room and pressure-test the next move."
                href="/calls"
              />
              <LockedCircleCard
                icon={<MessageSquare className="h-4 w-4" />}
                title="Private community"
                body="Stay in the daily operator conversations between working sessions."
                href="/community"
              />
              <LockedCircleCard
                icon={<Video className="h-4 w-4" />}
                title="Replay archive"
                body="Return to the teaching when the company is ready to install it."
                href="/replays"
              />
              <LockedCircleCard
                icon={<FileText className="h-4 w-4" />}
                title="Templates + Contractor OS"
                body="Use the working files and complete implementation playbook."
                href="/templates"
              />
            </div>
          </div>
        </section>
      )}

      <section className="mt-16 flex flex-col gap-6 rounded-3xl bg-ink px-7 py-8 text-cream sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:py-10">
        <div className="max-w-2xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
            {isCircleExperience ? "The standard" : "Your next level"}
          </p>
          <h2 className="mt-3 font-display text-2xl text-cream sm:text-3xl">
            {isCircleExperience
              ? "Teach top-down. Install bottom-up. Run it as one loop."
              : "Use the system now. Join the room when you want pressure."}
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-cream/70">
            {isCircleExperience
              ? "The ALP Handbook teaches the doctrine. Contractor Circle installs it. AOS runs the company. OverWatch controls the projects."
              : "The ALP Handbook teaches the doctrine. AOS runs the company. IOR controls the projects. Contractor Circle adds the calls, community, and direct pressure to install it faster."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-auto">
          {!isCircleExperience && (
            <Link
              to="/ecosystem"
              className="inline-flex items-center gap-2 rounded-md border border-cream/25 px-5 py-3 text-[13px] font-medium text-cream hover:bg-cream/10"
            >
              See the ecosystem
            </Link>
          )}
          <Link
            to={isCircleExperience ? "/operating-playbook" : "/upgrade"}
            className="inline-flex items-center gap-2 rounded-md bg-cream px-5 py-3 text-[13px] font-medium text-ink hover:opacity-90"
          >
            {isCircleExperience ? "Open the operating playbook" : "Explore Contractor Circle"}{" "}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>
    </Container>
  );
}

function ControlLevel({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="grid grid-cols-[2rem_1fr] gap-3">
      <span className="font-mono text-[10px] font-medium text-clay">{number}</span>
      <div>
        <h3 className="text-[14px] font-medium">{title}</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

type FirstMoveProps = {
  icon: ReactNode;
  step: string;
  title: string;
  body: string;
  href: string;
  external?: boolean;
};

function FirstMove({ icon, step, title, body, href, external = false }: FirstMoveProps) {
  const content = (
    <>
      <div className="flex items-center justify-between text-clay">
        {icon}
        <span className="font-mono text-[10px] font-medium">{step}</span>
      </div>
      <h3 className="mt-8 font-display text-xl">{title}</h3>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      <span className="mt-6 inline-flex items-center gap-1.5 text-[12px] font-medium">
        Open <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </>
  );

  const className =
    "group flex min-h-[250px] flex-col rounded-2xl border border-border bg-card p-6 hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-[var(--shadow-soft)]";

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link to={href} className={className}>
      {content}
    </Link>
  );
}

function LockedCircleCard({
  icon,
  title,
  body,
  href,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  href: "/calls" | "/community" | "/replays" | "/templates";
}) {
  return (
    <Link
      to={href}
      className="group relative min-h-[190px] overflow-hidden rounded-2xl border border-border bg-[var(--paper-deep)] p-5 transition hover:border-foreground/25 hover:shadow-[var(--shadow-soft)]"
    >
      <div className="absolute -right-5 -top-5 h-20 w-20 rounded-full bg-clay/8 blur-2xl" />
      <div className="relative flex items-center justify-between text-clay">
        {icon}
        <Lock className="h-3.5 w-3.5" />
      </div>
      <p className="relative mt-7 font-mono text-[8px] uppercase tracking-[0.2em] text-clay">
        Available to Contractor Circle members
      </p>
      <h3 className="relative mt-2 font-display text-xl">{title}</h3>
      <p className="relative mt-2 text-[12px] leading-relaxed text-muted-foreground">{body}</p>
    </Link>
  );
}
