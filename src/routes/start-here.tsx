import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Download,
  FileText,
  MessageSquare,
  PlayCircle,
  Video,
} from "lucide-react";
import { Container, PageHeader } from "@/components/portal/page-header";
import { DISCORD_URL } from "@/lib/program";

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
          "Contractor Circle member orientation: the operating model, community, calls, replays, resources, AOS, and OverWatch.",
      },
    ],
  }),
  component: StartHerePage,
});

function StartHerePage() {
  return (
    <Container>
      <PageHeader
        eyebrow="Member orientation / Start here"
        title={<>Welcome to Contractor Circle.</>}
        lede="Watch this first. It explains how the community, the teaching, AOS, OverWatch, and the work happening in the field operate as one professional contracting system."
        actions={
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[13px] font-medium text-cream hover:opacity-90"
          >
            Join Discord <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
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

      <section className="mt-16 border-t border-border pt-12">
        <div className="max-w-3xl">
          <p className="label-mono">Your first moves</p>
          <h2 className="mt-2 font-display text-3xl">Do these four things next.</h2>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            Contractor Circle becomes more valuable when you participate. Get connected, catch up,
            and bring the real issues from your company into the room.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        </div>
      </section>

      <section className="mt-16 flex flex-col gap-6 rounded-3xl bg-ink px-7 py-8 text-cream sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:py-10">
        <div className="max-w-2xl">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
            The standard
          </p>
          <h2 className="mt-3 font-display text-2xl text-cream sm:text-3xl">
            Teach top-down. Install bottom-up. Run it as one loop.
          </h2>
          <p className="mt-3 text-[14px] leading-relaxed text-cream/70">
            The ALP Handbook teaches the doctrine. Contractor Circle installs it. AOS runs the
            company. OverWatch controls the projects.
          </p>
        </div>
        <Link
          to="/operating-playbook"
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-md bg-cream px-5 py-3 text-[13px] font-medium text-ink hover:opacity-90 sm:self-auto"
        >
          Open the operating playbook <ArrowRight className="h-3.5 w-3.5" />
        </Link>
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
