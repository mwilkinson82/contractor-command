import * as React from "react";
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listProjects,
  createProject,
  loadSchedule,
} from "@/lib/scheduler/persistence.functions";
import { calculateSchedule } from "@/lib/scheduler/engine";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/scheduler")({
  head: () => ({ meta: [{ title: "Projects — CPM Workbench · AOS" }] }),
  component: ProjectsHome,
});

type Project = {
  id: string;
  name: string;
  client?: string;
  projectNumber?: string;
  status: "planning" | "active" | "on_hold" | "closed";
  tags: string[];
  projectStartDate?: string;
  dataDate?: string;
  updatedAt: string;
};

const STATUS_LABEL: Record<Project["status"], string> = {
  planning: "Planning",
  active: "Active",
  on_hold: "On hold",
  closed: "Closed",
};

const STATUS_DOT: Record<Project["status"], string> = {
  planning: "bg-[#c9a84c]",
  active: "bg-emerald-600",
  on_hold: "bg-amber-500",
  closed: "bg-[#9b9789]",
};

function ProjectsHome() {
  const qc = useQueryClient();
  const listFn = useServerFn(listProjects);
  const createFn = useServerFn(createProject);
  const loadFn = useServerFn(loadSchedule);

  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [start, setStart] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | Project["status"]>("all");
  const [search, setSearch] = useState("");

  const projectsQ = useQuery({
    queryKey: ["projects"],
    queryFn: () => listFn(),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          name: name || "Untitled project",
          client: client || null,
          projectStartDate: start || null,
        },
      }),
    onSuccess: () => {
      setName("");
      setClient("");
      setStart("");
      toast.success("Project created");
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const projects: Project[] = (projectsQ.data?.projects ?? []) as Project[];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (filterStatus !== "all" && p.status !== filterStatus) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.client ?? "").toLowerCase().includes(q) ||
        (p.projectNumber ?? "").toLowerCase().includes(q)
      );
    });
  }, [projects, filterStatus, search]);

  // Per-project CPM stats (parallel loads, mirrors portfolio approach).
  const detailQs = useQueries({
    queries: filtered.map((p) => ({
      queryKey: ["schedule", p.id],
      queryFn: () => loadFn({ data: { id: p.id } }),
      staleTime: 30_000,
    })),
  });

  const portfolioStats = useMemo(() => {
    let totalBAC = 0;
    let totalActual = 0;
    let weightedPctNum = 0;
    let weightedPctDen = 0;
    let atRisk = 0;
    let critTotal = 0;
    detailQs.forEach((q) => {
      if (!q.data) return;
      try {
        const res = calculateSchedule(q.data.schedule);
        let bac = 0;
        let earned = 0;
        let actual = 0;
        for (const t of res.tasks) {
          const b = t.budgetCost ?? 0;
          bac += b;
          earned += b * ((t.percentComplete ?? 0) / 100);
          actual += t.actualCost ?? 0;
        }
        totalBAC += bac;
        totalActual += actual;
        if (bac > 0) {
          weightedPctNum += earned;
          weightedPctDen += bac;
        }
        const spi = bac > 0 ? earned / bac : 1;
        const cpi = actual > 0 ? earned / actual : 1;
        if (spi < 0.95 || cpi < 0.95) atRisk++;
        critTotal += res.tasks.filter((t) => t.isCritical).length;
      } catch {
        // skip
      }
    });
    return {
      totalBAC,
      totalActual,
      weightedPct: weightedPctDen > 0 ? (weightedPctNum / weightedPctDen) * 100 : null,
      atRisk,
      critTotal,
      loaded: detailQs.filter((q) => q.data).length,
      total: detailQs.length,
    };
  }, [detailQs]);

  return (
    <div className="min-h-screen bg-[#f7f4ed] px-4 py-8 text-[#1f241f] sm:px-6">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7a6a4d]">
            CPM Workbench · Primavera-class scheduling, AOS ease
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/scheduler-portfolio"
                className="rounded border border-[#d8cdb8] bg-white px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-[#1f241f] hover:bg-[#eee6d7]"
              >
                Portfolio EVM →
              </Link>
              <Link
                to="/scheduler-field"
                className="rounded border border-[#d8cdb8] bg-white px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-[#1f241f] hover:bg-[#eee6d7]"
              >
                Field update (mobile) →
              </Link>
            </div>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-[#5c574e]">
            Every job, every owner, every schedule — open one to step into the CPM workbench.
          </p>
        </header>

        {/* Portfolio strip */}
        <section className="mb-6 grid grid-cols-2 gap-3 rounded border border-[#d8cdb8] bg-white p-4 sm:grid-cols-4">
          <Stat label="Projects" value={String(projects.length)} />
          <Stat
            label="Portfolio % complete"
            value={
              portfolioStats.weightedPct == null
                ? "—"
                : `${portfolioStats.weightedPct.toFixed(1)}%`
            }
            sub={`${portfolioStats.loaded}/${portfolioStats.total} loaded`}
          />
          <Stat
            label="BAC · Actual"
            value={`$${fmt(portfolioStats.totalBAC)}`}
            sub={`Actual $${fmt(portfolioStats.totalActual)}`}
          />
          <Stat
            label="At risk"
            value={String(portfolioStats.atRisk)}
            sub={`${portfolioStats.critTotal} critical acts total`}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          {/* Left: new project + filters */}
          <aside className="space-y-6">
            <section className="rounded border border-[#d8cdb8] bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
                New project
              </h2>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="np-name">Project name</Label>
                  <Input
                    id="np-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Commercial fit-out"
                  />
                </div>
                <div>
                  <Label htmlFor="np-client">Client (optional)</Label>
                  <Input
                    id="np-client"
                    value={client}
                    onChange={(e) => setClient(e.target.value)}
                    placeholder="Acme Holdings"
                  />
                </div>
                <div>
                  <Label htmlFor="np-start">Project start (optional)</Label>
                  <Input
                    id="np-start"
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() => createMut.mutate()}
                  disabled={createMut.isPending}
                  className="w-full"
                >
                  {createMut.isPending ? "Creating…" : "Create project"}
                </Button>
                <p className="text-xs text-[#7a6a4d]">
                  After creating, open the project and import an XER, start from sample, or build by hand.
                </p>
              </div>
            </section>

            <section className="rounded border border-[#d8cdb8] bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
                Filter
              </h2>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="fl-search">Search</Label>
                  <Input
                    id="fl-search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name, client, project #"
                  />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select
                    value={filterStatus}
                    onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="planning">Planning</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="on_hold">On hold</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>
          </aside>

          {/* Right: project list */}
          <main>
            {projectsQ.isLoading ? (
              <p className="text-sm text-[#746b5c]">Loading projects…</p>
            ) : filtered.length === 0 ? (
              <div className="rounded border border-dashed border-[#d8cdb8] bg-white/60 p-10 text-center text-sm text-[#746b5c]">
                {projects.length === 0
                  ? "No projects yet. Create your first one on the left."
                  : "No projects match your filters."}
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {filtered.map((p, idx) => {
                  const detail = detailQs[idx]?.data;
                  let pct: number | null = null;
                  let finish: string | undefined;
                  let crit = 0;
                  if (detail) {
                    try {
                      const res = calculateSchedule(detail.schedule);
                      finish = res.projectFinishDate;
                      crit = res.tasks.filter((t) => t.isCritical).length;
                      let bac = 0;
                      let earned = 0;
                      for (const t of res.tasks) {
                        const b = t.budgetCost ?? 0;
                        bac += b;
                        earned += b * ((t.percentComplete ?? 0) / 100);
                      }
                      if (bac > 0) pct = (earned / bac) * 100;
                      else if (res.tasks.length > 0) {
                        // Fall back to simple avg %comp.
                        pct =
                          res.tasks.reduce((s, t) => s + (t.percentComplete ?? 0), 0) /
                          res.tasks.length;
                      }
                    } catch {
                      // ignore
                    }
                  }
                  return (
                    <li key={p.id}>
                      <Link
                        to="/scheduler/$projectId"
                        params={{ projectId: p.id }}
                        className="group block rounded border border-[#d8cdb8] bg-white p-4 transition hover:border-[#1f241f] hover:shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[#7a6a4d]">
                              <span
                                className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[p.status]}`}
                              />
                              {STATUS_LABEL[p.status]}
                              {p.projectNumber ? <span>· #{p.projectNumber}</span> : null}
                            </div>
                            <div className="mt-1 truncate text-base font-semibold tracking-tight">
                              {p.name}
                            </div>
                            {p.client ? (
                              <div className="truncate text-xs text-[#5c574e]">{p.client}</div>
                            ) : null}
                          </div>
                          <div className="text-right text-xs text-[#746b5c]">
                            {p.projectStartDate ?? "—"}
                            <div>→ {finish ?? "—"}</div>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                          <Mini
                            label="% Comp"
                            value={pct == null ? "—" : `${pct.toFixed(0)}%`}
                          />
                          <Mini label="Critical" value={String(crit)} />
                          <Mini
                            label="Data date"
                            value={p.dataDate ?? "—"}
                          />
                        </div>

                        <div className="mt-3 text-[10px] uppercase tracking-wide text-[#9b9075]">
                          Updated {new Date(p.updatedAt).toLocaleDateString()}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7a6a4d]">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tracking-tight">{value}</div>
      {sub ? <div className="text-[11px] text-[#746b5c]">{sub}</div> : null}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[#eee6d7] bg-[#faf7ee] px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-[#7a6a4d]">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function fmt(n: number): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}
