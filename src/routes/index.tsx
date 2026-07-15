import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { openTemplateFile } from "@/lib/library";
import { Download, Sparkles } from "lucide-react";
import bulldozerAsset from "@/assets/bulldozer.png.asset.json";
import july5WhiteboardAsset from "@/assets/2026-07-05-aos-ior-whiteboard.pdf.asset.json";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  addToCalendarUrl,
  formatSessionDate,
  greeting,
  nextAny,
  nextOfKind,
  relativeDay,
  type Session,
} from "@/lib/program";
import { supabase } from "@/integrations/supabase/client";
import { vault, type Packet } from "@/lib/vault";
import { useCompany } from "@/hooks/use-company";
import { isAllowedReturnTo, RETURN_TO_STORAGE_KEY } from "@/lib/return-to";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { tierAtLeast, useTier } from "@/hooks/use-tier";
import { AosPulse } from "@/components/portal/aos-pulse";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { AosHero } from "@/components/portal/aos-hero";
import { HomeHero } from "@/components/portal/home-hero";
import { ControlJourneyPanel } from "@/components/portal/control-journey";
import { WhatNeedsMove, type DashboardMove } from "@/components/portal/dashboard-moves";
import { HandbookAnchor } from "@/components/portal/handbook-anchor";
import { SignalTiles } from "@/components/portal/signal-tiles";
import { getAosSnapshot, type AosResult, type AosSnapshot } from "@/lib/aos.functions";
import { getActiveWeeklyMove, type WeeklyMove } from "@/lib/weekly-move.functions";
import { useControlJourney } from "@/hooks/use-control-journey";
import type { ControlJourney } from "@/lib/control-journey";

import { ArrowUpRight, Calendar, Video, Archive, MessagesSquare, FileText } from "lucide-react";

const CALL_ANNOUNCEMENT_ID = "contractor-circle-call-2026-07-05-5pm-est";
const CALL_ANNOUNCEMENT_DISMISSED_KEY = `alp.cc.dismissed.${CALL_ANNOUNCEMENT_ID}`;
const CALL_ANNOUNCEMENT_START_AT = "2026-07-05T21:00:00.000Z";
const CALL_ANNOUNCEMENT_EXPIRES_AT = "2026-07-06T03:00:00.000Z";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Command Center — ALP Contractor Circle" },
      {
        name: "description",
        content:
          "The private member portal for Contractor Circle: live calls with Marshall, AOS access, replays, templates, Ask Marshall, and the operating process behind the projects.",
      },
    ],
  }),
  component: HomePage,
});

const COMPANY_KEY = "aos.company_id";

function HomePage() {
  const session = nextAny();
  const standardCallSession = nextOfKind("Biweekly Call") ?? session;
  const callSession = {
    ...standardCallSession,
    title: "Contractor Circle Call",
    date: CALL_ANNOUNCEMENT_START_AT,
  };
  const [latestReplay, setLatestReplay] = useState<{ title: string; recorded_at: string } | null>(
    null,
  );
  const { company } = useCompany();
  const { user } = useAuth();
  const { tier, loading: tierLoading } = useTier();
  const [callAnnouncementOpen, setCallAnnouncementOpen] = useState(false);
  const controlJourneyEnabled = !tierLoading && tierAtLeast(tier, "book_buyer");
  const {
    data: controlJourney,
    isLoading: controlJourneyLoading,
    isError: controlJourneyFailed,
  } = useControlJourney(controlJourneyEnabled);

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
  const shouldSeeCallAnnouncement = !tierLoading && tierAtLeast(tier, "circle");

  // Hydrate company id from localStorage (avoids SSR mismatch)
  useEffect(() => {
    try {
      setCompanyId(window.localStorage.getItem(COMPANY_KEY));
    } catch (error) {
      void error;
      setCompanyId(null);
    }
  }, []);

  // If we just bounced back from a Stripe upgrade started by AOS,
  // honor the return_to (validated against alpcontractorcircle.com).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let target: string | null = null;
    try {
      const sp = new URLSearchParams(window.location.search);
      const fromUrl = sp.get("return_to");
      target =
        (fromUrl && isAllowedReturnTo(fromUrl)) ||
        isAllowedReturnTo(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY));
      window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
    } catch (error) {
      void error;
      target = null;
    }
    if (target) {
      toast.success("Welcome — sending you back to AOS…");
      window.setTimeout(() => window.location.replace(target!), 600);
    }
  }, []);

  // AOS query — shares cache key with <AosPulse /> so they dedupe automatically.
  const aosFn = useServerFn(getAosSnapshot);
  const {
    data: aosData,
    refetch: refetchAos,
    isFetching: aosFetching,
  } = useQuery<AosResult>({
    queryKey: ["aos-snapshot", companyId],
    queryFn: () => aosFn({ data: { companyId: companyId ?? undefined } }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    enabled: !!user,
  });

  // Curated weekly move (admin-pushed). Falls back to auto-derive when null.
  const fetchWeeklyMove = useServerFn(getActiveWeeklyMove);
  const { data: weeklyMove } = useQuery({
    queryKey: ["weekly-move"],
    queryFn: () => fetchWeeklyMove(),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  const aosLinked = Boolean(aosData?.ok && aosData.snapshot.linked);
  const aosPreviouslyLinked = aosData?.ok ? aosData.previously_linked : false;
  const aosUnknown = !aosData; // still loading first time
  const aosCompanies =
    aosData?.ok && !aosData.snapshot.linked ? (aosData.snapshot.companies ?? []) : [];
  const linkedSnapshot = aosData?.ok && aosData.snapshot.linked ? aosData.snapshot : null;
  const dashboardMoves = buildDashboardMoves(linkedSnapshot, packets, weeklyMove, controlJourney);

  const pickCompany = (id: string) => {
    try {
      window.localStorage.setItem(COMPANY_KEY, id);
    } catch (error) {
      void error;
    }
    setCompanyId(id);
    // Query will refire because the key includes companyId
  };

  useEffect(() => {
    if (!aosData?.ok || !aosData.snapshot.linked) return;
    const liveCompanyId = aosData.snapshot.company_id;
    if (!liveCompanyId || liveCompanyId === companyId) return;
    try {
      window.localStorage.setItem(COMPANY_KEY, liveCompanyId);
    } catch (error) {
      void error;
    }
    setCompanyId(liveCompanyId);
  }, [aosData, companyId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!user || !shouldSeeCallAnnouncement) return;
    const now = Date.now();
    const startAt = new Date(CALL_ANNOUNCEMENT_START_AT).getTime();
    const expiresAt = new Date(CALL_ANNOUNCEMENT_EXPIRES_AT).getTime();
    // Only show on the day of the call (from 8 hours before start until expiry).
    const showFrom = startAt - 8 * 60 * 60 * 1000;
    if (now < showFrom || now > expiresAt) return;
    if (window.sessionStorage.getItem(CALL_ANNOUNCEMENT_DISMISSED_KEY) === "1") return;
    setCallAnnouncementOpen(true);
  }, [shouldSeeCallAnnouncement, user]);

  function handleCallAnnouncementOpenChange(open: boolean) {
    setCallAnnouncementOpen(open);
    if (!open && typeof window !== "undefined") {
      window.sessionStorage.setItem(CALL_ANNOUNCEMENT_DISMISSED_KEY, "1");
    }
  }

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
    if (latestReplay) setReplayDate(new Date(latestReplay.recorded_at).toLocaleDateString());
    const load = () => setPackets(vault.list());
    load();
    window.addEventListener("vault:changed", load);
    return () => window.removeEventListener("vault:changed", load);
  }, [session.date, latestReplay]);

  // Load latest replay from DB
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("replays")
        .select("title, recorded_at")
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) setLatestReplay(data);
    })();
  }, []);

  return (
    <div className="relative">
      <ContractorCircleCallAnnouncement
        open={callAnnouncementOpen}
        onOpenChange={handleCallAnnouncementOpenChange}
        session={callSession}
      />

      {/* Ask Marshall hero — the front door */}
      <HomeHero
        companyName={companyName}
        greeting={hello}
        firstName={firstName}
        today={today}
        moves={dashboardMoves}
        aosLinked={aosLinked}
        greetingIcon={
          company?.greeting_icon as
            "wave" | "crane" | "bulldozer" | "hammer" | "scale" | "brick" | null | undefined
        }
      />

      {controlJourneyEnabled ? (
        <ControlJourneyPanel
          journey={controlJourney}
          loading={controlJourneyLoading}
          failed={controlJourneyFailed}
        />
      ) : null}

      {/* Decision queue + the next live Contractor Circle session */}
      <section className="relative px-4 pb-12 sm:px-6">
        <div className="mx-auto grid w-full max-w-[1180px] overflow-hidden rounded-xl border border-border shadow-[0_24px_70px_-55px_color-mix(in_oklab,var(--ink)_45%,transparent)] lg:grid-cols-[minmax(0,1fr)_360px]">
          <WhatNeedsMove moves={dashboardMoves} />
          <NextCallCard
            session={session}
            sessionWhen={sessionWhen}
            latestReplay={latestReplay}
            replayDate={replayDate}
          />
        </div>
      </section>

      {/* Corporate operating-system read: connected and disconnected stay distinct. */}
      <section className="relative px-4 pb-3 sm:px-6">
        <div className="relative mx-auto w-full max-w-[1180px]">
          <p className="label-mono">Corporate operating system</p>
          <h2 className="mt-2 font-display text-[2rem] leading-tight">AOS Pulse</h2>
          <p className="mt-2 max-w-[650px] text-[13px] leading-relaxed text-muted-foreground">
            A separate read from your company operating system. Connect AOS to add its scorecard,
            rocks, issues, and to-dos to the Hub signals above.
          </p>
        </div>
      </section>

      {/* Unconnected AOS users see a dominant Start-AOS hero (or workspace picker) */}
      {!aosUnknown && !aosLinked && (
        <section className="relative px-4 sm:px-6 pb-8">
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

      {/* AOS Pulse first — anchor of the dashboard */}
      {aosLinked && (
        <section className="relative px-4 pb-12 sm:px-6">
          <div className="mx-auto w-full max-w-[1180px]">
            <AosPulse />
          </div>
        </section>
      )}

      {/* Current class and working files remain on the dashboard, below the live reads. */}
      <div>
        <FeaturedLatestClass />
        <FeaturedWorkbook />
      </div>

      {/* Command tools — single editorial grid */}
      <section className="relative px-4 sm:px-6 pb-16">
        <div className="mx-auto w-full max-w-[1180px]">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
            <div className="max-w-xl">
              <p className="label-mono">Instrument panel</p>
              <h2
                className="mt-2 font-display text-[1.75rem] leading-tight"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                Command tools
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                One tool per problem. Run when you need it — every finding lands in your vault.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/tools"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12.5px] text-foreground/80 hover:bg-muted"
              >
                Browse all
              </Link>
              <Link
                to="/vault"
                className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-cream hover:opacity-90"
              >
                <Archive className="h-3 w-3" /> Company Vault
              </Link>
            </div>
          </div>
          <SignalTiles packets={packets} />
        </div>
      </section>

      {/* Handbook anchor — the reflect counterweight to the operate stack above */}
      <HandbookAnchor />
    </div>
  );
}

function ContractorCircleCallAnnouncement({
  open,
  onOpenChange,
  session,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: Session;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-[640px] overflow-hidden border-ink/15 bg-[var(--work-surface)] p-0 shadow-[var(--shadow-focus)] sm:rounded-2xl">
        <div className="grid gap-0 md:grid-cols-[1fr_220px]">
          <div className="p-6 sm:p-8">
            <p className="label-mono text-clay">Contractor Circle Call</p>
            <DialogTitle className="mt-3 font-display text-4xl font-normal leading-[0.95] tracking-tight text-ink sm:text-5xl">
              Tonight at 5:00 PM EST.
            </DialogTitle>
            <DialogDescription className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
              Use the standard Contractor Circle link. We will work the room, take questions, and
              keep moving the company behind the projects.
            </DialogDescription>

            <div className="mt-6 rounded-xl border border-border bg-card p-4">
              <p className="label-mono">Standard link</p>
              <a
                href={session.zoomUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block break-all font-mono text-[12px] leading-relaxed text-foreground underline decoration-signal/40 underline-offset-4 hover:text-signal"
              >
                {session.zoomUrl}
              </a>
              <p className="mt-3 font-mono text-[11px] text-muted-foreground">
                Zoom ID · {session.zoomId ?? "standard room"}
                {session.passcode ? <> · Passcode · {session.passcode}</> : null}
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <a
                href={session.zoomUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-3 text-[13px] font-medium text-cream hover:opacity-90"
              >
                Join the call <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <a
                href={addToCalendarUrl(session)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-3 text-[13px] text-foreground/80 hover:bg-muted"
              >
                <Calendar className="h-3.5 w-3.5" /> Add to calendar
              </a>
            </div>
          </div>

          <div className="border-t border-border bg-[var(--paper-deep)] p-6 md:border-l md:border-t-0">
            <p className="label-mono">Tonight</p>
            <div className="mt-4 space-y-4">
              <div>
                <p className="font-display text-[20px] leading-none">Live room</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  Bring the issue that needs pressure before the week starts.
                </p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="font-display text-[20px] leading-none">Questions</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  AOS, IOR, contract risk, project delivery risk, and the next move.
                </p>
              </div>
              <div className="border-t border-border pt-4">
                <p className="font-display text-[20px] leading-none">Replay later</p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  Replays will live in the Hub, but the room is where the pressure happens.
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NextCallCard({
  session,
  sessionWhen,
  latestReplay,
  replayDate,
}: {
  session: Session;
  sessionWhen: string;
  latestReplay: { title: string; recorded_at: string } | null;
  replayDate: string;
}) {
  return (
    <aside className="flex min-h-full flex-col bg-ink-panel p-6 text-cream">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/60">
          Contractor Circle Call
        </p>
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/65">
          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-good align-middle animate-live-pulse" />
          {relativeDay(session.date)}
        </p>
      </div>

      <h2 className="mt-7 font-display text-[2.35rem] leading-[0.98] tracking-[-0.025em] text-cream">
        {session.title}
      </h2>
      <p className="mt-3 text-[12px] text-cream/65">{sessionWhen || "\u00A0"}</p>

      {session.agenda && session.agenda.length > 0 ? (
        <ol className="mt-6 space-y-3 border-y border-cream/15 py-5">
          {session.agenda.slice(0, 3).map((item, index) => (
            <li
              key={`${index}-${item}`}
              className="flex gap-3 text-[12px] leading-snug text-cream/82"
            >
              <span className="font-mono text-[9px] text-cream/40">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <a
          href={session.zoomUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-cream px-3 py-2 text-[11px] font-semibold text-ink hover:opacity-90"
        >
          <Video className="h-3 w-3" /> Join session
        </a>
        <a
          href={addToCalendarUrl(session)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-cream/25 px-3 py-2 text-[11px] text-cream/85 hover:bg-cream/10"
        >
          <Calendar className="h-3 w-3" /> Add
        </a>
      </div>

      <div className="mt-auto pt-7">
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/45">Keep moving</p>
        <div className="mt-3 divide-y divide-cream/12 border-y border-cream/12">
          <Link
            to="/replays"
            className="group flex items-center gap-3 py-3 text-cream/78 hover:text-cream"
          >
            <Video className="h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium">Latest replay</p>
              <p className="mt-0.5 truncate text-[10px] text-cream/45">
                {latestReplay?.title ?? "No replays yet"}
                {replayDate ? ` · ${replayDate}` : ""}
              </p>
            </div>
            <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/templates"
            className="group flex items-center gap-3 py-3 text-cream/78 hover:text-cream"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="flex-1 text-[11px]">Templates · Sell through bill</span>
            <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/community"
            className="group flex items-center gap-3 py-3 text-cream/78 hover:text-cream"
          >
            <MessagesSquare className="h-3.5 w-3.5" />
            <span className="flex-1 text-[11px]">The room · Discord community</span>
            <ArrowUpRight className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </aside>
  );
}

function FeaturedLatestClass() {
  const [busy, setBusy] = useState<string | null>(null);
  const templatePath = "project-management/ior-source-of-truth.pdf";

  async function handleDownload(path: string) {
    setBusy(path);
    const url = await openTemplateFile(path);
    setBusy(null);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="relative px-4 pb-10 sm:px-6">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="mb-5 border-b border-border pb-4">
          <p className="label-mono">Latest working session</p>
          <h2 className="mt-2 font-display text-[2rem] leading-none">
            The class, whiteboard, and field file.
          </h2>
        </div>
        <div className="grid overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.55fr)]">
          <div className="bg-ink-panel p-3 sm:p-5">
            <div className="overflow-hidden rounded-lg border border-white/10 bg-black">
              <div className="relative h-0 w-full pb-[56.25%]">
                <iframe
                  src="https://us06web.zoom.us/clips/embed/odZsV2TBSj2uTvbaUp1OIg"
                  frameBorder="0"
                  allowFullScreen
                  allow="autoplay; picture-in-picture; fullscreen"
                  className="absolute left-0 top-0 h-full w-full"
                  title="Contractor Circle Call — July 5, 2026"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col p-6 sm:p-7">
            <div className="flex items-center gap-2">
              <img src={bulldozerAsset.url} alt="" className="h-5 w-auto object-contain" />
              <p className="label-mono">Featured · Latest class</p>
            </div>
            <h3 className="mt-4 font-display text-[2rem] leading-[1.02] tracking-[-0.02em]">
              Contractor Circle Call — July 5, 2026
            </h3>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              AOS, IOR, and daily field tracking — how real-time sundown reporting protects margin,
              exposes risk early, and keeps project decisions out of gut feel.
            </p>

            <div className="mt-6 divide-y divide-border border-y border-border">
              <a
                href={july5WhiteboardAsset.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 py-4 hover:text-signal"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold">AOS / IOR Whiteboard</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Sundown method and margin-protection flow
                  </p>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={() => handleDownload(templatePath)}
                disabled={busy === templatePath}
                className="group flex w-full items-center gap-3 py-4 text-left hover:text-signal disabled:opacity-60"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold">IOR — The Source of Truth</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Companion methodology · PDF
                  </p>
                </div>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeaturedWorkbook() {
  const [busy, setBusy] = useState<string | null>(null);

  const workbooks = [
    {
      key: "owner",
      eyebrow: "Featured workbook · Leadership",
      title: "Owner Dependency Scorecard — Checklist",
      blurb:
        "The print-ready companion to the in-app scorecard. Walk the 12 areas with your leadership team, find your highest-risk bottleneck, and pick the first system to install in 90 days.",
      path: "leadership/owner-dependency-scorecard-client-facing.pdf",
      cta: { to: "/tools/owner-dependency" as const, label: "Run the scorecard" },
    },
    {
      key: "pm-phase",
      eyebrow: "Featured workbook · Project Management",
      title: "Project Management Phase Specialization",
      blurb:
        "A model for splitting project management into phase-specialized lanes — pursuit, preconstruction, construction, closeout — so the right PM skill set runs the right phase.",
      path: "project_management/project-management-phase-specialization.pdf",
      cta: { to: "/templates" as const, label: "See all templates" },
    },
  ];

  async function handleDownload(key: string, path: string) {
    setBusy(key);
    const url = await openTemplateFile(path);
    setBusy(null);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="relative px-4 sm:px-6 pb-10">
      <div className="mx-auto w-full max-w-[1180px] grid gap-4 md:grid-cols-2">
        {workbooks.map((w) => (
          <div key={w.key} className="rounded-2xl border border-border bg-card p-6 md:p-7">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-clay" />
              <p className="label-mono">{w.eyebrow}</p>
            </div>
            <div className="mt-3">
              <h2 className="font-display text-2xl md:text-[26px] leading-tight">{w.title}</h2>
              <p className="mt-2 text-[13.5px] text-muted-foreground">{w.blurb}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleDownload(w.key, w.path)}
                  disabled={busy === w.key}
                  className={`inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-cream hover:opacity-90 ${busy === w.key ? "opacity-60" : ""}`}
                >
                  <Download className="h-3 w-3" />
                  {busy === w.key ? "Opening…" : "Download workbook"}
                </button>
                <Link
                  to={w.cta.to}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12.5px] text-foreground/80 hover:bg-muted"
                >
                  {w.cta.label} <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

type LinkedAosSnapshot = Extract<AosSnapshot, { linked: true }>;

function buildDashboardMoves(
  snapshot: LinkedAosSnapshot | null,
  packets: Packet[],
  weeklyMove: WeeklyMove | null | undefined,
  controlJourney?: ControlJourney,
): DashboardMove[] {
  const moves: DashboardMove[] = [];
  const seen = new Set<string>();

  const add = (move: DashboardMove) => {
    const key = move.title.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    moves.push(move);
  };

  if (weeklyMove) {
    add({
      id: `weekly-${weeklyMove.id}`,
      title: weeklyMove.headline,
      detail: weeklyMove.body,
      source: weeklyMove.source || "Weekly move",
      status: "This week",
      to: weeklyMove.cta_to || undefined,
      href: weeklyMove.cta_href || undefined,
      tone: "signal",
    });
  }

  if (snapshot) {
    const offTrackRock = snapshot.rocks.find((rock) => rock.status === "off-track");
    if (offTrackRock) {
      add({
        id: `aos-rock-${offTrackRock.id}`,
        title: offTrackRock.title,
        detail: `Quarterly rock is ${Math.round(offTrackRock.percent_complete)}% complete and currently off track.`,
        source: "AOS",
        status: "Off track",
        owner: offTrackRock.owner,
        to: "/aos",
        tone: "critical",
      });
    }

    const datedTodos = [...snapshot.todos_due_this_week].sort((a, b) =>
      (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
    );
    const todo = datedTodos[0];
    if (todo) {
      const isOverdue = todo.due_date ? new Date(todo.due_date).getTime() < Date.now() : false;
      add({
        id: `aos-todo-${todo.id}`,
        title: todo.title,
        detail: todo.due_date
          ? `${isOverdue ? "Past due" : "Due"} ${formatShortDate(todo.due_date)} in the company operating system.`
          : "Due this week in the company operating system.",
        source: "AOS",
        status: isOverdue ? "Overdue" : "Due this week",
        owner: todo.owner,
        to: "/aos",
        tone: isOverdue ? "critical" : "neutral",
      });
    }

    const issue = snapshot.issues_open[0];
    if (issue) {
      add({
        id: `aos-issue-${issue.id}`,
        title: issue.title,
        detail: "An open company issue waiting to be identified, discussed, and solved.",
        source: "AOS",
        status: "Open issue",
        owner: issue.owner,
        to: "/aos",
        tone: "neutral",
      });
    }
  }

  for (const packet of packets.filter((item) => item.status !== "Archived")) {
    if (moves.length >= 4) break;
    if (packet.kind === "command") {
      add({
        id: `packet-${packet.id}`,
        title: packet.recommendedAction || packet.title,
        detail: packet.primaryFinding || packet.primaryConstraint,
        source: packet.source,
        status: packet.status,
        to: "/vault",
        tone: "neutral",
      });
    } else {
      add({
        id: `packet-${packet.id}`,
        title: packet.title,
        detail: packet.needsPressure || packet.winLooksLike,
        source: "Bring One Issue",
        status: packet.status,
        to: "/vault",
        tone: "neutral",
      });
    }
  }

  const hasSavedControlBaseline =
    controlJourney?.steps.some((step) => step.id === "baseline" && step.status === "complete") ??
    false;
  const readyMoves: DashboardMove[] = [
    ...(!hasSavedControlBaseline
      ? [
          {
            id: "ready-cos-navigator",
            title: "Get your State of Control",
            detail:
              "Assess company, project, and field control, then save the 90-day route to your Company Vault.",
            source: "Contractor Circle tool",
            status: "Ready · ~8 min",
            to: "/tools/cos-navigator" as const,
            tone: "signal" as const,
          },
        ]
      : []),
    {
      id: "ready-bring-one-issue",
      title: "Bring one issue to the room",
      detail: "Submit the issue that needs pressure before the next working session.",
      source: "Contractor Circle Call",
      status: "Ready",
      to: "/calls",
      tone: "neutral",
    },
    {
      id: "ready-os-path",
      title: "Open the Contractor OS path",
      detail: "Use the path to decide which system the company needs next.",
      source: "Contractor OS",
      status: "Ready",
      to: "/operating-playbook",
      tone: "neutral",
    },
  ];

  for (const move of readyMoves) {
    if (moves.length >= 3) break;
    add(move);
  }

  return moves.slice(0, 4);
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
