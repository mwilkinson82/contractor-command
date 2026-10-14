// Program data — single source of truth for schedule, replays,
// community, billing, and external links. Edit this file to update
// what members see across the portal.

export type Session = {
  id?: string;
  timeZone?: string;
  kind: "Biweekly Call" | "Monthly Bootcamp";
  title: string;
  date: string; // ISO datetime with tz offset
  durationMin: number;
  zoomUrl: string;
  meetingProvider: "Google Meet" | "Zoom";
  zoomId?: string;
  passcode?: string;
  description: string;
  agenda?: string[];
};

// Replays moved to the `replays` database table — see src/routes/replays.tsx.

// Session data is persisted in circle_sessions; client bundles contain no meeting URLs.
export const UPCOMING: Session[] = [];
export function nextOfKind(
  kind: Session["kind"],
  sessions: Session[] = UPCOMING,
): Session | undefined {
  return nextAny(sessions.filter((s) => s.kind === kind));
}
export function nextAny(sessions: Session[] = UPCOMING): Session | undefined {
  return sessions
    .filter((s) => Date.parse(s.date) + s.durationMin * 60_000 > Date.now())
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
}

export function formatSessionDate(iso: string, timeZone = "America/New_York"): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    timeZone,
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
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${s.kind} — ${s.title}`,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `${s.description}\n\nJoin through the member Hub: https://app.alpcontractorcircle.com/calls`,
    location: "https://app.alpcontractorcircle.com/calls",
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
export const DISCORD_URL = "https://discord.gg/yvVN2N3qvN";
export const STRIPE_PORTAL_URL = "https://billing.stripe.com/p/login/test_placeholder";
export const INTENSIVE_EMAIL = "hello@alpcontractorcircle.com";

// --- Community surface ---
export const DISCORD_CHANNELS = [
  { name: "#announcements", purpose: "Marshall posts session prep, replays, and shifts here." },
  {
    name: "#bring-one-issue",
    purpose: "Post the issue you want pressure on before the next call.",
  },
  { name: "#wins", purpose: "Closed contracts, hires, installed systems. Specifics only." },
  { name: "#estimating", purpose: "Pricing assumptions, qualification debates, scope traps." },
  {
    name: "#field-leadership",
    purpose: "PM oversight, foreman, and crew leadership conversations.",
  },
  { name: "#numbers", purpose: "Cash, billing, collections, and scorecard discipline." },
];
