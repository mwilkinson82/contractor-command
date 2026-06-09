// Admin · Handbook rollout — preflight + execute.
//
// You paste handbook-buyer emails. Server runs a dry-run diagnostic per
// email. You see exactly what would happen before any email goes out.
// "Run" only sends to the rows you already approved.

import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  Send,
  HelpCircle,
} from "lucide-react";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { toast } from "sonner";
import {
  previewHandbookRollout,
  executeHandbookRollout,
  type PreflightReport,
  type PreflightRow,
  type HandbookAction,
} from "@/lib/handbook-rollout.functions";

export const Route = createFileRoute("/admin/handbook")({
  head: () => ({ meta: [{ title: "Handbook rollout — Admin" }] }),
  component: HandbookRolloutPage,
});

function parseEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const ACTION_LABEL: Record<HandbookAction, string> = {
  ready_existing: "Ready — no email needed",
  send_reset: "Send reset link",
  seed_and_invite: "Seed claim + invite",
  grant_and_notify: "Grant handbook + notify",
  seed_only: "Seed claim only",
  skip_invalid: "Skip — invalid email",
};

const ACTION_TONE: Record<HandbookAction, string> = {
  ready_existing: "text-muted-foreground",
  send_reset: "text-signal",
  seed_and_invite: "text-foreground",
  grant_and_notify: "text-foreground",
  seed_only: "text-muted-foreground",
  skip_invalid: "text-destructive",
};

function HandbookRolloutPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const preview = useServerFn(previewHandbookRollout);
  const execute = useServerFn(executeHandbookRollout);

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const parsedEmails = useMemo(() => parseEmails(csv), [csv]);

  const previewMut = useMutation({
    mutationFn: async () => preview({ data: { emails: parsedEmails } }),
    onSuccess: (r) => {
      setReport(r);
      // Default-exclude rows that don't need any action.
      const skip = new Set<string>();
      for (const row of r.rows) {
        if (row.action === "ready_existing" || row.action === "skip_invalid") {
          skip.add(row.email);
        }
      }
      setExcluded(skip);
    },
    onError: (e: Error) => toast.error(e.message ?? "Preflight failed"),
  });

  const toSend = useMemo(() => {
    if (!report) return [];
    return report.rows.filter((r) => !excluded.has(r.email));
  }, [report, excluded]);

  const executeMut = useMutation({
    mutationFn: async () =>
      execute({
        data: {
          emails: toSend.map((r) => r.email),
          expectedCount: toSend.length,
        },
      }),
    onSuccess: (res) => {
      toast.success(`Done. Sent ${res.sent}, errors ${res.errors}.`);
    },
    onError: (e: Error) => toast.error(e.message ?? "Execute failed"),
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
        <p className="label-mono">Admin · Handbook rollout</p>
        <h1 className="mt-2 font-display text-3xl">
          Bring ALP Handbook buyers into the portal — safely.
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] text-muted-foreground">
          Paste handbook-buyer emails (one per line, or comma/space separated).
          Run preflight first to see what would happen for each person. Nothing
          is sent until you click <strong>Run</strong>.
        </p>
        <div className="mt-3 flex items-start gap-2 rounded-md bg-foreground/[0.03] p-3 text-[12px] text-muted-foreground">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Handbook entitlement grants: Handbook + AOS + Ask Marshall + Tools + Vault.
            It does <em>not</em> grant Circle calls, Templates, Replays, Community, or Hardcore.
          </p>
        </div>
      </div>

      {/* Email input */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-5">
        <label className="block">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Emails ({parsedEmails.length} parsed)
          </span>
          <textarea
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setReport(null);
            }}
            rows={8}
            placeholder={`jane@acmebuilders.com\njohn@buildco.com\nsam@example.com`}
            className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px] focus:border-ink focus:outline-none"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-muted-foreground">
            Step 1 — run preflight. No emails are sent.
          </span>
          <button
            type="button"
            disabled={parsedEmails.length === 0 || previewMut.isPending}
            onClick={() => previewMut.mutate()}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
          >
            {previewMut.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running preflight…
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" /> Run preflight on {parsedEmails.length}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Preflight report */}
      {report && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="label-mono">Preflight report</p>
              <h2 className="mt-2 font-display text-xl">What would happen</h2>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-5">
              <Pill label="Total" value={report.summary.total} />
              <Pill label="Ready" value={report.summary.readyExisting} tone="muted" />
              <Pill label="Reset" value={report.summary.needsSendReset} tone="signal" />
              <Pill label="Invite" value={report.summary.needsSeedAndInvite} />
              <Pill label="Grant" value={report.summary.needsGrant} />
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-border">
            <div className="grid grid-cols-[28px_1.8fr_1fr_1fr_1.3fr] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span />
              <span>Email</span>
              <span>Current state</span>
              <span>Recommended</span>
              <span>Notes</span>
            </div>
            <ul className="divide-y divide-border">
              {report.rows.map((row) => (
                <PreflightRowItem
                  key={row.email}
                  row={row}
                  excluded={excluded.has(row.email)}
                  onToggle={() =>
                    setExcluded((prev) => {
                      const next = new Set(prev);
                      if (next.has(row.email)) next.delete(row.email);
                      else next.add(row.email);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <span className="text-[12px] text-muted-foreground">
              Step 2 — review checkboxes, then send. {toSend.length} email
              {toSend.length === 1 ? "" : "s"} will be sent.
            </span>
            <button
              type="button"
              disabled={toSend.length === 0 || executeMut.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Send ${toSend.length} email${toSend.length === 1 ? "" : "s"}? This action cannot be undone.`,
                  )
                ) {
                  executeMut.mutate();
                }
              }}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[12px] font-medium text-cream hover:opacity-90 disabled:opacity-50"
            >
              {executeMut.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" /> Run for {toSend.length}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Execute results */}
      {executeMut.data && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <p className="label-mono">Execution results</p>
          <div className="mt-2 flex gap-4 text-[13px]">
            <span className="text-emerald-700">{executeMut.data.sent} sent</span>
            <span className="text-muted-foreground">{executeMut.data.skipped} skipped</span>
            <span className="text-red-600">{executeMut.data.errors} errors</span>
          </div>
          <ul className="mt-4 max-h-96 divide-y divide-border overflow-y-auto text-[12px]">
            {executeMut.data.rows.map((r) => (
              <li key={r.email} className="flex items-start gap-2 py-2">
                {r.action === "error" ? (
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 text-red-600" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono">{r.email}</p>
                  <p className="truncate text-muted-foreground">
                    {ACTION_LABEL[r.action as HandbookAction] ?? r.action}
                    {r.message ? ` — ${r.message}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Container>
  );
}

function Pill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "signal" | "muted";
}) {
  const cls =
    tone === "signal"
      ? "text-signal"
      : tone === "muted"
      ? "text-muted-foreground"
      : "text-foreground";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1">
      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className={`font-display text-[12px] ${cls}`}>{value}</span>
    </span>
  );
}

function PreflightRowItem({
  row,
  excluded,
  onToggle,
}: {
  row: PreflightRow;
  excluded: boolean;
  onToggle: () => void;
}) {
  const disabled = row.action === "skip_invalid";
  return (
    <li
      className={`grid grid-cols-[28px_1.8fr_1fr_1fr_1.3fr] items-start gap-2 px-3 py-2.5 text-[12px] ${
        excluded ? "opacity-50" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={!excluded}
        disabled={disabled}
        onChange={onToggle}
        className="mt-0.5 h-3.5 w-3.5 cursor-pointer rounded border-border"
      />
      <span className="truncate font-mono">{row.email}</span>
      <span>
        {row.hasAuthAccount ? (
          <span className="inline-block rounded-full bg-signal/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-signal">
            Has account
          </span>
        ) : (
          <span className="inline-block rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
            No account
          </span>
        )}
        {row.currentTier && (
          <span className="ml-1 text-muted-foreground">{row.currentTier}</span>
        )}
      </span>
      <span className={`font-medium ${ACTION_TONE[row.action]}`}>
        {ACTION_LABEL[row.action]}
      </span>
      <span className="text-muted-foreground">
        {row.notes.join(" · ")}
      </span>
    </li>
  );
}
