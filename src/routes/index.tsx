import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { openTemplateFile } from "@/lib/library";
import { Download, Sparkles } from "lucide-react";
import bulldozerAsset from "@/assets/bulldozer.png.asset.json";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  addToCalendarUrl,
  formatSessionDate,
  greeting,
  nextAny,
  relativeDay,
} from "@/lib/program";
import { supabase } from "@/integrations/supabase/client";
import { vault, type Packet } from "@/lib/vault";
import { useCompany } from "@/hooks/use-company";
import { isAllowedReturnTo, RETURN_TO_STORAGE_KEY } from "@/lib/return-to";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { AosPulse } from "@/components/portal/aos-pulse";

import { AosHero } from "@/components/portal/aos-hero";
import { HomeHero } from "@/components/portal/home-hero";
import { HandbookAnchor } from "@/components/portal/handbook-anchor";
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
  const [latestReplay, setLatestReplay] = useState<{ title: string; recorded_at: string } | null>(null);
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
      {/* Featured: latest Contractor Circle class — top of page */}
      <div className="pt-6">
        <FeaturedLatestClass />
        <FeaturedWorkbook />
      </div>

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

            <TodaysMove packets={packets} />

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
  const whiteboardPath = "circle-calls/2026-06-21-ior-whiteboard.pdf";

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
            Contractor Circle Call — June 21, 2026
          </h2>

          <div className="mt-6 overflow-hidden rounded-xl border border-border bg-black">
            <div style={{ position: "relative", width: "100%", height: 0, paddingBottom: "56.25%" }}>
              <iframe
                src="https://us06web.zoom.us/clips/embed/EYG5aRgpQbCdFapJqlkI0w"
                frameBorder="0"
                allowFullScreen
                style={{ position: "absolute", width: "100%", height: "100%", top: 0, left: 0 }}
                title="Contractor Circle Call — June 21, 2026"
              />
            </div>
          </div>

          <article className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
            <div className="min-w-0 flex-1">
              <p className="label-mono">Call whiteboard · PDF</p>
              <h3 className="mt-1 font-display text-[17px] leading-snug">
                Bi-Weekly Call Whiteboard — June 21, 2026
              </h3>
              <p className="mt-1 text-[13px] text-muted-foreground">
                The live whiteboard Marshall worked from during the call — six rules of project delivery and the IOR breakdown.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDownload(whiteboardPath)}
              disabled={busy === whiteboardPath}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 ${busy === whiteboardPath ? "opacity-60" : ""}`}
            >
              <Download className="h-3.5 w-3.5" />
              {busy === whiteboardPath ? "Opening…" : "Download PDF"}
            </button>
          </article>

          <article className="mt-3 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
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


