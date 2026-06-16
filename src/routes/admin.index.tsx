import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";

import { subscribePresence, type PresenceUser } from "@/lib/portal-presence";
import { getAdminMetrics, type AdminMetrics } from "@/lib/admin.functions";
import {
  listIntensiveLeads,
  setIntensiveLeadStatus,
  type IntensiveLead,
} from "@/lib/intensive-leads.functions";
import {
  listAdminUsers,
  sendMemberAccessLink,
  setUserComped,
  type AdminUserRow,
} from "@/lib/admin-users.functions";
import { Input } from "@/components/ui/input";
import {
  Users,
  Inbox,
  Library,
  CircleDollarSign,
  Activity,
  Sparkles,
  MessageSquare,
  TrendingUp,
  Search,
  Gift,
  CreditCard,
  Mail,
  Shield,
} from "lucide-react";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Admin dashboard — ALP Contractor Circle" }] }),
  component: AdminDashboard,
});



function AdminDashboard() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const fetchMetrics = useServerFn(getAdminMetrics);

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const { data: metrics, isLoading } = useQuery<AdminMetrics>({
    queryKey: ["admin-metrics"],
    queryFn: () => fetchMetrics(),
    enabled: !!isAdmin,
    refetchInterval: 60_000,
  });

  // Live presence — read from the shared store populated in __root.tsx,
  // which attaches the presence "sync" listener on the portal channel.
  const [online, setOnline] = useState<PresenceUser[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    return subscribePresence(setOnline);
  }, [isAdmin]);

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
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <p className="label-mono">Admin · Dashboard</p>
          <h1
            className="mt-2 font-display text-3xl"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Operator's overview
          </h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Who's inside the portal, what's earning, and what needs your attention.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/email-approvals"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] text-amber-900 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
          >
            Email approvals
          </Link>
          <Link
            to="/admin/announce"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            Announce
          </Link>
          <Link
            to="/admin/topics"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            Topics
          </Link>
          <Link
            to="/admin/library"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            Library
          </Link>
          <Link
            to="/admin/people"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            People
          </Link>
          <Link
            to="/admin/qa"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            Tier QA
          </Link>
          <Link
            to="/admin/handbook"
            className="rounded-md border border-foreground bg-foreground px-3 py-1.5 text-[12px] text-background hover:opacity-90"
          >
            Handbook rollout
          </Link>
          <Link
            to="/admin/migrate"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            Migrate
          </Link>
          <Link
            to="/admin/backfill"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-muted"
          >
            Book backfill
          </Link>
        </div>
      </div>

      {/* Top row: live + revenue */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <OnlineNowCard online={online} />
        <MrrCard metrics={metrics} loading={isLoading} />
        <IntensiveCard metrics={metrics} loading={isLoading} />
      </div>

      {/* Members */}
      <Section title="Membership" icon={Users}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total subscribers" value={metrics?.members.total} loading={isLoading} />
          <Stat label="Active" value={metrics?.members.active} loading={isLoading} accent="signal" />
          <Stat label="Founding" value={metrics?.members.founding} loading={isLoading} accent="gold" />
          <Stat label="Comped" value={metrics?.members.comped} loading={isLoading} />
          <Stat label="Trialing" value={metrics?.members.trialing} loading={isLoading} />
          <Stat label="Canceled" value={metrics?.members.canceled} loading={isLoading} />
          <Stat label="New · last 7 days" value={metrics?.signups.last7} loading={isLoading} />
          <Stat label="New · last 30 days" value={metrics?.signups.last30} loading={isLoading} />
        </div>
      </Section>

      {/* Members directory */}
      <MembersDirectory online={online} />

      {/* Library & topics */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <LibraryCard metrics={metrics} loading={isLoading} />
        <TopicsCard metrics={metrics} loading={isLoading} />
      </div>

      {/* Funnel signals */}
      <Section title="Funnel signals" icon={TrendingUp}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SignalCard
            label="Intensive leads (Vault)"
            value={metrics?.intensiveLeads}
            loading={isLoading}
            note="Members who tapped Six-Week Intensive somewhere in the portal."
            icon={Sparkles}
          />
          <SignalCard
            label="Billing questions"
            value={metrics?.billingQuestions}
            loading={isLoading}
            note="Submitted from Account · Billing."
            icon={MessageSquare}
          />
        </div>

        {/* Inline intensive leads list */}
        <IntensiveLeadsInline enabled={!!isAdmin} />
      </Section>
    </Container>
  );
}

/* ----------------- pieces ----------------- */

function OnlineNowCard({ online }: { online: PresenceUser[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="label-mono inline-flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-signal" /> Online now
        </p>
        <span className="relative inline-flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-signal" />
        </span>
      </div>
      <p className="mt-3 font-display text-4xl">{online.length}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        member{online.length === 1 ? "" : "s"} in the portal right now
      </p>
      {online.length > 0 && (
        <ul className="mt-3 max-h-32 space-y-1 overflow-auto text-[11px] text-muted-foreground">
          {online.slice(0, 12).map((u) => (
            <li key={u.user_id} className="truncate font-mono">
              {u.email ?? u.user_id.slice(0, 8)}
            </li>
          ))}
          {online.length > 12 && (
            <li className="italic">+ {online.length - 12} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

function MrrCard({ metrics, loading }: { metrics?: AdminMetrics; loading: boolean }) {
  const mrr = metrics?.revenue.mrrCents ?? 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="label-mono inline-flex items-center gap-1.5">
        <CircleDollarSign className="h-3 w-3" /> Monthly recurring revenue
      </p>
      <p className="mt-3 font-display text-4xl">
        {loading ? "…" : formatUSD(mrr)}
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {metrics?.revenue.activeSubscriptionsCount ?? 0} active Stripe subscription
        {metrics?.revenue.activeSubscriptionsCount === 1 ? "" : "s"}
      </p>
      {metrics && !metrics.revenue.stripeAvailable && (
        <p className="mt-3 rounded-md bg-foreground/5 px-2 py-1.5 text-[10px] text-muted-foreground">
          Stripe key not configured — showing zeros.
        </p>
      )}
    </div>
  );
}

function IntensiveCard({ metrics, loading }: { metrics?: AdminMetrics; loading: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="label-mono inline-flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-gold" /> Six-Week Intensive
      </p>
      <p className="mt-3 font-display text-4xl">
        {loading ? "…" : formatUSD(metrics?.revenue.intensiveLast30Cents ?? 0)}
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {metrics?.revenue.intensiveLast30Count ?? 0} enrolled · last 30 days
      </p>
      <p className="mt-3 text-[11px] text-muted-foreground">
        All-time:{" "}
        <span className="font-medium text-foreground">
          {formatUSD(metrics?.revenue.intensiveAllTimeCents ?? 0)}
        </span>{" "}
        · {metrics?.revenue.intensiveAllTimeCount ?? 0} enrolled
      </p>
    </div>
  );
}

function LibraryCard({ metrics, loading }: { metrics?: AdminMetrics; loading: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="label-mono inline-flex items-center gap-1.5">
          <Library className="h-3 w-3" /> Library
        </p>
        <Link
          to="/admin/library"
          className="rounded-md border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
        >
          Manage
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat
          label="Templates"
          value={metrics?.library.templates}
          sub={
            metrics
              ? `${metrics.library.templatesPublished} published`
              : undefined
          }
          loading={loading}
        />
        <Stat
          label="Replays"
          value={metrics?.library.replays}
          sub={
            metrics
              ? `${metrics.library.replaysPublished} published`
              : undefined
          }
          loading={loading}
        />
      </div>
    </div>
  );
}

function TopicsCard({ metrics, loading }: { metrics?: AdminMetrics; loading: boolean }) {
  const pending = metrics?.topics.pending ?? 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="label-mono inline-flex items-center gap-1.5">
          <Inbox className="h-3 w-3" /> Call topics
        </p>
        <Link
          to="/admin/topics"
          className="rounded-md border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
        >
          Review
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat
          label="Pending"
          value={pending}
          loading={loading}
          accent={pending > 0 ? "gold" : undefined}
        />
        <Stat label="Selected" value={metrics?.topics.selected} loading={loading} />
      </div>
      {pending > 0 && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          {pending} submission{pending === 1 ? "" : "s"} waiting for review.
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="label-mono inline-flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  loading,
  accent,
}: {
  label: string;
  value: number | undefined;
  sub?: string;
  loading?: boolean;
  accent?: "signal" | "gold";
}) {
  const accentCls =
    accent === "signal"
      ? "text-signal"
      : accent === "gold"
      ? "text-gold"
      : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="label-mono">{label}</p>
      <p className={`mt-2 font-display text-2xl ${accentCls}`}>
        {loading ? "…" : value ?? 0}
      </p>
      {sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SignalCard({
  label,
  value,
  note,
  loading,
  icon: Icon,
  href,
}: {
  label: string;
  value: number | undefined;
  note: string;
  loading?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
}) {
  const body = (
    <>
      <p className="label-mono inline-flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-3 font-display text-3xl">{loading ? "…" : value ?? 0}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{note}</p>
      {href && (
        <p className="mt-2 text-[11px] text-muted-foreground underline">
          View list →
        </p>
      )}
    </>
  );
  if (href) {
    return (
      <Link
        to={href}
        className="block rounded-2xl border border-border bg-card p-5 transition hover:border-foreground/30"
      >
        {body}
      </Link>
    );
  }
  return <div className="rounded-2xl border border-border bg-card p-5">{body}</div>;
}

function formatUSD(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/* ----------------- members directory ----------------- */

type FilterKey =
  | "all"
  | "paid"
  | "comped"
  | "active"
  | "canceled"
  | "founding"
  | "never_signed_in"
  | "not_activated"
  | "no_account";


function MembersDirectory({ online }: { online: PresenceUser[] }) {
  const fetchUsers = useServerFn(listAdminUsers);
  const compMutation = useServerFn(setUserComped);
  const sendAccessLink = useServerFn(sendMemberAccessLink);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const { data: users, isLoading } = useQuery<AdminUserRow[]>({
    queryKey: ["admin-users"],
    queryFn: () => fetchUsers(),
  });

  const onlineSet = useMemo(
    () => new Set(online.map((o) => o.user_id)),
    [online],
  );

  const mut = useMutation({
    mutationFn: (input: {
      subscriptionId: string | null;
      userId: string | null;
      email: string;
      isComped: boolean;
    }) => compMutation({ data: input }),
    onSuccess: (_d, vars) => {
      toast.success(vars.isComped ? "Marked as comped." : "Removed comp.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-metrics"] });
    },
    onError: (err: Error) => toast.error(err.message ?? "Could not update."),
  });

  const accessMut = useMutation({
    mutationFn: (email: string) => sendAccessLink({ data: { email } }),
    onSuccess: (res, email) => {
      toast.success(res.action === "reset_sent" ? "Reset link sent." : "Invite link sent.", {
        description: email,
      });
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (err: Error) => toast.error(err.message ?? "Could not send access link."),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (users ?? []).filter((u) => {
      const sub = u.subscription;
      if (filter === "paid" && !(sub && !sub.isComped && sub.status === "active")) return false;
      if (filter === "comped" && !sub?.isComped) return false;
      if (filter === "active" && sub?.status !== "active") return false;
      if (filter === "canceled" && sub?.status !== "canceled") return false;
      if (filter === "founding" && !sub?.isFounding) return false;
      if (filter === "never_signed_in" && (!u.hasAuthAccount || u.lastSignInAt)) return false;
      if (filter === "not_activated" && (!u.hasAuthAccount || u.emailConfirmedAt)) return false;
      if (filter === "no_account" && u.hasAuthAccount) return false;
      if (!q) return true;
      return (
        u.email.toLowerCase().includes(q) ||
        (u.fullName ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, query, filter]);


  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="label-mono inline-flex items-center gap-1.5">
          <Users className="h-3 w-3" /> Members directory
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or email…"
              className="h-8 w-64 pl-7 text-[12px]"
            />
          </div>
          <FilterPills value={filter} onChange={setFilter} />
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-[1.5fr_1fr_0.8fr_0.8fr_1.25fr] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Member</span>
          <span>Activity</span>
          <span>Subscription</span>
          <span>Status</span>
          <span className="text-right">Comped</span>
        </div>

        {isLoading ? (
          <p className="px-4 py-6 text-[12px] text-muted-foreground">Loading members…</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-6 text-[12px] text-muted-foreground">No members match.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((u) => {
              const sub = u.subscription;
              const live = onlineSet.has(u.id);
              const busy = mut.isPending && mut.variables?.email === u.email;
              return (
                <li
                  key={u.id + (sub?.id ?? "")}
                  className="grid grid-cols-[1.5fr_1fr_0.8fr_0.8fr_1.25fr] items-center gap-3 px-4 py-3 text-[13px]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">
                        {u.fullName ?? u.email.split("@")[0]}
                      </span>
                      {live && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-signal/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-signal">
                          <span className="h-1.5 w-1.5 rounded-full bg-signal" />
                          Online
                        </span>
                      )}
                      {u.isAdmin && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider">
                          <Shield className="h-2.5 w-2.5" /> Admin
                        </span>
                      )}
                      {sub?.isFounding && (
                        <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-gold">
                          Founding
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">{u.email}</p>
                  </div>

                  <div className="text-[11px]">
                    <ActivityCell
                      hasAuthAccount={u.hasAuthAccount}
                      emailConfirmedAt={u.emailConfirmedAt}
                      lastSignInAt={u.lastSignInAt}
                    />
                  </div>

                  <div className="text-[12px]">
                    {sub ? (
                      sub.isComped ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Gift className="h-3 w-3" /> Comped
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-foreground">
                          <CreditCard className="h-3 w-3" /> Paid (MRR)
                        </span>
                      )
                    ) : (
                      <span className="text-muted-foreground">No subscription</span>
                    )}
                  </div>

                  <div className="text-[12px]">
                    <StatusPill status={sub?.status ?? null} cancelAtEnd={sub?.cancelAtPeriodEnd} />
                  </div>


                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      disabled={accessMut.isPending && accessMut.variables === u.email}
                      onClick={() => accessMut.mutate(u.email)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] transition hover:bg-muted disabled:opacity-50"
                    >
                      <Mail className="h-3 w-3" />
                      {accessMut.isPending && accessMut.variables === u.email ? "Sending…" : "Access link"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        mut.mutate({
                          subscriptionId: sub?.id ?? null,
                          userId: u.id.startsWith("sub:") ? null : u.id,
                          email: u.email,
                          isComped: !sub?.isComped,
                        })
                      }
                      className={`rounded-md border px-2 py-1 text-[11px] transition ${
                        sub?.isComped
                          ? "border-border bg-background hover:bg-muted"
                          : "border-foreground bg-foreground text-background hover:opacity-90"
                      } disabled:opacity-50`}
                    >
                      {busy ? "…" : sub?.isComped ? "Remove comp" : "Mark comped"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {filtered.length} member{filtered.length === 1 ? "" : "s"} shown · Paid = recurring Stripe revenue · Comped = free access granted manually.
      </p>
    </section>
  );
}

function FilterPills({
  value,
  onChange,
}: {
  value: FilterKey;
  onChange: (v: FilterKey) => void;
}) {
  const opts: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "paid", label: "Paid" },
    { key: "comped", label: "Comped" },
    { key: "active", label: "Active" },
    { key: "canceled", label: "Canceled" },
    { key: "founding", label: "Founding" },
    { key: "never_signed_in", label: "Never signed in" },
    { key: "not_activated", label: "Not activated" },
    { key: "no_account", label: "No account" },
  ];

  return (
    <div className="inline-flex rounded-full border border-border bg-background p-0.5">
      {opts.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`rounded-full px-2.5 py-1 text-[11px] transition ${
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function StatusPill({
  status,
  cancelAtEnd,
}: {
  status: string | null;
  cancelAtEnd?: boolean;
}) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const tone =
    status === "active"
      ? "bg-signal/10 text-signal"
      : status === "trialing"
      ? "bg-gold/15 text-gold"
      : status === "canceled" || status === "past_due"
      ? "bg-destructive/10 text-destructive"
      : "bg-foreground/10 text-foreground";
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${tone}`}>
        {status}
      </span>
      {cancelAtEnd && (
        <span className="text-[10px] text-muted-foreground">(ending)</span>
      )}
    </span>
  );
}

function ActivityCell({
  hasAuthAccount,
  emailConfirmedAt,
  lastSignInAt,
}: {
  hasAuthAccount: boolean;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
}) {
  if (!hasAuthAccount) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-destructive">
        No account
      </span>
    );
  }
  if (!emailConfirmedAt && !lastSignInAt) {
    return (
      <div>
        <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gold">
          Invited · not activated
        </span>
        <p className="mt-0.5 text-[10px] text-muted-foreground">No password set</p>
      </div>
    );
  }
  if (!lastSignInAt) {
    return (
      <div>
        <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
          Never signed in
        </span>
        {emailConfirmedAt && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Email confirmed {formatShortDate(emailConfirmedAt)}
          </p>
        )}
      </div>
    );
  }
  return (
    <div>
      <span className="inline-flex items-center gap-1 rounded-full bg-signal/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-signal">
        Active
      </span>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        Last sign-in {formatRelative(lastSignInAt)}
      </p>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return formatShortDate(iso);
}

/* ----------------- intensive leads (inline) ----------------- */

function IntensiveLeadsInline({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const fetchLeads = useServerFn(listIntensiveLeads);
  const updateStatus = useServerFn(setIntensiveLeadStatus);

  const { data: leads, isLoading } = useQuery<IntensiveLead[]>({
    queryKey: ["admin-intensive-leads"],
    queryFn: () => fetchLeads(),
    enabled,
  });

  const statusMut = useMutation({
    mutationFn: (vars: { id: string; status: string }) =>
      updateStatus({ data: vars }),
    onSuccess: () => {
      toast.success("Status updated");
      qc.invalidateQueries({ queryKey: ["admin-intensive-leads"] });
      qc.invalidateQueries({ queryKey: ["admin-metrics"] });
    },
    onError: (e: any) => toast.error(e?.message || "Failed"),
  });

  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="label-mono inline-flex items-center gap-1.5">
          <Sparkles className="h-3 w-3" /> Intensive leads
        </p>
        <span className="text-[11px] text-muted-foreground">
          {leads?.length ?? 0} total
        </span>
      </div>

      {isLoading && (
        <p className="mt-3 text-[12px] text-muted-foreground">Loading…</p>
      )}
      {!isLoading && (!leads || leads.length === 0) && (
        <p className="mt-3 text-[12px] text-muted-foreground">No leads yet.</p>
      )}

      <ul className="mt-3 divide-y divide-border">
        {(leads ?? []).map((lead) => (
          <li key={lead.id} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium">
                  {lead.full_name || lead.email || "Unknown member"}
                  <span className="ml-2 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {lead.status}
                  </span>
                </p>
                {lead.email && (
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    <a
                      href={`mailto:${lead.email}?subject=Six-Week Intensive`}
                      className="hover:text-foreground"
                    >
                      {lead.email}
                    </a>
                  </p>
                )}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatRelative(lead.created_at)}
                  {lead.thread_title ? ` · “${lead.thread_title}”` : ""}
                </p>
                {lead.recent_messages.length > 0 && (
                  <p className="mt-2 line-clamp-2 text-[12px] text-foreground/80">
                    {lead.recent_messages[0]?.content?.slice(0, 220)}
                    {(lead.recent_messages[0]?.content?.length ?? 0) > 220
                      ? "…"
                      : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {(["Open", "Contacted", "Won", "Lost"] as const).map((s) => (
                  <button
                    key={s}
                    disabled={statusMut.isPending || lead.status === s}
                    onClick={() =>
                      statusMut.mutate({ id: lead.id, status: s })
                    }
                    className={`rounded border px-2 py-1 text-[11px] transition disabled:cursor-default ${
                      lead.status === s
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                  >
                    {s}
                  </button>
                ))}
                <Link
                  to="/admin/intensive-leads"
                  className="rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted"
                >
                  Detail
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}


