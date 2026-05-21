// Admin-only "View as tier" switcher. Purely visual: flips the UI gates
// (sidebar nav, /upgrade cards, replay shelves) via sessionStorage. RLS
// still applies to the real admin user, so any actual data writes happen
// as the admin, not the impersonated tier.

import { Eye } from "lucide-react";
import { useTier, type Tier } from "@/hooks/use-tier";
import { setImpersonatedTier } from "@/lib/tier-impersonation";

const TIERS: { value: Tier | ""; label: string }[] = [
  { value: "", label: "Real (admin)" },
  { value: "aos_only", label: "AOS only" },
  { value: "book_buyer", label: "Book buyer" },
  { value: "power_hour", label: "Power Hour" },
  { value: "sm_school", label: "S&M School" },
  { value: "contractor_school", label: "Contractor School" },
  { value: "intensive", label: "Intensive grad" },
  { value: "circle", label: "Circle" },
  { value: "hardcore", label: "Hardcore" },
];

export function TierImpersonator({ collapsed }: { collapsed?: boolean }) {
  const { tier, impersonating } = useTier();

  if (collapsed) {
    return (
      <div
        className="grid place-items-center py-2"
        title={impersonating ? `Viewing as: ${tier}` : "View as tier"}
      >
        <Eye
          className={`h-3.5 w-3.5 ${impersonating ? "text-signal" : "text-muted-foreground"}`}
        />
      </div>
    );
  }

  return (
    <div className="rounded-md bg-foreground/[0.03] px-2.5 py-2">
      <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
        <Eye className="h-3 w-3" />
        <span>View as</span>
        {impersonating && (
          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-signal" />
        )}
      </div>
      <select
        value={impersonating ? (tier as string) : ""}
        onChange={(e) =>
          setImpersonatedTier((e.target.value || null) as Tier | null)
        }
        className="mt-1 w-full rounded border border-border/60 bg-background px-1.5 py-1 text-[11px] text-foreground/85 focus:outline-none focus:ring-1 focus:ring-signal"
      >
        {TIERS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}
