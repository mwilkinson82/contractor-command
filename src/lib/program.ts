// Program data — single source of truth for schedule, replays,
// community, billing, and external links. Edit this file to update
// what members see across the portal.

export type Session = {
  kind: "Biweekly Call" | "Monthly Bootcamp";
  title: string;
  date: string; // ISO datetime with tz offset
  durationMin: number;
  zoomUrl: string;
  zoomId?: string;
  description: string;
};

export type Replay = {
  title: string;
  date: string; // ISO date
  kind: "Biweekly Call" | "Monthly Bootcamp";
  tags: string[];
  description: string;
  usefulFor: string;
  relatedAos: string;
  zoomUrl?: string; // missing = "replay pending"
};

// --- Upcoming sessions (edit these as the calendar moves) ---
export const UPCOMING: Session[] = [
  {
    kind: "Biweekly Call",
    title: "Open issues — bring one that's stuck.",
    date: "2026-05-21T18:00:00.000Z", // Thu May 21, 11:00 AM PT
    durationMin: 90,
    zoomUrl: "https://zoom.us/j/0000000000",
    zoomId: "000 0000 0000",
    description:
      "Open-room session. Members bring one specific business issue. We work two or three of them live.",
  },
  {
    kind: "Monthly Bootcamp",
    title: "Owner dependency — installing the first system.",
    date: "2026-06-04T17:00:00.000Z", // Thu Jun 4, 10:00 AM PT
    durationMin: 120,
    zoomUrl: "https://zoom.us/j/1111111111",
    zoomId: "111 1111 1111",
    description:
      "Workshop format. We pick one owner bottleneck per member and write the first version of the system that pulls the owner out.",
  },
];

export function nextOfKind(kind: Session["kind"]): Session | undefined {
  const now = Date.now();
  return UPCOMING
    .filter((s) => s.kind === kind && new Date(s.date).getTime() > now)
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))[0]
    ?? UPCOMING.find((s) => s.kind === kind);
}

export function nextAny(): Session {
  const now = Date.now();
  const upcoming = UPCOMING
    .filter((s) => new Date(s.date).getTime() > now)
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  return upcoming[0] ?? UPCOMING[0];
}

export function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function relativeDay(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 7) return `in ${days} days`;
  if (days < 0) return "now";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function addToCalendarUrl(s: Session): string {
  const start = new Date(s.date);
  const end = new Date(start.getTime() + s.durationMin * 60_000);
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${s.kind} — ${s.title}`,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `${s.description}\n\nZoom: ${s.zoomUrl}`,
    location: s.zoomUrl,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Late night";
}

// --- Replay library ---
export const REPLAYS: Replay[] = [
  {
    title: "Owner dependency — where the business still leans on you",
    date: "2026-05-15",
    kind: "Biweekly Call",
    tags: ["Owner dependency", "Process", "PM leadership"],
    description:
      "Three members' org charts on screen. We named the seat each owner was silently filling and chose the first system to install.",
    usefulFor: "Owners about to install their first PM scorecard or accountability chart.",
    relatedAos: "Accountability Chart + Process",
    zoomUrl: "https://zoom.us/rec/share/example-1",
  },
  {
    title: "Bootcamp — estimate throughput in a slow market",
    date: "2026-05-02",
    kind: "Monthly Bootcamp",
    tags: ["Estimating", "Scorecard", "Pursuit"],
    description:
      "Pressure-testing estimate volume vs. close rate when leads are thinner than usual. Concrete weekly numbers per shop.",
    usefulFor: "Owners whose pipeline looks fine but signed contracts are flat.",
    relatedAos: "Scorecard + Process",
    zoomUrl: "https://zoom.us/rec/share/example-2",
  },
  {
    title: "Cash control — billing rhythm and collections discipline",
    date: "2026-04-18",
    kind: "Biweekly Call",
    tags: ["Cash", "Billing", "Collections"],
    description:
      "Why profitable jobs still create cash tightness, and the cadence that fixes it. Replay link pending — notes in the Vault.",
    usefulFor: "Members feeling cash tightness even when projects are profitable.",
    relatedAos: "Numbers + Process",
  },
  {
    title: "Bootcamp — the first three SOPs every shop should own",
    date: "2026-04-03",
    kind: "Monthly Bootcamp",
    tags: ["SOPs", "Process", "Onboarding"],
    description:
      "Picking the right SOPs to write first. We wrote drafts live for project launch, change orders, and PM weekly cadence.",
    usefulFor: "Owners stuck on which process to formalize first.",
    relatedAos: "Process",
    zoomUrl: "https://zoom.us/rec/share/example-4",
  },
];

// --- External links ---
export const AOS_URL = "https://alpos.alpcontractorcircle.com";
export const DISCORD_URL = "https://discord.gg/alp-contractor-circle";
export const STRIPE_PORTAL_URL = "https://billing.stripe.com/p/login/test_placeholder";
export const INTENSIVE_EMAIL = "hello@alpcontractorcircle.com";

// --- Community surface ---
export const DISCORD_CHANNELS = [
  { name: "#announcements", purpose: "Marshall posts session prep, replays, and shifts here." },
  { name: "#bring-one-issue", purpose: "Post the issue you want pressure on before the next call." },
  { name: "#wins", purpose: "Closed contracts, hires, installed systems. Specifics only." },
  { name: "#estimating", purpose: "Pricing assumptions, qualification debates, scope traps." },
  { name: "#field-leadership", purpose: "PM oversight, foreman, and crew leadership conversations." },
  { name: "#numbers", purpose: "Cash, billing, collections, and scorecard discipline." },
];
