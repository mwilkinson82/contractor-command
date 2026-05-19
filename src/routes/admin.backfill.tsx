// Admin · Book Buyer Backfill — one-time tool to seed pending_claims from
// past Stripe checkouts so historical alphandbook.com buyers auto-claim Book
// Buyer tier on portal signup.

import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { backfillBookBuyers, type BackfillResult } from "@/lib/admin-backfill.functions";
import { Loader2, BookOpen, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/backfill")({
  head: () => ({ meta: [{ title: "Backfill book buyers — Admin" }] }),
  component: BackfillPage,
});

function BackfillPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const run = useServerFn(backfillBookBuyers);
  const [busy, setBusy] = useState<"dry" | "live" | null>(null);
  const [result, setResult] = useState<BackfillResult | null>(null);

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  async function execute(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "live");
    setResult(null);
    try {
      const res = await run({ data: { dryRun } });
      setResult(res);
      if (!dryRun) {
        toast.success(`Inserted ${res.inserted} pending claims.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Backfill failed.");
    } finally {
      setBusy(null);
    }
  }

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
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> Back to admin
      </Link>

      <div className="mt-4 border-b border-border pb-6">
        <p className="label-mono inline-flex items-center gap-1.5">
          <BookOpen className="h-3 w-3" /> Admin · Book Buyer Backfill
        </p>
        <h1
          className="mt-2 font-display text-3xl"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          Seed past book buyers
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] text-muted-foreground">
          Scans every successful Stripe checkout that matches the book price ID
          (or <code>metadata.product = "book_v2"</code>) and inserts a row into{" "}
          <code>pending_claims</code> for each unique email. After this runs,
          any past alphandbook.com buyer who signs up with the same email is
          automatically granted Book Buyer tier.
        </p>
        <p className="mt-2 max-w-2xl text-[12px] text-muted-foreground">
          Safe to re-run — existing claims and active subscribers are skipped.
          <strong> Always dry-run first.</strong>
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={() => execute(true)}
          disabled={!!busy}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-[13px] hover:bg-muted disabled:opacity-50"
        >
          {busy === "dry" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Dry run (preview only)
        </button>
        <button
          onClick={() => {
            if (
              window.confirm(
                "This will insert rows into pending_claims. Run a dry-run first if you haven't. Continue?",
              )
            )
              execute(false);
          }}
          disabled={!!busy}
          className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-[13px] uppercase tracking-[0.2em] text-cream hover:opacity-90 disabled:opacity-50"
        >
          {busy === "live" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Run for real
        </button>
      </div>

      {result && (
        <div className="mt-8 rounded-2xl border border-border bg-card p-6">
          <p className="label-mono">
            {result.dryRun ? "Dry-run results" : "Backfill complete"}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Stripe sessions scanned" value={result.scanned} />
            <Stat label="Matched book purchases" value={result.matched} />
            <Stat label="Unique buyer emails" value={result.uniqueEmails} />
            <Stat
              label={result.dryRun ? "Would insert" : "Inserted"}
              value={result.inserted}
              accent="signal"
            />
            <Stat
              label="Skipped (already claimed)"
              value={result.skippedAlreadyClaimed}
            />
            <Stat
              label="Skipped (already subscriber)"
              value={result.skippedAlreadySubscribed}
            />
          </div>

          <p className="mt-6 text-[11px] text-muted-foreground">
            Filter price ID:{" "}
            <code>{result.filterPriceId ?? "(none — metadata only)"}</code>
          </p>

          {result.sampleEmails.length > 0 && (
            <div className="mt-4">
              <p className="label-mono">Sample matched emails</p>
              <ul className="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground">
                {result.sampleEmails.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-4">
              <p className="label-mono text-destructive">Errors</p>
              <ul className="mt-2 space-y-1 text-[12px] text-destructive">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Container>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "signal";
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="label-mono">{label}</p>
      <p
        className={`mt-2 font-display text-2xl ${
          accent === "signal" ? "text-signal" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
