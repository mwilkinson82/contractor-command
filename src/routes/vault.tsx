import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { vault, type Packet } from "@/lib/vault";
import { PacketCard } from "@/components/portal/packet-card";
import { Archive, Search, Wrench } from "lucide-react";
import { VaultContextNote } from "@/components/portal/vault-context-note";

export const Route = createFileRoute("/vault")({
  head: () => ({ meta: [{ title: "Company Vault — ALP Contractor Circle" }] }),
  component: VaultPage,
});

function VaultPage() {
  const [packets, setPackets] = useState<Packet[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "command" | "issue">("all");

  useEffect(() => {
    const load = () => setPackets(vault.list());
    load();
    window.addEventListener("vault:changed", load);
    return () => window.removeEventListener("vault:changed", load);
  }, []);

  const counts = useMemo(() => {
    const bySource = new Map<string, number>();
    packets.forEach((p) => bySource.set(p.source, (bySource.get(p.source) ?? 0) + 1));
    const lastAt = packets[0]?.createdAt;
    return {
      total: packets.length,
      command: packets.filter((p) => p.kind === "command").length,
      issue: packets.filter((p) => p.kind === "issue").length,
      lastAt,
      bySource: Array.from(bySource.entries()),
    };
  }, [packets]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return packets
      .filter((p) => (filter === "all" ? true : p.kind === filter))
      .filter((p) => (needle ? p.title.toLowerCase().includes(needle) || p.source.toLowerCase().includes(needle) : true));
  }, [packets, q, filter]);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 py-10 sm:py-12">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/70 pb-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Company Vault</p>
          <h1 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">Your operating machine.</h1>
        </div>
        <Link
          to="/tools"
          className="inline-flex items-center gap-1.5 rounded-md bg-ink px-4 py-2 text-[13px] text-cream hover:opacity-90"
        >
          <Wrench className="h-3.5 w-3.5" /> Run a command tool
        </Link>
      </div>

      {/* Dashboard counters */}
      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Total packets" value={counts.total.toString()} />
        <Stat label="Command tools" value={counts.command.toString()} />
        <Stat label="Bring one issue" value={counts.issue.toString()} />
        <Stat
          label="Last activity"
          value={counts.lastAt ? new Date(counts.lastAt).toLocaleDateString() : "—"}
        />
      </div>

      <VaultContextNote mode="vault" className="mt-4" />

      {/* Filters */}
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search packets…"
            className="w-full rounded-md border border-border bg-card pl-9 pr-3 py-2 text-[13px] focus:border-ink focus:outline-none"
          />
        </div>
        <div className="flex rounded-md border border-border bg-card p-0.5">
          {(["all", "command", "issue"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded px-3 py-1.5 text-[12px] capitalize ${
                filter === k ? "bg-ink text-cream" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="mt-6">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-14 text-center">
            <Archive className="mx-auto h-5 w-5 text-muted-foreground" />
            <h2 className="mt-4 font-display text-xl">
              {packets.length === 0 ? "Nothing saved yet." : "No packets match."}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-[13px] text-muted-foreground">
              {packets.length === 0
                ? "Run a command tool, save the packet, and use it to decide what belongs in AOS."
                : "Try clearing the search or switching filters."}
            </p>
            {packets.length === 0 && (
              <div className="mt-6">
                <Link to="/tools" className="inline-flex rounded-md bg-ink px-4 py-2 text-[13px] text-cream hover:opacity-90">
                  Open Operator's Workbench
                </Link>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {filtered.map((p) => (
              <PacketCard key={p.id} packet={p} onChange={() => setPackets(vault.list())} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl tabular-nums">{value}</p>
    </div>
  );
}
