import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy, Download, Mail, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  buildControlNudge,
  buildControlRoomCsv,
  controlRoomExportFilename,
  memberCountLabel,
} from "@/lib/control-admin-outreach";
import { listMemberControl, type MemberControlRow } from "@/lib/control-admin.functions";

export const Route = createFileRoute("/admin/control")({
  head: () => ({ meta: [{ title: "Member Control - ALP Contractor Circle" }] }),
  component: MemberControlPage,
});

type ControlFilter =
  | "all"
  | "baseline"
  | "plan_not_started"
  | "current"
  | "stale"
  | "blocked"
  | "pressure"
  | "reassess";

const filterLabels: Record<ControlFilter, string> = {
  all: "All members",
  baseline: "Needs baseline",
  plan_not_started: "Plan not started",
  current: "Current",
  stale: "Weekly review due",
  blocked: "Blocked",
  pressure: "Needs pressure",
  reassess: "Reassessment due",
};

function MemberControlPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const fetchRows = useServerFn(listMemberControl);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ControlFilter>("all");

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery<MemberControlRow[]>({
    queryKey: ["admin-member-control"],
    queryFn: () => fetchRows(),
    enabled: !!isAdmin,
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        !needle ||
        [
          row.fullName,
          row.email,
          row.primaryCategory,
          row.primaryConstraint,
          row.tier,
          row.weeklyBlocker,
          row.weeklyNextAction,
          row.weeklyPressureNote,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      if (!matchesQuery) return false;
      if (filter === "baseline") return row.baselineState !== "current";
      if (filter === "plan_not_started") {
        return row.baselineState === "current" && !row.planStartedAt;
      }
      if (filter === "current") return row.weeklyCurrent;
      if (filter === "stale") return Boolean(row.planStartedAt) && !row.weeklyCurrent;
      if (filter === "blocked") return row.weeklyBlocked || row.planState === "blocked";
      if (filter === "pressure") return row.weeklyNeedsPressure;
      if (filter === "reassess") return row.reassessmentDue;
      return true;
    });
  }, [filter, query, rows]);

  const metrics = useMemo(
    () => ({
      baseline: rows.filter((row) => row.baselineState !== "current").length,
      planNotStarted: rows.filter((row) => row.baselineState === "current" && !row.planStartedAt)
        .length,
      current: rows.filter((row) => row.weeklyCurrent).length,
      stale: rows.filter((row) => row.planStartedAt && !row.weeklyCurrent).length,
      blocked: rows.filter((row) => row.weeklyBlocked || row.planState === "blocked").length,
      pressure: rows.filter((row) => row.weeklyNeedsPressure).length,
      reassess: rows.filter((row) => row.reassessmentDue).length,
    }),
    [rows],
  );

  const pressureList = useMemo(
    () => rows.filter((row) => row.weeklyNeedsPressure || row.weeklyBlocked).slice(0, 5),
    [rows],
  );

  async function copyFilteredEmails() {
    const emails = [...new Set(filtered.map((row) => row.email.trim().toLowerCase()))];
    if (!emails.length) return;
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      toast.success(`${memberCountLabel(emails.length)} copied for outreach.`);
    } catch {
      toast.error("The email list could not be copied.");
    }
  }

  function exportFilteredRows() {
    if (!filtered.length) return;
    const blob = new Blob([buildControlRoomCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = controlRoomExportFilename(filterLabels[filter]);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`${memberCountLabel(filtered.length)} exported for follow-up.`);
  }

  if (isAdmin === false) return null;

  return (
    <Container className="py-8 sm:py-10">
      <Link
        to="/admin"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Admin dashboard
      </Link>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="label-mono">Admin · Professional Contractor Control</p>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl">Weekly Control Room</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            See who is on rhythm, what is blocked, which constraints need pressure, and who is due
            to establish the next 90-day baseline.{" "}
            {isLoading
              ? "Loading eligible members…"
              : rows.length === 1
                ? "1 eligible member is in view."
                : `${rows.length} eligible members are in view.`}
          </p>
        </div>
        <ShieldCheck className="h-8 w-8 text-clay" />
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Metric
          label="Needs baseline"
          value={isLoading ? null : metrics.baseline}
          active={filter === "baseline"}
          disabled={isLoading}
          onClick={() => setFilter(filter === "baseline" ? "all" : "baseline")}
        />
        <Metric
          label="Plan not started"
          value={isLoading ? null : metrics.planNotStarted}
          active={filter === "plan_not_started"}
          disabled={isLoading}
          onClick={() => setFilter(filter === "plan_not_started" ? "all" : "plan_not_started")}
        />
        <Metric
          label="Current this week"
          value={isLoading ? null : metrics.current}
          active={filter === "current"}
          disabled={isLoading}
          onClick={() => setFilter(filter === "current" ? "all" : "current")}
        />
        <Metric
          label="Weekly review due"
          value={isLoading ? null : metrics.stale}
          active={filter === "stale"}
          disabled={isLoading}
          onClick={() => setFilter(filter === "stale" ? "all" : "stale")}
        />
        <Metric
          label="Blocked"
          value={isLoading ? null : metrics.blocked}
          active={filter === "blocked"}
          disabled={isLoading}
          onClick={() => setFilter(filter === "blocked" ? "all" : "blocked")}
        />
        <Metric
          label="Needs pressure"
          value={isLoading ? null : metrics.pressure}
          active={filter === "pressure"}
          disabled={isLoading}
          onClick={() => setFilter(filter === "pressure" ? "all" : "pressure")}
        />
        <Metric
          label="Reassessment due"
          value={isLoading ? null : metrics.reassess}
          active={filter === "reassess"}
          disabled={isLoading}
          onClick={() => setFilter(filter === "reassess" ? "all" : "reassess")}
        />
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-ink text-cream">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cream/10 px-5 py-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
              Call pressure list
            </p>
            <h2 className="mt-1 font-display text-2xl">Issues worth bringing into the room</h2>
          </div>
          <span className="text-xs text-cream/45">Latest member reviews</span>
        </div>
        {isLoading ? (
          <p className="p-5 text-sm text-cream/55">Loading weekly review signals…</p>
        ) : pressureList.length ? (
          <div className="grid divide-y divide-cream/10 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            {pressureList.map((row) => (
              <div key={row.userId} className="flex items-start justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-medium">{row.fullName || row.email}</p>
                  <p className="mt-2 text-xs leading-relaxed text-cream/60">
                    {row.weeklyPressureNote || row.weeklyBlocker || "Plan is marked blocked."}
                  </p>
                  {row.weeklyNextAction ? (
                    <p className="mt-2 text-xs leading-relaxed text-cream/45">
                      Next: {row.weeklyNextAction} · {row.weeklyNextOwner}
                    </p>
                  ) : null}
                </div>
                <CopyNudgeButton row={row} dark />
              </div>
            ))}
          </div>
        ) : (
          <p className="p-5 text-sm text-cream/55">
            No member has flagged a blocker or requested pressure yet.
          </p>
        )}
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <p className="label-mono">Activation and member rhythm</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Viewing {filterLabels[filter]} · {memberCountLabel(filtered.length)}
            </p>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Filter the room, then copy a BCC-ready email list or export a working CSV with each
              member’s suggested follow-up.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <button
              type="button"
              disabled={isLoading || !filtered.length}
              onClick={copyFilteredEmails}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Mail className="h-3.5 w-3.5" /> Copy emails
            </button>
            <button
              type="button"
              disabled={isLoading || !filtered.length}
              onClick={exportFilteredRows}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
            {filter !== "all" ? (
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
              >
                Clear filter
              </button>
            ) : null}
            <label className="relative block min-w-0 flex-1 sm:w-72 sm:flex-none">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search member, constraint, or blocker"
                className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm"
              />
            </label>
          </div>
        </div>
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading control room…</p>
        ) : null}
        {error ? (
          <p className="p-6 text-sm text-destructive">
            The member-control data could not be loaded.
          </p>
        ) : null}
        {!isLoading && !error ? (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1100px] text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Member</th>
                    <th className="px-4 py-3 font-medium">State of Control</th>
                    <th className="px-4 py-3 font-medium">90-day plan</th>
                    <th className="px-4 py-3 font-medium">Weekly control</th>
                    <th className="px-4 py-3 font-medium">Next owned action</th>
                    <th className="px-4 py-3 font-medium">Follow-up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((row) => (
                    <MemberRow key={row.userId} row={row} />
                  ))}
                </tbody>
              </table>
              {!filtered.length ? (
                <p className="p-6 text-sm text-muted-foreground">No members match this view.</p>
              ) : null}
            </div>
            <div className="divide-y divide-border md:hidden">
              {filtered.map((row) => (
                <MemberCard key={row.userId} row={row} />
              ))}
              {!filtered.length ? (
                <p className="p-5 text-sm text-muted-foreground">No members match this view.</p>
              ) : null}
            </div>
          </>
        ) : null}
      </section>
    </Container>
  );
}

function Metric({
  label,
  value,
  active,
  disabled,
  onClick,
}: {
  label: string;
  value: number | null;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition-colors disabled:cursor-wait disabled:opacity-65 ${
        active ? "border-ink bg-ink text-cream" : "border-border bg-card hover:border-foreground/25"
      }`}
    >
      <p className={active ? "label-mono text-cream/55" : "label-mono"}>{label}</p>
      <p className="mt-3 font-display text-3xl">{value ?? "—"}</p>
    </button>
  );
}

function MemberRow({ row }: { row: MemberControlRow }) {
  return (
    <tr className="align-top">
      <td className="px-4 py-4">
        <p className="font-medium text-foreground">{row.fullName || row.email}</p>
        <p className="mt-1 text-muted-foreground">{row.email}</p>
        <p className="mt-1 capitalize text-muted-foreground">{row.tier.replaceAll("_", " ")}</p>
      </td>
      <td className="px-4 py-4">
        {row.baselineState === "missing" ? (
          <span className="text-muted-foreground">No baseline</span>
        ) : (
          <>
            <p className="font-display text-xl">{row.score === null ? "—" : `${row.score}/100`}</p>
            <p className="mt-1 max-w-48 text-muted-foreground">{row.primaryConstraint}</p>
            {row.baselineState === "needs_refresh" ? (
              <StatusBadge label="Refresh baseline" tone="attention" />
            ) : null}
          </>
        )}
      </td>
      <td className="px-4 py-4">
        <p className="font-medium capitalize">{row.planState.replaceAll("_", " ")}</p>
        <p className="mt-1 text-muted-foreground">
          {row.planPercent}% · {row.planActionsCompleted}/{row.planActionsTotal} actions
        </p>
        {row.reassessmentDue ? <StatusBadge label="Reassess now" tone="attention" /> : null}
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge
            label={row.weeklyCurrent ? "Current" : row.planStartedAt ? "Due" : "Not started"}
            tone={row.weeklyCurrent ? "good" : "neutral"}
          />
          {row.constraintTrend ? <StatusBadge label={row.constraintTrend} tone="neutral" /> : null}
          {row.weeklyBlocked ? <StatusBadge label="Blocked" tone="attention" /> : null}
          {row.weeklyNeedsPressure ? <StatusBadge label="Needs pressure" tone="attention" /> : null}
        </div>
        <p className="mt-2 max-w-56 leading-relaxed text-muted-foreground">
          {row.weeklyReviewedAt ? formatWhen(row.weeklyReviewedAt) : "No weekly review yet"}
        </p>
        {row.weeklyBlocker ? (
          <p className="mt-2 max-w-56 leading-relaxed text-clay">{row.weeklyBlocker}</p>
        ) : null}
      </td>
      <td className="px-4 py-4">
        {row.weeklyNextAction ? (
          <>
            <p className="max-w-64 leading-relaxed text-foreground">{row.weeklyNextAction}</p>
            <p className="mt-1 text-muted-foreground">Owner: {row.weeklyNextOwner}</p>
          </>
        ) : (
          <span className="text-muted-foreground">Not established</span>
        )}
      </td>
      <td className="px-4 py-4">
        <CopyNudgeButton row={row} />
      </td>
    </tr>
  );
}

function MemberCard({ row }: { row: MemberControlRow }) {
  const baselineLabel =
    row.baselineState === "missing"
      ? "No baseline"
      : row.baselineState === "needs_refresh"
        ? "Refresh baseline"
        : row.score === null
          ? "Current baseline"
          : `${row.score}/100`;
  return (
    <article className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{row.fullName || row.email}</h3>
          <p className="mt-1 truncate text-xs text-muted-foreground">{row.email}</p>
        </div>
        <span className="shrink-0 text-[10px] capitalize text-muted-foreground">
          {row.tier.replaceAll("_", " ")}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <MobileSignal label="Baseline" value={baselineLabel} />
        <MobileSignal
          label="90-day plan"
          value={`${row.planState.replaceAll("_", " ")} · ${row.planPercent}%`}
        />
        <MobileSignal
          label="Weekly control"
          value={row.weeklyCurrent ? "Current" : row.planStartedAt ? "Due" : "Not started"}
        />
        <MobileSignal label="Next owner" value={row.weeklyNextOwner || "Not established"} />
      </div>
      {row.primaryConstraint ? (
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Constraint: {row.primaryConstraint}
        </p>
      ) : null}
      {row.weeklyNextAction ? (
        <p className="mt-2 text-xs leading-relaxed">Next: {row.weeklyNextAction}</p>
      ) : null}
      <div className="mt-4">
        <CopyNudgeButton row={row} />
      </div>
    </article>
  );
}

function MobileSignal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <p className="label-mono">{label}</p>
      <p className="mt-1.5 capitalize leading-snug text-foreground">{value}</p>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "good" | "attention" | "neutral" }) {
  const colors =
    tone === "good"
      ? "bg-good/10 text-good"
      : tone === "attention"
        ? "bg-clay/10 text-clay"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 capitalize ${colors}`}>{label}</span>
  );
}

function CopyNudgeButton({ row, dark = false }: { row: MemberControlRow; dark?: boolean }) {
  async function copyNudge() {
    try {
      await navigator.clipboard.writeText(buildControlNudge(row));
      toast.success(`Nudge copied for ${firstName(row)}.`);
    } catch {
      toast.error("The nudge could not be copied.");
    }
  }

  return (
    <button
      type="button"
      onClick={copyNudge}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 text-xs ${
        dark
          ? "border-cream/20 text-cream hover:bg-cream/10"
          : "border-border bg-background text-foreground hover:bg-muted"
      }`}
    >
      <Copy className="h-3.5 w-3.5" /> Copy nudge
    </button>
  );
}

function firstName(row: MemberControlRow) {
  return row.fullName?.trim().split(/\s+/)[0] || "there";
}

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
