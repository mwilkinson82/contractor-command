// Admin · QA — per-tier access matrix.
//
// One screen that answers: "If a person buys X, what do they see?"
// Pure derivation from the same gate config the app uses, so if the matrix
// is wrong, the app is wrong. Click a tier row to impersonate and check it
// live in another tab.

import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  X,
  Eye,
  ExternalLink,
} from "lucide-react";
import { Container } from "@/components/portal/page-header";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { type Tier } from "@/hooks/use-tier";
import { setImpersonatedTier } from "@/lib/tier-impersonation";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/qa")({
  head: () => ({ meta: [{ title: "Tier QA — Admin" }] }),
  component: QaPage,
});

// Keep this list in lock-step with ROUTE_TIER_GATES in src/routes/__root.tsx.
// If you change a gate there, change it here too.
const SURFACES: { path: string; label: string; min: Tier | null }[] = [
  { path: "/", label: "Home", min: null },
  { path: "/handbook", label: "Handbook", min: null },
  { path: "/aos", label: "AOS", min: null },
  { path: "/ask", label: "Ask Marshall", min: "book_buyer" },
  { path: "/tools", label: "Tools", min: "book_buyer" },
  { path: "/field-tools", label: "Field tools", min: "book_buyer" },
  { path: "/vault", label: "Vault", min: "book_buyer" },
  { path: "/community", label: "Community", min: "power_hour" },
  { path: "/templates", label: "Templates", min: "circle" },
  { path: "/calls", label: "Calls", min: "circle" },
  { path: "/replays", label: "Replays", min: "book_buyer" },
  { path: "/hardcore", label: "Hardcore Room", min: "hardcore" },
];

const TIERS: { value: Tier; label: string; sells: string }[] = [
  { value: "aos_only", label: "AOS only", sells: "AOS subscription" },
  { value: "book_buyer", label: "Book buyer", sells: "ALP Handbook" },
  { value: "intensive", label: "Intensive grad", sells: "6-week intensive" },
  { value: "power_hour", label: "Power Hour", sells: "Power Hour membership" },
  { value: "sm_school", label: "S&M School", sells: "S&M School" },
  { value: "contractor_school", label: "Contractor School", sells: "Contractor School" },
  { value: "circle", label: "Circle", sells: "Circle membership" },
  { value: "hardcore", label: "Hardcore", sells: "Hardcore Room" },
];

const RANK: Record<Tier, number> = {
  aos_only: 0,
  book_buyer: 1,
  intensive: 3,
  power_hour: 4,
  sm_school: 4,
  contractor_school: 4,
  circle: 4,
  hardcore: 5,
};

function canAccess(tier: Tier, min: Tier | null): boolean {
  if (!min) return true;
  return RANK[tier] >= RANK[min];
}

function QaPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAdmin === false) navigate({ to: "/" });
  }, [isAdmin, navigate]);

  if (isAdmin === null) {
    return (
      <Container className="py-10">
        <p className="text-sm text-muted-foreground">Checking access…</p>
      </Container>
    );
  }
  if (!isAdmin) return null;

  function impersonateAndOpen(tier: Tier, path: string) {
    setImpersonatedTier(tier);
    toast.success(`Impersonating ${tier}`, { description: `Opening ${path}` });
    window.open(path, "_blank", "noopener");
  }

  return (
    <Container className="py-10">
      <Link
        to="/admin"
        className="inline-flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to admin
      </Link>

      <div className="mt-6 border-b border-border pb-6">
        <p className="label-mono">Admin · QA</p>
        <h1 className="mt-2 font-display text-3xl">Per-tier access matrix.</h1>
        <p className="mt-2 max-w-2xl text-[14px] text-muted-foreground">
          Each cell = what someone on that tier sees when they hit that route.
          Click <Eye className="-mt-0.5 inline h-3 w-3" /> on a tier to start
          impersonating, or any cell to open it in a new tab as that tier.
        </p>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Source: <code className="rounded bg-muted/60 px-1">ROUTE_TIER_GATES</code> in <code>src/routes/__root.tsx</code>.
          Change a gate there → update this page in the same edit.
        </p>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left">Tier</th>
              <th className="px-3 py-2 text-left">Sells</th>
              {SURFACES.map((s) => (
                <th key={s.path} className="px-2 py-2 text-center">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-[9px] normal-case opacity-70">
                    {s.min ? `≥ ${s.min}` : "open"}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIERS.map((t) => (
              <tr key={t.value} className="border-t border-border">
                <td className="sticky left-0 z-10 bg-card px-3 py-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      title={`Impersonate ${t.label}`}
                      onClick={() => {
                        setImpersonatedTier(t.value);
                        toast.success(`Now impersonating ${t.label}`);
                      }}
                      className="rounded-md border border-border bg-background p-1 hover:bg-muted"
                    >
                      <Eye className="h-3 w-3" />
                    </button>
                    <span className="font-medium">{t.label}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{t.sells}</td>
                {SURFACES.map((s) => {
                  const ok = canAccess(t.value, s.min);
                  return (
                    <td key={s.path} className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => impersonateAndOpen(t.value, s.path)}
                        title={`Open ${s.path} as ${t.label}`}
                        className={`inline-flex items-center justify-center rounded p-1 hover:bg-muted ${
                          ok ? "text-emerald-700" : "text-red-600"
                        }`}
                      >
                        {ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ExternalLink className="h-3 w-3" /> Tip: open the cell in a new tab,
        then verify the sidebar groups and the upgrade prompts match the cell.
      </p>

      <div className="mt-2 rounded-md bg-foreground/[0.03] p-3 text-[12px] text-muted-foreground">
        Stop impersonating from the left-rail "View as" dropdown (set to
        <span className="ml-1 font-mono">Real (admin)</span>).
      </div>
    </Container>
  );
}
