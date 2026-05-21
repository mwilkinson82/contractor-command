// Tier-aware upgrade page. Cards filtered by viewer's tier via
// upsellsForTier(). Subscription cards with both monthly and quarterly
// plans get an inline toggle. Circle uses the legacy circle checkout
// fn; everything else goes through createSkuCheckout. Book Buyer +
// Hardcore still capture interest.

import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Loader2, type LucideIcon } from "lucide-react";
import { useTier } from "@/hooks/use-tier";
import {
  createCircleCheckout,
  createSkuCheckout,
  requestUpsellInterest,
} from "@/lib/billing.functions";
import {
  UPSELL_CATALOG,
  upsellsForTier,
  type PlanOption,
  type UpsellCard,
  type UpsellSku,
} from "@/lib/upsell-catalog";
import { toast } from "sonner";

export const Route = createFileRoute("/upgrade")({
  head: () => ({
    meta: [
      { title: "Upgrade — ALP Contractor Circle" },
      { name: "description", content: "Your next step in the ALP operating system." },
    ],
  }),
  component: UpgradePage,
});

function UpgradePage() {
  const { tier, loading } = useTier();
  const circleCheckout = useServerFn(createCircleCheckout);
  const skuCheckout = useServerFn(createSkuCheckout);
  const interest = useServerFn(requestUpsellInterest);
  const [busy, setBusy] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<UpsellSku>>(new Set());

  // Read ?upsell=cancelled banner
  const [cancelled, setCancelled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("upsell") === "cancelled") setCancelled(true);
  }, []);

  const skus = upsellsForTier(tier);

  async function handlePurchase(card: UpsellCard, plan: PlanOption) {
    setBusy(plan.id);
    try {
      if (card.checkout === "interest") {
        await interest({ data: { sku: card.sku as "book_buyer" | "hardcore" } });
        setRequested((s) => new Set(s).add(card.sku));
        toast.success("Got it — Marshall will reach out about " + card.eyebrow + ".");
        return;
      }
      if (card.sku === "circle") {
        const { url } = await circleCheckout({ data: {} });
        window.location.href = url;
        return;
      }
      const { url } = await skuCheckout({
        data: { plan: plan.id as Exclude<PlanOption["id"], "circle"> },
      });
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <div className="mb-12 max-w-2xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Your next step
        </p>
        <h1 className="mt-3 font-display text-4xl md:text-5xl leading-[1.05] tracking-tight">
          {tier === "hardcore"
            ? "You're at the top of the room."
            : tier === "circle"
            ? "Stack the room on top of the room."
            : tier === "book_buyer"
            ? "You've got the playbook. Now run it with Marshall."
            : "Go deeper."}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          {tier === "hardcore"
            ? "Direct private sessions when you need them — beyond the daily room."
            : tier === "circle"
            ? "Add the daily classes, or buy private time with Marshall."
            : "Pick the depth you need. Membership for the room, private calls for the hard inflection points."}
        </p>
      </div>

      {cancelled && (
        <div className="mb-8 rounded-2xl border border-border bg-card px-5 py-4 text-[13px] text-foreground/70">
          Checkout cancelled. No charge made — pick back up below when you're ready.
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {skus.map((sku, i) => {
            const card = UPSELL_CATALOG[sku];
            const isPrimary = i === 0;
            const wasRequested = requested.has(sku);
            return (
              <UpsellCardView
                key={sku}
                card={card}
                primary={isPrimary}
                busyPlanId={busy}
                requested={wasRequested}
                onPurchase={(plan) => handlePurchase(card, plan)}
              />
            );
          })}
        </div>
      )}

      {tier === "aos_only" && (
        <div className="mt-12 rounded-2xl border border-dashed border-border bg-card p-6">
          <p className="label-mono">AOS seats & workspaces</p>
          <p className="mt-2 text-sm text-foreground/80">
            Need more seats or workspaces in AOS? Manage them inside the AOS app.
          </p>
          <p className="mt-2 text-[12px] text-muted-foreground">
            (Seat/workspace pricing is configured in AOS — this section will become a checkout
            once AOS-side billing is wired.)
          </p>
        </div>
      )}

      {tier === "circle" || tier === "hardcore" ? (
        <p className="mt-10 text-[13px] text-muted-foreground">
          Want to manage your existing membership?{" "}
          <Link to="/account" className="underline underline-offset-4">
            Account settings
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function UpsellCardView({
  card,
  primary,
  busyPlanId,
  requested,
  onPurchase,
}: {
  card: UpsellCard;
  primary: boolean;
  busyPlanId: string | null;
  requested: boolean;
  onPurchase: (plan: PlanOption) => void;
}) {
  const Icon: LucideIcon = card.icon;
  const isInterest = card.checkout === "interest";
  const hasMultiple = card.plans.length > 1;
  // Default to quarterly when both are offered (lock-in framing).
  const [activePlanId, setActivePlanId] = useState<string>(
    hasMultiple ? card.plans[1].id : card.plans[0].id,
  );
  const activePlan = card.plans.find((p) => p.id === activePlanId) ?? card.plans[0];
  const busy = busyPlanId === activePlan.id;

  return (
    <div
      className={`flex flex-col rounded-2xl border p-7 transition-colors ${
        primary
          ? "border-ink/30 bg-[var(--paper-deep)] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {card.eyebrow}
        {primary && (
          <span className="ml-auto rounded-full bg-signal/15 px-2 py-0.5 text-[9px] tracking-[0.18em] text-signal">
            Recommended
          </span>
        )}
      </div>

      {hasMultiple && (
        <div className="mt-4 inline-flex w-fit rounded-full border border-border bg-card p-0.5">
          {card.plans.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePlanId(p.id)}
              className={`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                activePlanId === p.id
                  ? "bg-ink text-cream"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-display text-3xl tracking-tight">{activePlan.price}</span>
        <span className="text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
          {activePlan.cadence}
        </span>
      </div>
      {activePlan.badge && (
        <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-signal">{activePlan.badge}</p>
      )}

      <p className="mt-3 text-[15px] leading-snug">{card.title}</p>
      <p className="mt-2 text-[13px] text-muted-foreground">{card.pitch}</p>
      <ul className="mt-5 space-y-2">
        {card.bullets.map((b) => (
          <li key={b} className="flex items-start gap-2 text-[13px] text-foreground/80">
            <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-signal" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-7">
        <button
          onClick={() => onPurchase(activePlan)}
          disabled={busy || requested}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-[12px] uppercase tracking-[0.22em] transition-opacity disabled:opacity-60 ${
            primary
              ? "bg-ink text-cream hover:opacity-90"
              : "border border-ink/20 bg-transparent text-ink hover:bg-ink/5"
          }`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : requested ? (
            "Interest captured"
          ) : (
            <>
              {isInterest ? "Request access" : "Continue to checkout"}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
        {isInterest && !requested && (
          <p className="mt-2 text-center text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
            Marshall will reach out personally
          </p>
        )}
      </div>
    </div>
  );
}
