import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
import { vault, type Packet } from "@/lib/vault";
import { GridField } from "@/components/portal/grid-field";
import {
  ArrowUpRight,
  Calendar,
  Video,
  Compass,
  Wrench,
  Archive,
  MessagesSquare,
  FileText,
  Plus,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Command Center — ALP Contractor Circle" },
      { name: "description", content: "Mission control for your construction business." },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const session = nextAny();
  const latestReplay = REPLAYS[0];

  // Defer time-dependent strings to client mount to avoid SSR hydration mismatch.
  const [hello, setHello] = useState<string>("Welcome");
  const [today, setToday] = useState<string>("");
  const [sessionWhen, setSessionWhen] = useState<string>("");
  const [replayDate, setReplayDate] = useState<string>("");
  const [packets, setPackets] = useState<Packet[]>([]);

  useEffect(() => {
    setHello(greeting());
    setToday(
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      }),
    );
    setSessionWhen(formatSessionDate(session.date));
    setReplayDate(new Date(latestReplay.date).toLocaleDateString());
    const load = () => setPackets(vault.list());
    load();
    window.addEventListener("vault:changed", load);
    return () => window.removeEventListener("vault:changed", load);
  }, [session.date, latestReplay.date]);

  return (
    <div className="relative">
      {/* Hero band */}
      <section className="relative px-6 pt-10 pb-6 sm:pt-14">
        <GridField />
        <div className="relative mx-auto w-full max-w-[1180px]">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              · Workspace · {today || "\u00A0"}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              v3 · Command Center
            </p>
          </div>

          <h1 className="mt-6 font-display text-[2.5rem] leading-[1.02] tracking-tight sm:text-[3.5rem]">
            <span className="reveal-up inline-block">{hello},</span>{" "}
            <span className="reveal-up inline-block text-foreground/70" style={{ animationDelay: "120ms" }}>
              Marshall.
            </span>
          </h1>
          <p className="reveal-up mt-4 max-w-xl text-[15px] text-muted-foreground" style={{ animationDelay: "220ms" }}>
            One screen. One next move. Run the company from here.
          </p>

          {/* Action chips — ChatGPT-toolbar feel */}
          <div className="reveal-up mt-8 flex flex-wrap items-center gap-2" style={{ animationDelay: "320ms" }}>
            <Chip href={session.zoomUrl} external icon={<Video className="h-3.5 w-3.5" />} primary>
              Join Zoom
            </Chip>
            <Chip href={addToCalendarUrl(session)} external icon={<Calendar className="h-3.5 w-3.5" />}>
              Add to calendar
            </Chip>
            <Chip to="/calls" hash="submit-topic" icon={<Plus className="h-3.5 w-3.5" />}>
              Submit a topic
            </Chip>
            <span className="mx-1 h-4 w-px bg-border" />
            <Chip href={AOS_URL} external icon={<Compass className="h-3.5 w-3.5" />}>Open AOS</Chip>
            <Chip to="/tools/growth-constraint" icon={<Wrench className="h-3.5 w-3.5" />}>Run a tool</Chip>
            <Chip to="/vault" icon={<Archive className="h-3.5 w-3.5" />}>Vault</Chip>
          </div>
        </div>
      </section>

      {/* Live tiles */}
      <section className="relative px-6 pb-10">
        <div className="mx-auto grid w-full max-w-[1180px] gap-4 md:grid-cols-3">
          {/* Next session — ink panel */}
          <article className="relative overflow-hidden rounded-2xl bg-ink p-6 text-cream md:col-span-2 shadow-[var(--shadow-focus)]">
            <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(circle at 1px 1px, var(--cream) 1px, transparent 0)", backgroundSize: "22px 22px" }} />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cream/55">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal align-middle mr-2 animate-signal-pulse" />
                  Next session · {session.kind} · {relativeDay(session.date)}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cream/40">
                  {session.durationMin} min
                </p>
              </div>
              <h2 className="mt-5 font-display text-2xl leading-[1.15] text-cream sm:text-3xl">
                {session.title}
              </h2>
              <p className="mt-3 text-[13px] text-cream/65">{sessionWhen || "\u00A0"}</p>
              <p className="mt-4 max-w-prose text-[13px] leading-relaxed text-cream/75">
                {session.description}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <a
                  href={session.zoomUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-cream px-4 py-2 text-[13px] font-medium text-ink hover:opacity-90"
                >
                  Join Zoom <ArrowUpRight className="h-3 w-3" />
                </a>
                <a
                  href={addToCalendarUrl(session)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-cream/15 px-4 py-2 text-[13px] text-cream hover:bg-cream/5"
                >
                  Add to calendar
                </a>
                <Link
                  to="/calls"
                  hash="submit-topic"
                  className="rounded-md border border-cream/15 px-4 py-2 text-[13px] text-cream hover:bg-cream/5"
                >
                  Submit a topic
                </Link>
              </div>
            </div>
          </article>

          {/* Replay + Vault stacked */}
          <div className="grid gap-4">
            <Link
              to="/calls"
              className="group rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-foreground/5 text-foreground/80">
                  <Video className="h-3.5 w-3.5" />
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Latest replay
              </p>
              <h3 className="mt-1.5 font-display text-[15px] leading-snug">{latestReplay.title}</h3>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {latestReplay.kind} · {replayDate || "\u00A0"}
              </p>
            </Link>

            <Link
              to="/vault"
              className="group rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
            >
              <div className="flex items-center justify-between">
                <span className="grid h-7 w-7 place-items-center rounded-md bg-foreground/5 text-foreground/80">
                  <Archive className="h-3.5 w-3.5" />
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Your vault
              </p>
              <h3 className="mt-1.5 font-display text-[15px] leading-snug">
                {packets.length > 0
                  ? `${packets.length} ${packets.length === 1 ? "packet" : "packets"} saved`
                  : "Empty — run a tool to begin."}
              </h3>
              <p className="mt-2 truncate text-[11px] text-muted-foreground">
                {packets[0]?.title ?? "Growth Constraint Map · Owner Dependency"}
              </p>
            </Link>
          </div>
        </div>
      </section>

      {/* Secondary rows */}
      <section className="px-6 pb-16">
        <div className="mx-auto w-full max-w-[1180px] grid gap-3 md:grid-cols-3">
          <MiniRow to="/templates" icon={<FileText className="h-3.5 w-3.5" />} title="Templates" desc="Sell · Estimate · Contract · Launch · Bill" />
          <MiniRow to="/community" icon={<MessagesSquare className="h-3.5 w-3.5" />} title="The room" desc="Discord between sessions" extHref={DISCORD_URL} />
          <MiniRow to="/work-with-marshall" icon={<ArrowUpRight className="h-3.5 w-3.5" />} title="Intensive" desc="Six private sessions · $5,000" />
        </div>
      </section>
    </div>
  );
}

function Chip({
  to,
  href,
  external,
  hash,
  icon,
  children,
  primary,
}: {
  to?: string;
  href?: string;
  external?: boolean;
  hash?: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  primary?: boolean;
}) {
  const cls = primary
    ? "inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90"
    : "inline-flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-card hover:text-foreground backdrop-blur-sm";
  if (href && external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link to={to as "/"} hash={hash} className={cls}>
      {icon}
      {children}
    </Link>
  );
}

function MiniRow({
  to,
  extHref,
  icon,
  title,
  desc,
}: {
  to: string;
  extHref?: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50">
      <Link to={to as "/"} className="flex items-center gap-3 min-w-0 flex-1">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-foreground/5">{icon}</span>
        <div className="min-w-0">
          <p className="truncate font-display text-[13px]">{title}</p>
          <p className="truncate text-[11px] text-muted-foreground">{desc}</p>
        </div>
      </Link>
      {extHref ? (
        <a
          href={extHref}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
        >
          Open
        </a>
      ) : (
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      )}
    </div>
  );
}
