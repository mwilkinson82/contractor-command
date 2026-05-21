// Tier-aware upgrade page. Cards filtered by viewer's current tier via
// upsellsForTier(). Live checkout for Circle (only fully wired SKU);
// everything else captures interest via requestUpsellInterest.

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Loader2, type LucideIcon } from "lucide-react";
import { useTier } from "@/hooks/use-tier";
import { createCircleCheckout, requestUpsellInterest } from "@/lib/billing.functions";
import { UPSELL_CATALOG, upsellsForTier, type UpsellCard, type UpsellSku } from "@/lib/upsell-catalog";
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
  const interest = useServerFn(requestUpsellInterest);
  const [busy, setBusy] = useState<UpsellSku | null>(null);
  const [requested, setRequested] = useState<Set<UpsellSku>>(new Set());

  const skus = upsellsForTier(tier);

  async function handleClick(card: UpsellCard) {
    setBusy(card.sku);
    try {
      if (card.checkout === "live" && card.liveAction === "circle") {
        const { url } = await circleCheckout({ data: {} });
        window.location.href = url;
        return;
      }
      // Interest capture path
      await interest({ data: { sku: card.sku as Exclude<UpsellSku, "circle"> } });
      setRequested((s) => new Set(s).add(card.sku));
      toast.success("Got it — Marshall will reach out about " + card.eyebrow + ".");
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
                busy={busy === sku}
                requested={wasRequested}
                onClick={() => handleClick(card)}
              />
            );
          })}
        </div>
      )}

      {/* AOS-only viewers get a stub for seat/workspace top-ups (handled in AOS) */}
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
  busy,
  requested,
  onClick,
}: {
  card: UpsellCard;
  primary: boolean;
  busy: boolean;
  requested: boolean;
  onClick: () => void;
}) {
  const Icon: LucideIcon = card.icon;
  const isInterest = card.checkout === "interest";

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
      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-display text-3xl tracking-tight">{card.price}</span>
        <span className="text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
          {card.priceNote}
        </span>
      </div>
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
          onClick={onClick}
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
              {isInterest ? "Request access" : "Join now"}
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
