import { type Application, type Snapshot, type Evidence, type Calculation } from "./model";
export type SavedApplication = {
  application_id: string;
  version: number;
  latest_version: number;
  body: Application;
  calculation: Calculation;
  billing_version: number | null;
  recorded_at: string;
  history: { version: number; state: string; recorded_at: string; reason: string }[];
};
export type ApplicationContext = {
  job: { number: string; name: string };
  currency: "USD";
  snapshot: Snapshot | null;
  snapshot_issue?: string | null;
  evidence: Evidence[];
  applications: {
    id: string;
    number: string;
    version: number;
    state: string;
    period_start: string;
    period_end: string;
  }[];
  selected: SavedApplication | null;
};
export type SavePayload = {
  id: string;
  request_id: string;
  expected_version: number;
  application: Application;
};
export type ApplicationReview = {
  review_key: string;
  expires_at: string;
  payload: SavePayload;
  calculation: Calculation;
  billing_effect: string;
};
export function applicationUrl(job: string, id?: string, version?: number, download = false) {
  const q = new URLSearchParams();
  if (id) q.set("application_id", id);
  if (version !== undefined) q.set("version", String(version));
  if (download) q.set("download", "pdf");
  return `/r/job/${job}/payment-applications${q.size ? "?" + q : ""}`;
}
export function applicationTarget(search: Record<string, unknown>): {
  id?: string;
  version?: number;
  download: boolean;
} {
  const id = search.application_id,
    raw = search.version;
  const version =
    raw === undefined
      ? undefined
      : typeof raw === "number"
        ? raw
        : typeof raw === "string" && /^[1-9]\d*$/.test(raw)
          ? Number(raw)
          : NaN;
  if (
    (id !== undefined &&
      (typeof id !== "string" ||
        !/^([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/i.test(id))) ||
    (version !== undefined && (!Number.isSafeInteger(version) || version < 1 || !id)) ||
    (search.download !== undefined && search.download !== "pdf")
  )
    throw Error("This application link is incomplete or invalid. Ask Athena for a fresh link.");
  return { id: id as string | undefined, version, download: search.download === "pdf" };
}
export function emptyApplication(snapshot: Snapshot): Application {
  return {
    number: "",
    period_start: "",
    period_end: "",
    prior_cutoff: "",
    state: "draft",
    source: "",
    reason: "",
    retainage_basis: "",
    prior_mode: "external",
    prior_application: null,
    prior_certified_net_cents: null,
    prior_basis: "",
    certification: null,
    evidence: [],
    snapshot,
    lines: snapshot.lines.map((s) => ({
      item: s.item,
      prior_work_cents: null,
      prior_stored_cents: null,
      prior_retained_cents: null,
      work_cents: null,
      stored_cents: null,
      stored_to_work_cents: null,
      work_retainage_bps: null,
      stored_retainage_bps: null,
      release_cents: null,
      stored_basis: "",
      release_basis: "",
    })),
  };
}
// All prior values come from the exact selected certificate, not an earlier daily report or cash ledger.
export function carryCertificate(a: Application, previous: SavedApplication): Application {
  if (
    previous.body.state !== "certified" ||
    !previous.body.certification ||
    previous.version !== previous.latest_version
  )
    throw Error("Choose the current saved certified application.");
  return {
    ...a,
    prior_mode: "saved",
    prior_application: { id: previous.application_id, version: previous.version },
    prior_cutoff: previous.body.period_end,
    prior_certified_net_cents:
      previous.body.prior_certified_net_cents! + previous.body.certification.amount_cents,
    prior_basis: `${previous.body.number}, version ${previous.version}; certificate ${previous.body.certification.date}: ${previous.body.certification.source}`,
    lines: a.lines.map((l) => {
      const p = previous.calculation.rows.find((p) => p.item === l.item);
      return {
        ...l,
        prior_work_cents: p?.work_cents ?? null,
        prior_stored_cents: p?.stored_cents ?? null,
        prior_retained_cents: p?.retained_cents ?? null,
      };
    }),
  };
}
