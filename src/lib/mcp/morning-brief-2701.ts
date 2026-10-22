// Job 2701 card fixture. Activities and open items match the LA-31BE8 lookahead.
// Pay app and IOR lines come from the same job's saved money and IOR rows.
import { signedJobUrl } from "./board-url";
import type { BoardPage } from "./board-link";
import { job2701FlowData } from "./flows/job-2701";
import { buildMorningBrief, type BriefJob } from "./morning-brief";
import type { SAct } from "./styled-views";

export const JOB_2701_ID = "27010000-0000-4000-8000-000000000001";
const TOKEN = "a".repeat(43);

const ACTS: SAct[] = [
  { id: "A1110", name: "Underground conduit rough-in", start: "2026-10-26", finish: "2026-10-30", duration: 5, total_float: 0 },
  { id: "A1120a", name: "FA/LV underground pathways", start: "2026-10-27", finish: "2026-11-02", duration: 5, total_float: 3 },
  { id: "A1130", name: "Underground inspection (hold point)", start: "2026-11-05", finish: "2026-11-05", duration: 1, total_float: 0 },
];

const PAGES: BoardPage[] = ["field", "items", "daily", "photos", "ior", "payapp", "schedule", "lookahead", "briefing"];

function linksFor(scope: "full" | "super"): BriefJob["links"] {
  const out: BriefJob["links"] = {};
  for (const page of PAGES) {
    if ((page === "ior" || page === "payapp") && scope !== "full") continue;
    out[page] = signedJobUrl(page, JOB_2701_ID, TOKEN);
  }
  return out;
}

/** One Harbor Point job, as a PM or a superintendent would see it. Clock is passed in by the caller. */
export function job2701BriefJob(role: "pm" | "superintendent"): BriefJob {
  const flow = job2701FlowData();
  const scope = role === "superintendent" ? "super" : "full";
  const seat = role === "superintendent" ? "super" : "pm";
  const items: BriefJob["items"] = [
    { id: "d1", action: "Confirm start date — Submit delay notice for the storm line conflict (Section 8.3, 7 calendar days).", owner: "Elena Brooks", due_date: "2026-10-06" },
    { id: "d2", action: "Confirm start date — Submit claim notice for the storm line conflict (Section 8.4).", owner: "Elena Brooks", due_date: "2026-10-11" },
    { id: "rfi", action: "2701 – RFIs: RFI-001: underground conduit routing at grid C/4 conflicts with the storm line. Sent 2026-11-10; answer needed to hold the 2026-11-19 underground inspection.", owner: "Marcus Hale", due_date: "2026-10-30" },
    { id: "insp", action: "2701 – Inspections: Fire alarm underground pathway inspection on 2026-11-18 is not yet requested with the City of Corpus Christi.", owner: "Priya Nandakumar", due_date: "2026-11-02" },
    { id: "co14", action: "CO-14 ceiling conflict outstanding", owner: "Elena Brooks", due_date: "2026-10-28", cost_effect: null },
    { id: "co15", action: "CO-15 added receptacles needs pricing", owner: "Marcus Hale", due_date: "2026-10-30" },
    { id: "co12", action: "CO-12 duct conflict waiting on the architect", owner: "Priya Nandakumar", due_date: "2026-11-02" },
    ...flow.iorNow.map((row) => ({ id: `ior-${row.id}`, action: `IOR: ${row.title}`, owner: null, due_date: row.due })),
    { id: "pay", action: "Pay app 4", owner: "Accounting", due_date: "2026-10-26", check_key: "pm:billing" },
  ];
  return {
    job_id: JOB_2701_ID,
    job_number: "2701",
    name: flow.jobName,
    company_id: "c1",
    time_zone: "America/Chicago",
    scope,
    seat,
    activities: ACTS.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description ?? null,
      start: a.start ?? null,
      finish: a.finish ?? null,
      duration: typeof a.duration === "number" ? a.duration : null,
      total_float: typeof a.total_float === "number" ? a.total_float : null,
      critical: a.critical === true,
    })),
    items,
    lookahead: { start: "2026-10-26", end: "2026-11-06" },
    payApps: [{ label: "Pay app", due: "2026-10-26", amount: flow.money.billed }],
    invoices: [],
    dailyToday: false,
    links: linksFor(scope),
  };
}

export function job2701BriefCard(role: "pm" | "superintendent", now = new Date("2026-10-26T15:00:00Z")) {
  return buildMorningBrief({
    jobs: [job2701BriefJob(role)],
    hasCompany: true,
    settings: { enabled: true, send_local: "06:30", time_zone: "America/Chicago" },
    now,
  });
}
