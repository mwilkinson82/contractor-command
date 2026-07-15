import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Search, ShieldCheck } from "lucide-react";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { listMemberControl, type MemberControlRow } from "@/lib/control-admin.functions";

export const Route = createFileRoute("/admin/control")({
  head: () => ({ meta: [{ title: "Member Control - ALP Contractor Circle" }] }),
  component: MemberControlPage,
});

function MemberControlPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const fetchRows = useServerFn(listMemberControl);
  const [query, setQuery] = useState("");

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
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.fullName, row.email, row.primaryCategory, row.primaryConstraint, row.tier]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [query, rows]);

  const metrics = useMemo(
    () => ({
      members: rows.length,
      orientation: rows.filter((row) => row.orientationOpenedAt).length,
      started: rows.filter((row) => row.assessmentStartedAt).length,
      baselines: rows.filter((row) => row.baselineSavedAt).length,
      activePlans: rows.filter(
        (row) => row.planState === "in_progress" || row.planState === "blocked",
      ).length,
    }),
    [rows],
  );

  const constraints = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.primaryCategory) continue;
      counts.set(row.primaryCategory, (counts.get(row.primaryCategory) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

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
          <h1 className="mt-2 font-display text-4xl">Member State of Control</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            See who has entered the operating path, where the group is constrained, and which 90-day
            plans need pressure.
          </p>
        </div>
        <ShieldCheck className="h-8 w-8 text-clay" />
      </div>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Eligible members" value={metrics.members} />
        <Metric label="Orientation opened" value={metrics.orientation} />
        <Metric label="Assessment started" value={metrics.started} />
        <Metric label="Baselines saved" value={metrics.baselines} />
        <Metric label="Plans active / blocked" value={metrics.activePlans} />
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="label-mono">Constraint distribution</p>
            <h2 className="mt-1 font-display text-2xl">What the room needs now</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {constraints.length ? (
              constraints.map(([name, count]) => (
                <span
                  key={name}
                  className="rounded-full border border-border bg-background px-3 py-1.5 text-xs"
                >
                  <strong>{count}</strong> {name}
                </span>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No baselines saved yet.</span>
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <p className="label-mono">Member route</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Orientation → assessment → baseline → active plan
            </p>
          </div>
          <label className="relative block w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search member or constraint"
              className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm"
            />
          </label>
        </div>
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading member control…</p>
        ) : null}
        {error ? (
          <p className="p-6 text-sm text-destructive">
            The member-control data could not be loaded.
          </p>
        ) : null}
        {!isLoading && !error ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Tier</th>
                  <th className="px-4 py-3 font-medium">Orientation</th>
                  <th className="px-4 py-3 font-medium">Assessment</th>
                  <th className="px-4 py-3 font-medium">State of Control</th>
                  <th className="px-4 py-3 font-medium">90-day plan</th>
                  <th className="px-4 py-3 font-medium">Last movement</th>
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="label-mono">{label}</p>
      <p className="mt-3 font-display text-3xl">{value}</p>
    </div>
  );
}

function MemberRow({ row }: { row: MemberControlRow }) {
  const lastMovement =
    row.planUpdatedAt ?? row.baselineSavedAt ?? row.assessmentStartedAt ?? row.orientationOpenedAt;
  return (
    <tr className="align-top">
      <td className="px-4 py-4">
        <p className="font-medium text-foreground">{row.fullName || row.email}</p>
        <p className="mt-1 text-muted-foreground">{row.email}</p>
      </td>
      <td className="px-4 py-4 capitalize">{row.tier.replaceAll("_", " ")}</td>
      <td className="px-4 py-4">
        <Stage
          complete={!!row.orientationOpenedAt}
          label={row.orientationOpenedAt ? "Opened" : "Not opened"}
        />
      </td>
      <td className="px-4 py-4">
        <Stage
          complete={!!row.assessmentStartedAt}
          label={row.assessmentStartedAt ? "Started" : "Not started"}
        />
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
      </td>
      <td className="px-4 py-4 text-muted-foreground">
        {lastMovement ? formatWhen(lastMovement) : "No activity"}
      </td>
    </tr>
  );
}

function Stage({ complete, label }: { complete: boolean; label: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 ${complete ? "bg-good/10 text-good" : "bg-muted text-muted-foreground"}`}
    >
      {label}
    </span>
  );
}

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
