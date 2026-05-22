// Deep-link entry from the external AOS app. The AOS subdomain doesn't have
// access to this portal's Stripe, so its "Add seats" / "Add workspace"
// buttons link here. We open the add-capacity modal immediately; on
// checkout success, the existing webhook updates aos_addons and Stripe
// returns the user to the AOS app via the `return_to` allowlist
// (handled inside createAosAddonCheckout / return-to.ts).

import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTier } from "@/hooks/use-tier";
import { useAosLimits } from "@/hooks/use-aos-limits";
import { AosAddonsModal } from "@/components/portal/aos-addons-modal";
import { isAllowedReturnTo, RETURN_TO_STORAGE_KEY } from "@/lib/return-to";

export const Route = createFileRoute("/aos/add-capacity")({
  validateSearch: (search: Record<string, unknown>) => ({
    kind:
      search.kind === "seat" || search.kind === "workspace"
        ? (search.kind as "seat" | "workspace")
        : undefined,
    return_to: typeof search.return_to === "string" ? search.return_to : undefined,
  }),
  head: () => ({
    meta: [{ title: "Add AOS capacity" }],
  }),
  component: AddCapacityPage,
});

function AddCapacityPage() {
  const navigate = useNavigate();
  const { return_to } = Route.useSearch();
  const { isBookBuyer, loading: tierLoading } = useTier();
  const { hasAccess, loading: limitsLoading } = useAosLimits();

  // Persist return_to so createAosAddonCheckout can pick it up.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const allowed = isAllowedReturnTo(return_to);
    if (allowed) {
      try {
        window.sessionStorage.setItem(RETURN_TO_STORAGE_KEY, allowed);
      } catch {}
    }
  }, [return_to]);

  const loading = tierLoading || limitsLoading;

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        AOS · Add capacity
      </p>
      <h1 className="mt-3 font-display text-3xl tracking-tight">
        Add seats or workspaces
      </h1>
      <p className="mt-3 text-[14px] text-muted-foreground">
        Coming from AOS. Use the dialog to add capacity — you'll be returned to
        your workspace after checkout.
      </p>

      {!loading && isBookBuyer && hasAccess ? (
        <AosAddonsModal open onOpenChange={(o) => !o && navigate({ to: "/aos" })} />
      ) : !loading ? (
        <p className="mt-6 text-[13px] text-foreground/70">
          Your current plan already includes the capacity you need. Head back to{" "}
          <button
            type="button"
            onClick={() => navigate({ to: "/aos" })}
            className="text-signal underline-offset-4 hover:underline"
          >
            AOS
          </button>
          .
        </p>
      ) : null}
    </div>
  );
}
