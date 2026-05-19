// Admin migration console: paste CSV of Manus members, send invites,
// monitor activation progress.

import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Upload, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  inviteMembersBulk,
  getMigrationStatus,
  type InviteResult,
  type MigrationStatus,
} from "@/lib/member-migration.functions";

export const Route = createFileRoute("/admin/migrate")({
  head: () => ({ meta: [{ title: "Member migration — Admin" }] }),
  component: MigratePage,
});

type Parsed = { email: string; fullName?: string };

function parseCsv(text: string): { rows: Parsed[]; errors: string[] } {
  const rows: Parsed[] = [];
  const errors: string[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { rows, errors };

  // Detect header row.
  const first = lines[0].toLowerCase();
  const hasHeader = /email/.test(first);
  const dataLines = hasHeader ? lines.slice(1) : lines;

  let headerEmailIdx = 0;
  let headerNameIdx = 1;
  if (hasHeader) {
    const cols = lines[0].split(",").map((c) => c.trim().toLowerCase());
    const eIdx = cols.findIndex((c) => c === "email");
    const nIdx = cols.findIndex(
      (c) => c === "full_name" || c === "name" || c === "fullname",
    );
    if (eIdx >= 0) headerEmailIdx = eIdx;
    if (nIdx >= 0) headerNameIdx = nIdx;
  }

  const seen = new Set<string>();
  for (const [i, line] of dataLines.entries()) {
    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    const email = (parts[headerEmailIdx] ?? "").toLowerCase();
    const fullName = parts[headerNameIdx] || undefined;
    if (!email) {
      errors.push(`Line ${i + (hasHeader ? 2 : 1)}: missing email`);
      continue;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push(`Line ${i + (hasHeader ? 2 : 1)}: bad email "${email}"`);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    rows.push({ email, fullName });
  }
  return { rows, errors };
}

function MigratePage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const send = useServerFn(inviteMembersBulk);
  const fetchStatus = useServerFn(getMigrationStatus);

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const [csv, setCsv] = useState("");
  const [results, setResults] = useState<InviteResult[] | null>(null);

  const parsed = useMemo(() => parseCsv(csv), [csv]);

  const { data: status } = useQuery<MigrationStatus>({
    queryKey: ["migration-status"],
    queryFn: () => fetchStatus(),
    enabled: !!isAdmin,
    refetchInterval: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const members = parsed.rows.map((r) => ({
        email: r.email,
        fullName: r.fullName,
      }));
      return send({ data: { members } });
    },
    onSuccess: (res) => {
      setResults(res.results);
      void qc.invalidateQueries({ queryKey: ["migration-status"] });
    },
  });

  if (isAdmin === null) {
    return (
      <Container className="py-10">
        <p className="text-sm text-muted-foreground">Checking access…</p>
      </Container>
    );
  }
  if (!isAdmin) return null;

  return (
    <Container className="py-10">
      <Link
        to="/admin"
        className="inline-flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to admin
      </Link>

      <div className="mt-6 border-b border-border pb-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Member migration
        </p>
        <h1 className="mt-2 font-display text-3xl">
          Bring existing members across from Manus.
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] text-muted-foreground">
          Paste your member CSV (one row per member, columns:{" "}
          <code className="font-mono text-[12px]">email,full_name</code>).
          Each member gets one email with a magic link that brings them to{" "}
          <code className="font-mono text-[12px]">/welcome</code> to set their
          password.
        </p>
      </div>

      {/* Status tiles */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <StatusTile
          label="Migrated"
          value={status?.totalMigrated ?? "—"}
          hint="Invites issued"
        />
        <StatusTile
          label="Activated"
          value={status?.activated ?? "—"}
          hint="Signed in at least once"
          accent="emerald"
        />
        <StatusTile
          label="Pending"
          value={status?.pending ?? "—"}
          hint="Haven't logged in yet"
          accent="amber"
        />
      </div>

      {/* CSV input */}
      <div className="mt-8 rounded-2xl border border-border bg-card p-5">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Members CSV
          </span>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={10}
            placeholder={`email,full_name\njane@acmebuilders.com,Jane Smith\njohn@buildco.com,John Doe`}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] focus:border-ink focus:outline-none"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted-foreground">
          <span>
            {parsed.rows.length} valid {parsed.rows.length === 1 ? "row" : "rows"}
            {parsed.errors.length > 0 && (
              <span className="ml-2 text-red-600">
                · {parsed.errors.length} issue
                {parsed.errors.length === 1 ? "" : "s"}
              </span>
            )}
          </span>
          <button
            type="button"
            disabled={parsed.rows.length === 0 || mutation.isPending}
            onClick={() => {
              setResults(null);
              mutation.mutate();
            }}
            className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[12px] font-medium text-cream hover:opacity-90 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending invites…
              </>
            ) : (
              <>
                <Upload className="h-3.5 w-3.5" /> Send {parsed.rows.length}{" "}
                invite{parsed.rows.length === 1 ? "" : "s"}
              </>
            )}
          </button>
        </div>

        {parsed.errors.length > 0 && (
          <ul className="mt-3 max-h-32 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
            {parsed.errors.slice(0, 20).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
            {parsed.errors.length > 20 && (
              <li className="mt-1 italic">
                …and {parsed.errors.length - 20} more
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Results */}
      {results && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Run summary
          </p>
          <div className="mt-2 flex gap-4 text-[13px]">
            <span className="text-emerald-700">
              {results.filter((r) => r.status === "invited").length} invited
            </span>
            <span className="text-muted-foreground">
              {results.filter((r) => r.status === "already_existed").length}{" "}
              already existed
            </span>
            <span className="text-red-600">
              {results.filter((r) => r.status === "error").length} errors
            </span>
          </div>
          <ul className="mt-4 max-h-96 overflow-y-auto divide-y divide-border text-[12px]">
            {results.map((r) => (
              <li key={r.email} className="flex items-start gap-2 py-2">
                {r.status === "invited" && (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
                )}
                {r.status === "already_existed" && (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                )}
                {r.status === "error" && (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 text-red-600" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono">{r.email}</p>
                  {r.message && (
                    <p className="truncate text-muted-foreground">{r.message}</p>
                  )}
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {r.status.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Container>
  );
}

function StatusTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number | string;
  hint: string;
  accent?: "emerald" | "amber";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-700"
      : accent === "amber"
        ? "text-amber-700"
        : "text-foreground";
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 font-display text-3xl ${accentClass}`}>{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}
