import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  listIntensiveLeads,
  setIntensiveLeadStatus,
  type IntensiveLead,
} from "@/lib/intensive-leads.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Sparkles, Mail, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/admin/intensive-leads")({
  head: () => ({ meta: [{ title: "Intensive leads — Admin" }] }),
  component: IntensiveLeadsPage,
});

function IntensiveLeadsPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchLeads = useServerFn(listIntensiveLeads);
  const updateStatus = useServerFn(setIntensiveLeadStatus);

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const { data: leads, isLoading } = useQuery<IntensiveLead[]>({
    queryKey: ["admin-intensive-leads"],
    queryFn: () => fetchLeads(),
    enabled: !!isAdmin,
  });

  const statusMut = useMutation({
    mutationFn: (vars: { id: string; status: string }) =>
      updateStatus({ data: vars }),
    onSuccess: () => {
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["admin-intensive-leads"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  return (
    <Container>
      <div className="mb-4">
        <Link
          to="/admin"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to admin
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5" />
        <h1 className="font-display text-2xl">Intensive leads</h1>
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Members who tapped “I’m interested in the Six-Week Intensive” inside Ask
        Marshall or elsewhere in the portal.
      </p>

      <div className="mt-6 space-y-4">
        {isLoading && (
          <p className="text-[13px] text-muted-foreground">Loading…</p>
        )}
        {!isLoading && leads && leads.length === 0 && (
          <p className="text-[13px] text-muted-foreground">No leads yet.</p>
        )}
        {(leads ?? []).map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onSetStatus={(status) => statusMut.mutate({ id: lead.id, status })}
            busy={statusMut.isPending}
          />
        ))}
      </div>
    </Container>
  );
}

function LeadCard({
  lead,
  onSetStatus,
  busy,
}: {
  lead: IntensiveLead;
  onSetStatus: (status: string) => void;
  busy: boolean;
}) {
  const when = new Date(lead.created_at).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const statusTone =
    lead.status === "Won"
      ? "bg-emerald-100 text-emerald-900 border-emerald-200"
      : lead.status === "Lost"
        ? "bg-zinc-100 text-zinc-700 border-zinc-200"
        : lead.status === "Contacted"
          ? "bg-amber-100 text-amber-900 border-amber-200"
          : "bg-blue-100 text-blue-900 border-blue-200";

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-display text-lg">
              {lead.full_name || lead.email || "Unknown member"}
            </p>
            <Badge variant="outline" className={statusTone}>
              {lead.status}
            </Badge>
          </div>
          {lead.email && (
            <p className="mt-1 inline-flex items-center gap-1 text-[12px] text-muted-foreground">
              <Mail className="h-3 w-3" />
              <a
                href={`mailto:${lead.email}?subject=Six-Week Intensive`}
                className="hover:text-foreground"
              >
                {lead.email}
              </a>
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            Captured {when}
            {lead.thread_title ? ` · from “${lead.thread_title}”` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["Open", "Contacted", "Won", "Lost"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={lead.status === s ? "default" : "outline"}
              disabled={busy || lead.status === s}
              onClick={() => onSetStatus(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </div>

      {lead.note && (
        <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-[13px]">
          <p className="label-mono mb-1">Note</p>
          {lead.note}
        </div>
      )}

      {lead.recent_messages.length > 0 && (
        <div className="mt-4">
          <p className="label-mono mb-2">Thread context</p>
          <div className="space-y-2">
            {lead.recent_messages.slice(-4).map((m, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-background p-3"
              >
                <p className="label-mono mb-1">{m.role}</p>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed">
                  {m.content.length > 800
                    ? m.content.slice(0, 800) + "…"
                    : m.content}
                </p>
              </div>
            ))}
          </div>
          {lead.thread_id && (
            <Link
              to="/ask/$threadId"
              params={{ threadId: lead.thread_id }}
              className="mt-2 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              Open full thread <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
