import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { supabase } from "@/integrations/supabase/client";
import { getAdminMetrics, type AdminMetrics } from "@/lib/admin.functions";
import {
  listAdminUsers,
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
  Shield,
} from "lucide-react";

export const Route = createFileRoute("/admin/")({
  head: () => ({ meta: [{ title: "Admin dashboard — ALP Contractor Circle" }] }),
  component: AdminDashboard,
});

type PresenceUser = { user_id: string; email: string | null; at: string };

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

  // Live presence — admin subscribes to the same channel every signed-in
  // member is tracking themselves on.
  const [online, setOnline] = useState<PresenceUser[]>([]);
  useEffect(() => {
    if (!isAdmin) return;
    // The root layout already subscribes every signed-in member to the
    // "portal-presence" topic. supabase-js caches channels by topic, so we
    // can't attach new presence listeners here without hitting
    // "cannot add presence callbacks after subscribe". Instead, find the
    // existing channel and poll its presenceState.
    function read() {
      const existing = supabase
        .getChannels()
        .find((c) => c.topic === "realtime:portal-presence");
      if (!existing) {
        setOnline([]);
        return;
      }
      const state = existing.presenceState() as Record<string, PresenceUser[]>;
      const flat: PresenceUser[] = [];
      const seen = new Set<string>();
      for (const arr of Object.values(state)) {
        for (const p of arr) {
          if (seen.has(p.user_id)) continue;
          seen.add(p.user_id);
          flat.push(p);
        }
      }
      setOnline(flat);
    }
    read();
    const id = window.setInterval(read, 5000);
    return () => window.clearInterval(id);
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
}: {
  label: string;
  value: number | undefined;
  note: string;
  loading?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="label-mono inline-flex items-center gap-1.5">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-3 font-display text-3xl">{loading ? "…" : value ?? 0}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{note}</p>
    </div>
  );
}

function formatUSD(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
