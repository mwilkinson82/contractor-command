import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Copy, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { listMemberControl, type MemberControlRow } from "@/lib/control-admin.functions";

export const Route = createFileRoute("/admin/control")({
  head: () => ({ meta: [{ title: "Member Control - ALP Contractor Circle" }] }),
  component: MemberControlPage,
});

type ControlFilter = "all" | "current" | "stale" | "blocked" | "pressure" | "reassess";

const filterLabels: Record<ControlFilter, string> = {
  all: "All members",
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

  if (isAdmin === false) return null;

  return (
    <Container className="py-10">
      <Link
        to="/admin"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Admin dashboard
      </Link>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="label-mono">Admin · Professional Contractor Control</p>
          <h1 className="mt-2 font-display text-4xl">Weekly Control Room</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            See who is on rhythm, what is blocked, which constraints need pressure, and who is due
            to establish the next 90-day baseline. {rows.length} eligible members are in view.
          </p>
        </div>
        <ShieldCheck className="h-8 w-8 text-clay" />
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric
          label="Current this week"
          value={metrics.current}
          active={filter === "current"}
          onClick={() => setFilter(filter === "current" ? "all" : "current")}
        />
        <Metric
          label="Weekly review due"
          value={metrics.stale}
          active={filter === "stale"}
          onClick={() => setFilter(filter === "stale" ? "all" : "stale")}
        />
        <Metric
          label="Blocked"
          value={metrics.blocked}
          active={filter === "blocked"}
          onClick={() => setFilter(filter === "blocked" ? "all" : "blocked")}
        />
        <Metric
          label="Needs pressure"
          value={metrics.pressure}
          active={filter === "pressure"}
          onClick={() => setFilter(filter === "pressure" ? "all" : "pressure")}
        />
        <Metric
          label="Reassessment due"
          value={metrics.reassess}
          active={filter === "reassess"}
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
        {pressureList.length ? (
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
            <p className="label-mono">Member operating rhythm</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Viewing {filterLabels[filter]} · {filtered.length} members
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
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
          <div className="overflow-x-auto">
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
        ) : null}
      </section>
    </Container>
  );
}

function Metric({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition-colors ${
        active ? "border-ink bg-ink text-cream" : "border-border bg-card hover:border-foreground/25"
      }`}
    >
      <p className={active ? "label-mono text-cream/55" : "label-mono"}>{label}</p>
      <p className="mt-3 font-display text-3xl">{value}</p>
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
        {row.score === null ? (
          <span className="text-muted-foreground">No baseline</span>
        ) : (
          <>
            <p className="font-display text-xl">{row.score}/100</p>
            <p className="mt-1 max-w-48 text-muted-foreground">{row.primaryConstraint}</p>
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
      await navigator.clipboard.writeText(buildNudge(row));
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

function buildNudge(row: MemberControlRow) {
  const name = firstName(row);
  const next = row.weeklyNextAction
    ? ` Your next owned action is “${row.weeklyNextAction}”${row.weeklyNextOwner ? ` with ${row.weeklyNextOwner}` : ""}.`
    : "";
  if (row.weeklyNeedsPressure) {
    return `Hey ${name} — I saw your Weekly Control Review. You flagged: “${row.weeklyPressureNote || row.weeklyBlocker || row.primaryConstraint}.” Bring that into Discord or the next call and we’ll pressure-test it together.${next}`;
  }
  if (row.weeklyBlocked || row.planState === "blocked") {
    return `Hey ${name} — your control plan is showing a blocker: “${row.weeklyBlocker || row.primaryConstraint}.” Let’s get it into Discord or the next call before it costs another week.${next}`;
  }
  if (row.reassessmentDue) {
    return `Hey ${name} — your 90-day State of Control reassessment is due. Rerun it in the Hub so we can compare the new baseline, confirm what moved, and identify the next constraint.`;
  }
  if (row.planStartedAt && !row.weeklyCurrent) {
    return `Hey ${name} — your Weekly Control Review is due in the Hub. Take five minutes to record what moved, what is blocked, the next owned action, and any pressure you need from the group.`;
  }
  if (!row.baselineSavedAt) {
    return `Hey ${name} — your State of Control baseline is still open. Run the assessment in Start Here so the Hub can build your personalized 90-day control plan.`;
  }
  return `Hey ${name} — your Control Journey is current. Keep pressure on ${row.primaryConstraint || "the active constraint"} and update the next owned action in this week’s review.${next}`;
}

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
