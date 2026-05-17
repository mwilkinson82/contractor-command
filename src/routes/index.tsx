import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  DISCORD_URL,
  REPLAYS,
  addToCalendarUrl,
  formatSessionDate,
  greeting,
  nextAny,
  relativeDay,
} from "@/lib/program";
import { vault, type Packet } from "@/lib/vault";
import { useCompany } from "@/hooks/use-company";
import { useAuth } from "@/hooks/use-auth";
import { GridField } from "@/components/portal/grid-field";
import { AosPulse } from "@/components/portal/aos-pulse";
import { AosHero } from "@/components/portal/aos-hero";
import { HomeHero } from "@/components/portal/home-hero";
import { SignalTiles } from "@/components/portal/signal-tiles";
import { TodaysMove } from "@/components/portal/todays-move";
import { getAosSnapshot, type AosResult } from "@/lib/aos.functions";
import {
  ArrowUpRight,
  Calendar,
  Video,
  Archive,
  MessagesSquare,
  FileText,
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

const COMPANY_KEY = "aos.company_id";

function HomePage() {
  const session = nextAny();
  const latestReplay = REPLAYS[0];
  const { company } = useCompany();
  const { user } = useAuth();

  const [hello, setHello] = useState<string>("Welcome");
  const [today, setToday] = useState<string>("");
  const [sessionWhen, setSessionWhen] = useState<string>("");
  const [replayDate, setReplayDate] = useState<string>("");
  const [packets, setPackets] = useState<Packet[]>([]);
  const [companyId, setCompanyId] = useState<string | null>(null);

  const firstName =
    (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] ||
    user?.email?.split("@")[0] ||
    "there";
  const companyName = company?.name?.trim() || "Your Command Center";

  // Hydrate company id from localStorage (avoids SSR mismatch)
  useEffect(() => {
    try {
      setCompanyId(window.localStorage.getItem(COMPANY_KEY));
    } catch {}
  }, []);

  // AOS query — shares cache key with <AosPulse /> so they dedupe automatically.
  const aosFn = useServerFn(getAosSnapshot);
  const { data: aosData, refetch: refetchAos, isFetching: aosFetching } =
    useQuery<AosResult>({
      queryKey: ["aos-snapshot", companyId],
      queryFn: () => aosFn({ data: { companyId: companyId ?? undefined } }),
      staleTime: 60_000,
      refetchOnWindowFocus: true,
    });

  const aosLinked = aosData?.ok && aosData.snapshot.linked;
  const aosPreviouslyLinked = aosData?.ok ? aosData.previously_linked : false;
  const aosUnknown = !aosData; // still loading first time
  const aosCompanies =
    aosData?.ok && !aosData.snapshot.linked ? aosData.snapshot.companies ?? [] : [];

  const pickCompany = (id: string) => {
    try { window.localStorage.setItem(COMPANY_KEY, id); } catch {}
    setCompanyId(id);
    // Query will refire because the key includes companyId
  };

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
      {/* Ask Marshall hero — the front door */}
      <HomeHero
        companyName={companyName}
        greeting={hello}
        firstName={firstName}
        today={today}
        greetingIcon={company?.greeting_icon as
          | "wave"
          | "crane"
          | "bulldozer"
          | "hammer"
          | "scale"
          | "brick"
          | null
          | undefined}
      />

      {/* Section divider — everything below is the dashboard */}
      <section className="relative border-t border-border/60 px-6 pt-10 pb-2">
        <GridField />
        <div className="relative mx-auto w-full max-w-[1180px]">
          <p className="label-mono">Your command center</p>
          <h2 className="mt-2 font-display text-[1.75rem] leading-tight">
            {companyName}
          </h2>
        </div>
      </section>

      {/* Unconnected AOS users see a dominant Start-AOS hero (or workspace picker) */}
      {!aosUnknown && !aosLinked && (
        <section className="relative px-6 pb-8">
          <div className="relative mx-auto w-full max-w-[1180px]">
            <AosHero
              previouslyLinked={aosPreviouslyLinked}
              isChecking={aosFetching}
              onRecheck={() => refetchAos()}
              companies={aosCompanies}
              onPickCompany={pickCompany}
            />
          </div>
        </section>
      )}

      {/* Today's move + AOS pulse row (when connected) */}
      <section className="relative px-6 pb-10">
        <div className="mx-auto grid w-full max-w-[1180px] gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <TodaysMove packets={packets} />
          </div>
          <article className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
            <p className="label-mono">Next session</p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal align-middle mr-2 animate-signal-pulse" />
              {session.kind} · {relativeDay(session.date)}
            </p>
            <h3 className="mt-3 font-display text-[18px] leading-snug">{session.title}</h3>
            <p className="mt-2 text-[12px] text-muted-foreground">{sessionWhen || "\u00A0"}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <a
                href={session.zoomUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90"
              >
                <Video className="h-3 w-3" /> Join
              </a>
              <a
                href={addToCalendarUrl(session)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-muted"
              >
                <Calendar className="h-3 w-3" /> Add
              </a>
            </div>
          </article>
        </div>
      </section>

      {/* AOS Pulse — full read when connected */}
      {aosLinked && (
        <section className="relative px-6 pb-10">
          <div className="mx-auto w-full max-w-[1180px]">
            <AosPulse />
          </div>
        </section>
      )}

      {/* Signal tiles — every command tool, live or coming */}
      <section className="relative px-6 pb-10">
        <div className="mx-auto w-full max-w-[1180px]">
          <div className="mb-5 flex items-end justify-between gap-3">
            <div>
              <p className="label-mono">Instrument panel</p>
              <h2 className="mt-2 font-display text-2xl">Command tools</h2>
            </div>
            <Link
              to="/vault"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-muted"
            >
              <Archive className="h-3 w-3" /> Company Vault
            </Link>
          </div>
          <SignalTiles packets={packets} />
        </div>
      </section>

      {/* Secondary rows */}
      <section className="px-6 pb-16">
        <div className="mx-auto w-full max-w-[1180px] grid gap-3 md:grid-cols-3">
          <MiniRow
            to="/calls"
            icon={<Video className="h-3.5 w-3.5" />}
            title="Latest replay"
            desc={`${latestReplay.title} · ${replayDate || ""}`}
          />
          <MiniRow to="/templates" icon={<FileText className="h-3.5 w-3.5" />} title="Templates" desc="Sell · Estimate · Contract · Launch · Bill" />
          <MiniRow to="/community" icon={<MessagesSquare className="h-3.5 w-3.5" />} title="The room" desc="Discord between sessions" extHref={DISCORD_URL} />
        </div>
      </section>
    </div>
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
