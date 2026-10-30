import { buyoutProjection, type BuyoutLedger } from "./buyout";
import { readScheduleControl } from "./schedule-control";
import type { Activity, LivingData } from "./living";
import { scheduleDate } from "./schedule-schema";

export type ScopedScheduleSnapshot = {
  company_id: string;
  job_id: string;
  version: number;
  data_date: string | null;
  data: LivingData;
};
export type ScheduleLinkEvidence = {
  latest_version: number | null;
  reports: ScopedScheduleSnapshot[];
  unavailable_versions: number[];
  coverage_complete: boolean;
  read_issue: string | null;
};
const difference = (a: string | null | undefined, b: string | null | undefined) =>
  a && b && scheduleDate.safeParse(a).success && scheduleDate.safeParse(b).success
    ? Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)
    : null;
export type ScheduleReader = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

function activity(reports: ScopedScheduleSnapshot[], version: number | null, id: string) {
  const report = reports.find((r) => r.version === version);
  const matches = report?.data.activities?.filter((a) => a.id === id) ?? [];
  return { report, item: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
}
const dates = (a: Activity | null) =>
  a
    ? {
        activity_id: a.id,
        name: a.name,
        wbs_id: a.wbs_id ?? null,
        calendar_id: a.calendar_id ?? null,
        start: a.start,
        finish: a.finish,
        milestone: a.duration === 0,
        total_float_work_days: a.total_float,
        critical: a.critical,
      }
    : null;

/** Read-only join over exact company/job/version identities. It never turns a
 * vendor date into a schedule constraint or a modeled/compensable delay. */
export function reconcileBuyoutSchedules(ledger: BuyoutLedger, evidence: ScheduleLinkEvidence) {
  for (const report of evidence.reports)
    if (report.company_id !== ledger.company_id || report.job_id !== ledger.job_id)
      throw new Error(
        "Schedule evidence belongs to another company or job; no cross-job join was made.",
      );
  if (new Set(evidence.reports.map((r) => r.version)).size !== evidence.reports.length)
    throw new Error("Schedule evidence repeats a report version; refresh the scoped read.");
  const projection = buyoutProjection(ledger);
  const links = projection.packages.map((pkg) => {
    const ref = pkg.schedule_ref;
    const pinned = ref ? activity(evidence.reports, ref.report_version, ref.activity_id) : null;
    const current = ref
      ? activity(evidence.reports, evidence.latest_version, ref.activity_id)
      : null;
    const state = !ref
      ? "unmapped"
      : !pinned?.report
        ? "version_unavailable"
        : pinned.ambiguous
          ? "activity_ambiguous"
          : !pinned.item
            ? "activity_unavailable"
            : evidence.latest_version === null
              ? "current_version_unavailable"
              : ref.report_version > evidence.latest_version
                ? "source_version_conflict"
                : ref.report_version === evidence.latest_version
                  ? "current"
                  : "historical";
    const party = ledger.parties.find((p) => p.id === pkg.selected_party_id);
    const partyState = !pkg.selected_party_id
      ? "not_selected"
      : !party
        ? "unavailable"
        : party.version === pkg.selected_party_version
          ? "current"
          : "historical";
    return {
      company_id: ledger.company_id,
      job_id: ledger.job_id,
      package_id: pkg.id,
      package_version: pkg.version,
      package_status: pkg.status,
      schedule_ref: ref,
      reference_state: state,
      current_report_version: evidence.latest_version,
      pinned_data_date: pinned?.report?.data_date ?? null,
      current_data_date: current?.report?.data_date ?? null,
      pinned_activity: dates(pinned?.item ?? null),
      current_activity: dates(current?.item ?? null),
      current_activity_state: !ref
        ? "unmapped"
        : current?.ambiguous
          ? "ambiguous"
          : current?.item
            ? "available"
            : "unavailable",
      calculation_basis: current?.report
        ? (readScheduleControl(current.report.data)?.calculation.status ?? "reported")
        : "unavailable",
      selected_party_id: pkg.selected_party_id,
      selected_party_version: pkg.selected_party_version,
      current_party_version: party?.version ?? null,
      party_reference_state: partyState,
      expected_award_on: pkg.expected_award_on,
      reported_expected_delivery_on: pkg.expected_delivery_on,
      reported_needed_by: pkg.needed_by,
      reported_delivery_vs_needed_by_calendar_days: difference(
        pkg.expected_delivery_on,
        pkg.needed_by,
      ),
      reported_delivery_vs_linked_milestone_calendar_days:
        current?.item?.duration === 0
          ? difference(pkg.expected_delivery_on, current.item.finish)
          : null,
      pinned_to_current_finish_variance_calendar_days: difference(
        current?.item?.finish,
        pinned?.item?.finish,
      ),
      comparison_basis:
        "Reported dates versus the explicitly linked activity; the package contract does not encode whether that activity is a delivery/installation gate. Date differences are not quantified schedule impact or a vendor promise.",
      quantified_schedule_impact: null,
      commitment_sources: pkg.commitment_sources,
      cancelled: pkg.cancelled,
      exclude_from_package_forecast: pkg.cancelled,
      missing: [
        ...(!ref
          ? ["Schedule activity/version not mapped"]
          : state !== "current"
            ? [
                `Schedule reference is ${state.replace(/_/g, " ")}; keep the original pin and review the current version.`,
              ]
            : []),
        ...(!pkg.expected_delivery_on
          ? ["Selected party's expected delivery date is unknown"]
          : []),
        ...(!pkg.needed_by ? ["Reported needed-by date is unknown"] : []),
        ...(partyState === "historical" || partyState === "unavailable"
          ? ["Selected party/version needs review; no automatic identity replacement"]
          : []),
        ...(pkg.commitment_sources.some((s) => !s.current)
          ? ["A commitment reference is not the current approved PO version"]
          : []),
      ],
    };
  });
  return {
    contract_version: 1,
    company_id: ledger.company_id,
    job_id: ledger.job_id,
    as_of: ledger.today,
    latest_schedule_version: evidence.latest_version,
    coverage_complete: evidence.coverage_complete,
    unavailable_versions: evidence.unavailable_versions,
    read_issue: evidence.read_issue,
    packages: links,
    canonical_commitments: projection.canonical_commitments,
    canonical_committed_cents: projection.canonical_committed_cents,
    source_consistency:
      "Scoped immutable version reads; this is not an atomic cross-domain accounting/schedule snapshot.",
    effect: "read_only_no_CPM_PO_AP_or_package_write",
  };
}

/** Existing authenticated, role-scoped CPM read only. A failed read remains
 * unavailable; it never means no schedule and never falls back to another job. */
export async function loadBuyoutScheduleLinks(sb: ScheduleReader, ledger: BuyoutLedger) {
  const evidence: ScheduleLinkEvidence = {
    latest_version: null,
    reports: [],
    unavailable_versions: [],
    coverage_complete: true,
    read_issue: null,
  };
  if (!ledger.job_id) return reconcileBuyoutSchedules(ledger, evidence);
  const read = async (version: number | null) => {
    try {
      const r = await (
        sb.rpc as unknown as (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: unknown }>
      )("mcp_living_report_get", { _job: ledger.job_id, _type: "cpm", _version: version });
      if (r.error) {
        evidence.read_issue = "Schedule read unavailable; no absence or replacement was inferred.";
        return null;
      }
      const data = r.data as {
        found?: boolean;
        version?: number;
        data_date?: string | null;
        data?: LivingData;
      } | null;
      if (!data?.found || !Number.isInteger(data.version)) return null;
      if (version !== null && data.version !== version) {
        evidence.read_issue =
          "Schedule source version changed unexpectedly; refresh before review.";
        return null;
      }
      return {
        company_id: ledger.company_id,
        job_id: ledger.job_id!,
        version: data.version!,
        data_date: data.data_date ?? null,
        data: data.data ?? {},
      };
    } catch {
      evidence.read_issue = "Schedule read unavailable; no absence or replacement was inferred.";
      return null;
    }
  };
  const current = await read(null);
  if (current) {
    evidence.latest_version = current.version;
    evidence.reports.push(current);
  }
  const versions = [
    ...new Set(
      buyoutProjection(ledger).packages.flatMap((p) =>
        p.schedule_ref ? [p.schedule_ref.report_version] : [],
      ),
    ),
  ]
    .filter((v) => v !== current?.version)
    .sort((a, b) => b - a);
  // Bounded, disclosed coverage; never silently truncate a large history.
  const cap = 50;
  const snapshots = await Promise.all(
    versions.slice(0, cap).map(async (version) => ({ version, report: await read(version) })),
  );
  for (const s of snapshots) {
    if (s.report) evidence.reports.push(s.report);
    else evidence.unavailable_versions.push(s.version);
  }
  evidence.unavailable_versions.push(...versions.slice(cap));
  evidence.coverage_complete =
    !!current && !evidence.unavailable_versions.length && !evidence.read_issue;
  return reconcileBuyoutSchedules(ledger, evidence);
}
