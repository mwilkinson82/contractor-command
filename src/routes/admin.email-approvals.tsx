import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Container } from "@/components/portal/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  listEmailApprovals,
  approveEmailApproval,
  rejectEmailApproval,
  type EmailApprovalRow,
} from "@/lib/email-approvals.functions";
import { ArrowLeft, Check, X, Mail, Clock } from "lucide-react";

export const Route = createFileRoute("/admin/email-approvals")({
  head: () => ({ meta: [{ title: "Email approvals — Admin" }] }),
  component: EmailApprovalsPage,
});

function EmailApprovalsPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchList = useServerFn(listEmailApprovals);
  const approveFn = useServerFn(approveEmailApproval);
  const rejectFn = useServerFn(rejectEmailApproval);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [rejectNote, setRejectNote] = useState("");

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const { data: rows, isLoading } = useQuery<EmailApprovalRow[]>({
    queryKey: ["email-approvals"],
    queryFn: () => fetchList(),
    enabled: !!isAdmin,
    refetchInterval: 15_000,
  });

  const filtered = useMemo(() => {
    const list = rows ?? [];
    return filter === "all" ? list : list.filter((r) => r.status === filter);
  }, [rows, filter]);

  const selected = useMemo(
    () => filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  const approveMut = useMutation({
    mutationFn: (id: string) => approveFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Email approved and queued for sending");
      qc.invalidateQueries({ queryKey: ["email-approvals"] });
      setSelectedId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rejectMut = useMutation({
    mutationFn: (vars: { id: string; note?: string }) => rejectFn({ data: vars }),
    onSuccess: () => {
      toast.success("Email rejected — nothing sent");
      qc.invalidateQueries({ queryKey: ["email-approvals"] });
      setSelectedId(null);
      setRejectNote("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isAdmin === null) {
    return (
      <Container className="py-10">
        <p className="text-sm text-muted-foreground">Checking access…</p>
      </Container>
    );
  }
  if (!isAdmin) return null;

  const pendingCount = (rows ?? []).filter((r) => r.status === "pending").length;

  return (
    <Container className="py-10">
      <div className="mb-6 flex items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="label-mono">Admin · Email approvals</p>
          <h1 className="mt-2 font-display text-3xl">Outgoing email review</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every client-facing email is staged here. Nothing sends until you approve it.
            System notifications routed to your own inbox bypass this gate.
          </p>
        </div>
        <Link to="/admin" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((k) => (
          <Button
            key={k}
            variant={filter === k ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setFilter(k);
              setSelectedId(null);
            }}
          >
            {k[0].toUpperCase() + k.slice(1)}
            {k === "pending" && pendingCount > 0 ? (
              <Badge variant="secondary" className="ml-2">{pendingCount}</Badge>
            ) : null}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <Mail className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {filter === "pending" ? "Nothing waiting for review." : `No ${filter} emails.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
          <div className="space-y-2">
            {filtered.map((r) => {
              const active = selected?.id === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`w-full rounded-md border p-3 text-left transition-colors ${
                    active ? "border-primary bg-accent" : "border-border hover:bg-accent/50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{r.subject}</span>
                    <StatusPill status={r.status} />
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    → {r.recipient_email}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="font-mono">{r.template_name}</span>
                    <span>·</span>
                    <Clock className="h-3 w-3" />
                    <span>{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {selected ? (
            <div className="rounded-lg border border-border bg-card">
              <div className="border-b border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">To</p>
                    <p className="truncate font-medium">{selected.recipient_email}</p>
                  </div>
                  <StatusPill status={selected.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                  <div>
                    <p>Subject</p>
                    <p className="text-foreground">{selected.subject}</p>
                  </div>
                  <div>
                    <p>Template</p>
                    <p className="font-mono text-foreground">{selected.template_name}</p>
                  </div>
                  <div>
                    <p>From</p>
                    <p className="text-foreground">{selected.from_address}</p>
                  </div>
                  <div>
                    <p>Requested by</p>
                    <p className="text-foreground">{selected.requested_by_email ?? "system"}</p>
                  </div>
                </div>
              </div>

              <iframe
                title="Email preview"
                srcDoc={selected.html}
                sandbox=""
                className="h-[560px] w-full border-b border-border bg-white"
              />

              {selected.status === "pending" ? (
                <div className="space-y-3 p-4">
                  <Textarea
                    placeholder="Optional rejection note (kept internal)"
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    rows={2}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => approveMut.mutate(selected.id)}
                      disabled={approveMut.isPending || rejectMut.isPending}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      {approveMut.isPending ? "Approving…" : "Approve & send"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        rejectMut.mutate({ id: selected.id, note: rejectNote || undefined })
                      }
                      disabled={approveMut.isPending || rejectMut.isPending}
                    >
                      <X className="mr-2 h-4 w-4" />
                      {rejectMut.isPending ? "Rejecting…" : "Reject"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="p-4 text-xs text-muted-foreground">
                  {selected.status === "approved"
                    ? `Approved and queued ${selected.reviewed_at ? new Date(selected.reviewed_at).toLocaleString() : ""}`
                    : `Rejected ${selected.reviewed_at ? new Date(selected.reviewed_at).toLocaleString() : ""}${
                        selected.review_note ? ` — ${selected.review_note}` : ""
                      }`}
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </Container>
  );
}

function StatusPill({ status }: { status: EmailApprovalRow["status"] }) {
  const map = {
    pending: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    approved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    rejected: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${map[status]}`}>
      {status}
    </span>
  );
}
