// Admin · People — unified identity view + one-click repair.
//
// One row per *person* (deduped across profiles, auth.users, subscriptions,
// pending_claims). Shows what's broken with red badges and lets you fix it
// in place without hunting through 4 tables.

import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Search,
  Wrench,
  Link as LinkIcon,
  Send,
  RotateCcw,
  Layers,
  ShieldCheck,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  auditPeople,
  repairPerson,
  mintSignInLink,
  type PeopleAudit,
  type PersonRow,
  type PersonIssue,
} from "@/lib/admin-people.functions";


type RepairAction =
  | "link_subscriptions"
  | "claim_pending"
  | "send_reset"
  | "send_invite"
  | "dedupe_subscriptions";

export const Route = createFileRoute("/admin/people")({
  head: () => ({ meta: [{ title: "People — Admin" }] }),
  component: PeoplePage,
});

const ISSUE_LABEL: Record<PersonIssue, string> = {
  no_auth_account: "No account",
  never_signed_in: "Never signed in",
  email_unconfirmed: "Email unconfirmed",
  subscription_unlinked: "Sub not linked",
  tier_disagrees: "Tier mismatch",
  duplicate_subscriptions: "Duplicate subs",
  unclaimed_pending_claim: "Unclaimed claim",
  no_company: "No company",
};

const ISSUE_TONE: Record<PersonIssue, string> = {
  no_auth_account: "bg-amber-100 text-amber-800",
  never_signed_in: "bg-amber-50 text-amber-700",
  email_unconfirmed: "bg-amber-50 text-amber-700",
  subscription_unlinked: "bg-red-100 text-red-700",
  tier_disagrees: "bg-red-100 text-red-700",
  duplicate_subscriptions: "bg-red-100 text-red-700",
  unclaimed_pending_claim: "bg-amber-50 text-amber-700",
  no_company: "bg-foreground/5 text-muted-foreground",
};

type Filter = "all" | "issues" | "duplicates" | "unlinked" | "never_in";

function PeoplePage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const audit = useServerFn(auditPeople);
  const repair = useServerFn(repairPerson);
  const qc = useQueryClient();

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  const { data, isLoading } = useQuery<PeopleAudit>({
    queryKey: ["admin-people"],
    queryFn: () => audit(),
    enabled: !!isAdmin,
  });

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("issues");
  const [busy, setBusy] = useState<string | null>(null);

  const repairMut = useMutation({
    mutationFn: async (input: { email: string; actions: RepairAction[] }) =>
      repair({ data: input }),
    onMutate: ({ email }) => setBusy(email),
    onSettled: () => setBusy(null),
    onSuccess: (res) => {
      const ok = res.performed.length;
      const errs = res.errors.length;
      if (errs > 0) toast.error(`${res.email}: ${res.errors.join("; ")}`);
      if (ok > 0) toast.success(`${res.email}: ${res.performed.join(" ")}`);
      if (ok === 0 && errs === 0) toast.message(`${res.email}: nothing to do`);
      qc.invalidateQueries({ queryKey: ["admin-people"] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Repair failed"),
  });

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    return (data?.people ?? []).filter((p) => {
      if (filter === "issues" && p.issues.length === 0) return false;
      if (filter === "duplicates" && p.subscriptionCount <= 1) return false;
      if (filter === "unlinked" && !p.issues.includes("subscription_unlinked")) return false;
      if (filter === "never_in" && (!p.authUserId || p.lastSignInAt)) return false;
      if (!text) return true;
      return p.email.includes(text) || (p.fullName ?? "").toLowerCase().includes(text);
    });
  }, [data, q, filter]);

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
        <p className="label-mono">Admin · People</p>
        <h1 className="mt-2 font-display text-3xl">
          One row per person. Every issue, visible.
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] text-muted-foreground">
          Profiles, auth accounts, subscriptions and pending claims merged by
          email. Each row shows what's broken and what to do about it.
        </p>
      </div>

      {/* Totals */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="People" value={data?.totals.people} loading={isLoading} />
        <Stat label="With issues" value={data?.totals.withIssues} loading={isLoading} tone="warn" />
        <Stat label="Duplicates" value={data?.totals.duplicates} loading={isLoading} tone="bad" />
        <Stat label="Orphan subs" value={data?.totals.unlinkedSubs} loading={isLoading} tone="bad" />
        <Stat label="Pending claims" value={data?.totals.pendingClaims} loading={isLoading} />
      </div>

      {/* Mint a sign-in link for ANY auth user, even if they're not in this list
          (no subscription / claim yet). Useful for triaging "can't log in" reports. */}
      <MintByEmail />

      {/* Filters */}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by email or name…"
            className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-2 text-[13px] focus:border-ink focus:outline-none"
          />
        </div>
        {(
          [
            ["issues", "Issues only"],
            ["duplicates", "Duplicates"],
            ["unlinked", "Orphan subs"],
            ["never_in", "Never signed in"],
            ["all", "All people"],
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-md border px-3 py-1.5 text-[11px] ${
              filter === k
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-[2fr_1fr_1.4fr_1.6fr] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Person</span>
          <span>Tier · subs</span>
          <span>Issues</span>
          <span>Repair</span>
        </div>
        {isLoading ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-6 text-[13px] text-muted-foreground">
            Nothing here. Try a different filter.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((p) => (
              <PersonRowItem
                key={p.key}
                person={p}
                busy={busy === p.email}
                onRepair={(actions) => repairMut.mutate({ email: p.email, actions })}
              />
            ))}
          </ul>
        )}
      </div>
    </Container>
  );
}

function Stat({
  label,
  value,
  loading,
  tone,
}: {
  label: string;
  value: number | undefined;
  loading?: boolean;
  tone?: "warn" | "bad";
}) {
  const cls =
    tone === "bad"
      ? "text-red-700"
      : tone === "warn"
        ? "text-amber-700"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="label-mono">{label}</p>
      <p className={`mt-1 font-display text-2xl ${cls}`}>
        {loading ? "…" : (value ?? 0)}
      </p>
    </div>
  );
}

function PersonRowItem({
  person,
  busy,
  onRepair,
}: {
  person: PersonRow;
  busy: boolean;
  onRepair: (actions: ("link_subscriptions" | "claim_pending" | "send_reset" | "send_invite" | "dedupe_subscriptions")[]) => void;
}) {
  const hasAuth = !!person.authUserId;
  const ok = person.issues.length === 0;

  // Suggest the smallest sensible action set for this person.
  const suggested: Parameters<typeof onRepair>[0] = [];
  if (person.issues.includes("subscription_unlinked") && hasAuth) suggested.push("link_subscriptions");
  if (person.issues.includes("unclaimed_pending_claim") && hasAuth) suggested.push("claim_pending");
  if (person.issues.includes("duplicate_subscriptions")) suggested.push("dedupe_subscriptions");
  if (person.issues.includes("no_auth_account")) suggested.push("send_invite");

  return (
    <li className="grid grid-cols-[2fr_1fr_1.4fr_1.6fr] items-start gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-mono text-[13px]">{person.email}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {person.fullName ?? "—"}
          {person.isAdmin ? <span className="ml-2 text-signal">admin</span> : null}
          {person.lastSignInAt
            ? <span className="ml-2">· last in {new Date(person.lastSignInAt).toLocaleDateString()}</span>
            : hasAuth ? <span className="ml-2">· account not used yet</span> : null}
        </p>
      </div>
      <div className="text-[12px]">
        <p className="font-medium">{person.tier ?? "—"}</p>
        <p className="text-[11px] text-muted-foreground">
          {person.subscriptionCount} sub{person.subscriptionCount === 1 ? "" : "s"}
          {person.isComped ? " · comped" : ""}
          {person.hasActiveSubscription ? "" : " · inactive"}
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {ok ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> Clean
          </span>
        ) : (
          person.issues.map((i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${ISSUE_TONE[i]}`}
            >
              <AlertTriangle className="h-3 w-3" /> {ISSUE_LABEL[i]}
            </span>
          ))
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {hasAuth && <MintLinkButton email={person.email} />}
        {ok ? (
          <span className="text-[11px] text-muted-foreground">No action needed</span>
        ) : (
          <>
            {suggested.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRepair(suggested)}
                className="inline-flex items-center gap-1.5 rounded-md bg-ink px-2.5 py-1.5 text-[11px] font-medium text-cream hover:opacity-90 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Wrench className="h-3 w-3" />
                )}
                Repair ({suggested.length})
              </button>
            )}
            <RepairMenu disabled={busy} hasAuth={hasAuth} onPick={(a) => onRepair([a])} />
          </>
        )}
      </div>

    </li>
  );
}

function RepairMenu({
  disabled,
  hasAuth,
  onPick,
}: {
  disabled: boolean;
  hasAuth: boolean;
  onPick: (a: "link_subscriptions" | "claim_pending" | "send_reset" | "send_invite" | "dedupe_subscriptions") => void;
}) {
  const opts: { id: Parameters<typeof onPick>[0]; label: string; icon: React.ComponentType<{ className?: string }>; needsAuth?: boolean }[] = [
    { id: "link_subscriptions", label: "Link orphan subs", icon: LinkIcon, needsAuth: true },
    { id: "claim_pending", label: "Claim pending", icon: ShieldCheck, needsAuth: true },
    { id: "dedupe_subscriptions", label: "Dedupe subs", icon: Layers },
    { id: "send_reset", label: "Send reset", icon: RotateCcw, needsAuth: true },
    { id: "send_invite", label: "Send invite", icon: Send },
  ];
  return (
    <div className="relative">
      <details className="group">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-[11px] hover:bg-muted">
          More…
        </summary>
        <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-border bg-card p-1 shadow-md">
          {opts.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={disabled || (o.needsAuth && !hasAuth)}
              onClick={(e) => {
                (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
                onPick(o.id);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-muted disabled:opacity-40"
            >
              <o.icon className="h-3 w-3" />
              {o.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}

function MintLinkButton({ email }: { email: string }) {
  const mint = useServerFn(mintSignInLink);
  const [busy, setBusy] = useState(false);
  async function copyLink() {
    setBusy(true);
    try {
      const res = await mint({ data: { email, type: "magiclink" } });
      await navigator.clipboard.writeText(res.url);
      toast.success("Sign-in link copied", {
        description: `One-time link for ${email}. Paste into a text or DM.`,
      });
    } catch (e: any) {
      toast.error("Couldn't mint link", { description: e?.message ?? "Unknown error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={copyLink}
      title="Copy a one-time sign-in URL for this member"
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}
      Copy sign-in link
    </button>
  );
}
