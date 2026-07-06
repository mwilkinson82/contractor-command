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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import { AosHero } from "@/components/portal/aos-hero";
import { HomeHero } from "@/components/portal/home-hero";
import { HandbookAnchor } from "@/components/portal/handbook-anchor";
import { SignalTiles } from "@/components/portal/signal-tiles";
import { TodaysMove } from "@/components/portal/todays-move";
import { getAosSnapshot, type AosResult } from "@/lib/aos.functions";
import { getActiveWeeklyMove } from "@/lib/weekly-move.functions";

import {
  ArrowUpRight,
  Calendar,
  Video,
  Archive,
  MessagesSquare,
  FileText,
} from "lucide-react";

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
  const [latestReplay, setLatestReplay] = useState<{ title: string; recorded_at: string } | null>(null);
  const { company } = useCompany();
  const { user } = useAuth();
  const { tier, loading: tierLoading } = useTier();
  const [callAnnouncementOpen, setCallAnnouncementOpen] = useState(false);

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
    } catch {}
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
    } catch {}
    if (target) {
      toast.success("Welcome — sending you back to AOS…");
      window.setTimeout(() => window.location.replace(target!), 600);
    }
  }, []);

  // AOS query — shares cache key with <AosPulse /> so they dedupe automatically.
  const aosFn = useServerFn(getAosSnapshot);
  const { data: aosData, refetch: refetchAos, isFetching: aosFetching } =
    useQuery<AosResult>({
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
    if (!aosData?.ok || !aosData.snapshot.linked) return;
    const liveCompanyId = aosData.snapshot.company_id;
    if (!liveCompanyId || liveCompanyId === companyId) return;
    try { window.localStorage.setItem(COMPANY_KEY, liveCompanyId); } catch {}
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

      {/* Featured: latest Contractor Circle class + workbooks */}
      <div className="pt-6">
        <FeaturedLatestClass />
        <FeaturedWorkbook />
      </div>

      {/* Command center band — flows from hero, no hard divider */}
      <section className="relative px-4 sm:px-6 pt-8 pb-2">
        <div className="relative mx-auto w-full max-w-[1180px]">
          <p className="label-mono">Your command center</p>
          <h2 className="mt-2 font-display text-[1.75rem] leading-tight">
            {companyName}
          </h2>
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
        <section className="relative px-4 sm:px-6 pb-6">
          <div className="mx-auto w-full max-w-[1180px]">
            <AosPulse />
          </div>
        </section>
      )}


      {/* Centered spine + right rail (Perplexity-style) */}
      <section className="relative px-4 sm:px-6 pb-10">
        <div className="mx-auto grid w-full max-w-[1180px] gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* LEFT — symmetrical center column */}
          <div className="flex flex-col gap-5">
            {/* Today's move — hero of the dashboard */}

            <TodaysMove
              packets={packets}
              curated={
                weeklyMove
                  ? {
                      headline: weeklyMove.headline,
                      body: weeklyMove.body,
                      ctaLabel: weeklyMove.cta_label,
                      ctaTo: weeklyMove.cta_to ?? undefined,
                      ctaHref: weeklyMove.cta_href ?? undefined,
                      source: weeklyMove.source ?? undefined,
                    }
                  : null
              }
            />

            {/* Open issues — same width as Today's move */}
            <article className="relative overflow-hidden rounded-2xl border border-dashed border-border bg-card/60 p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-[520px]">
                  <p className="label-mono">Open issues — your queue for the room</p>
                  <h3 className="mt-2 font-display text-[18px] leading-snug">
                    Submit a topic for the bi-weekly call or bootcamp.
                  </h3>
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    Bring one issue that's stuck. Marshall picks two or three per call to work live. Anything you submit also feeds the bootcamp shortlist.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to="/calls"
                    hash="submit-topic"
                    className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90"
                  >
                    Submit a topic <ArrowUpRight className="h-3 w-3" />
                  </Link>
                  <Link
                    to="/calls"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/70 px-3 py-1.5 text-[12px] text-foreground/80 hover:bg-muted"
                  >
                    See submitted
                  </Link>
                </div>
              </div>
            </article>
          </div>

          {/* RIGHT RAIL — odd-shaped/secondary cards */}
          <aside className="flex flex-col gap-4">
            {/* Next call */}
            <article className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
              <p className="label-mono">Next {session.kind === "Biweekly Call" ? "bi-weekly call" : "bootcamp"}</p>
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal align-middle mr-2 animate-signal-pulse" />
                {relativeDay(session.date)}
              </p>
              <h3 className="mt-2 font-display text-[16px] leading-snug">{session.title}</h3>
              <p className="mt-1 text-[12px] text-muted-foreground">{sessionWhen || "\u00A0"}</p>

              {session.agenda && session.agenda.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {session.agenda.slice(0, 3).map((item, i) => (
                    <li key={i} className="flex gap-2 text-[12px] text-foreground/85 leading-snug">
                      <span className="font-mono text-[10px] text-muted-foreground mt-0.5">{String(i + 1).padStart(2, "0")}</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
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

            <RailRow
              to="/replays"
              icon={<Video className="h-3.5 w-3.5" />}
              title="Latest replay"
              desc={`${latestReplay?.title ?? "No replays yet"}${replayDate ? ` · ${replayDate}` : ""}`}
            />
            <RailRow
              to="/templates"
              icon={<FileText className="h-3.5 w-3.5" />}
              title="Templates"
              desc="Sell · Estimate · Contract · Launch · Bill"
            />
            <RailRow
              to="/community"
              icon={<MessagesSquare className="h-3.5 w-3.5" />}
              title="The room"
              desc="Discord community · open in app"
              accent
            />
          </aside>
        </div>
      </section>

      {/* Command tools — single editorial grid */}
      <section className="relative px-4 sm:px-6 pb-16">
        <div className="mx-auto w-full max-w-[1180px]">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
            <div className="max-w-xl">
              <p className="label-mono">Instrument panel</p>
              <h2 className="mt-2 font-display text-[1.75rem] leading-tight" style={{ fontFamily: "var(--font-serif)" }}>
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
            <p className="label-mono text-signal">Contractor Circle Call</p>
            <DialogTitle className="mt-3 font-display text-4xl font-normal leading-[0.95] tracking-tight text-ink sm:text-5xl">
              Tonight at 5:00 PM EST.
            </DialogTitle>
            <DialogDescription className="mt-4 text-[14px] leading-relaxed text-muted-foreground">
              Use the standard Contractor Circle link. We will work the room, take questions,
              and keep moving the company behind the projects.
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

function RailRow({
  to,
  extHref,
  icon,
  title,
  desc,
  accent,
}: {
  to: string;
  extHref?: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
  accent?: boolean;
}) {
  return (
    <div className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50 min-w-0 overflow-hidden">
      <Link to={to as "/"} className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
        <span
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${
            accent ? "bg-[#5865F2] text-white" : "bg-foreground/5"
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
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
    <section className="relative px-4 sm:px-6 pb-10">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="rounded-2xl border border-ink/15 bg-[var(--paper-deep)] p-6 md:p-8 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-2">
            <img src={bulldozerAsset.url} alt="" className="h-5 w-auto object-contain" />
            <p className="label-mono">Featured · Latest class</p>
          </div>
          <h2 className="mt-3 font-display text-3xl md:text-4xl leading-tight">
            Contractor Circle Call — July 5, 2026
          </h2>
          <p className="mt-2 text-[13.5px] text-muted-foreground max-w-[760px]">
            AOS, IOR, and daily field tracking — how real-time sundown reporting protects margin, exposes risk early, and keeps project decisions out of gut feel.
          </p>

          <div className="mt-6 overflow-hidden rounded-xl border border-border bg-black">
            <div style={{ position: "relative", width: "100%", height: 0, paddingBottom: "56.25%" }}>
              <iframe
                src="https://us06web.zoom.us/clips/embed/odZsV2TBSj2uTvbaUp1OIg"
                frameBorder="0"
                allowFullScreen
                allow="autoplay; picture-in-picture; fullscreen"
                style={{ position: "absolute", width: "100%", height: "100%", top: 0, left: 0 }}
                title="Contractor Circle Call — July 5, 2026"
              />
            </div>
          </div>

          <article className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
            <div className="min-w-0 flex-1">
              <p className="label-mono">Call whiteboard · PDF</p>
              <h3 className="mt-1 font-display text-[17px] leading-snug">
                July 5, 2026 — AOS / IOR Whiteboard
              </h3>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Marshall's live whiteboard from the call — the sundown method, IOR loop, and margin-protection flow diagrammed out.
              </p>
            </div>
            <a
              href={july5WhiteboardAsset.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90"
            >
              <Download className="h-3.5 w-3.5" />
              Open whiteboard
            </a>
          </article>

          <article className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
            <div className="min-w-0 flex-1">
              <p className="label-mono">Companion template · PDF</p>
              <h3 className="mt-1 font-display text-[17px] leading-snug">
                Project Management Methodology: IOR — The Source of Truth
              </h3>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Marshall's IOR methodology — identify risks before they hit profit, centralize tracking, and run the weekly reporting cadence.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDownload(templatePath)}
              disabled={busy === templatePath}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 ${busy === templatePath ? "opacity-60" : ""}`}
            >
              <Download className="h-3.5 w-3.5" />
              {busy === templatePath ? "Opening…" : "Download PDF"}
            </button>
          </article>
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
              <Sparkles className="h-3.5 w-3.5 text-gold" />
              <p className="label-mono">{w.eyebrow}</p>
            </div>
            <div className="mt-3">
              <h2 className="font-display text-2xl md:text-[26px] leading-tight">
                {w.title}
              </h2>
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
