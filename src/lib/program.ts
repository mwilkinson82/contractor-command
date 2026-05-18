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
  passcode?: string;
  description: string;
  agenda?: string[];
};

// Replays moved to the `replays` database table — see src/routes/replays.tsx.


// Biweekly cadence: every other Sunday, 5:00 PM Eastern.
// Anchor: 2026-05-24 17:00 ET (EDT = UTC-4) → 2026-05-24T21:00:00.000Z.
const BIWEEKLY_ANCHOR_UTC = "2026-05-24T21:00:00.000Z";

function nextBiweeklyFromAnchor(): { date: string } {
  const anchor = new Date(BIWEEKLY_ANCHOR_UTC).getTime();
  const now = Date.now();
  const period = 14 * 86_400_000;
  let t = anchor;
  // If we're past the start of the anchor day's call, roll forward by 14d
  // until the next future call. Always returns a date >= now.
  while (t < now) t += period;
  return { date: new Date(t).toISOString() };
}

// --- Upcoming sessions (edit these as the calendar moves) ---
export const UPCOMING: Session[] = [
  {
    kind: "Biweekly Call",
    title: "Bi-weekly working session",
    date: nextBiweeklyFromAnchor().date,
    durationMin: 90,
    zoomUrl: "https://us06web.zoom.us/j/83215167292?pwd=Mtt970HFCPStqSw62btyyta2Wxo0Pr.1",
    zoomId: "832 1516 7292",
    passcode: "321266",
    description:
      "Open-room session. Members bring one specific business issue. We work two or three of them live.",
    agenda: [
      "Quick room check-in — what shifted this week?",
      "Member issues: two or three worked live.",
      "Marshall's read + the next move for each.",
    ],
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
  if (days > 1 && days <= 14) return `in ${days} days`;
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

// Replay library now lives in the `replays` database table.


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
