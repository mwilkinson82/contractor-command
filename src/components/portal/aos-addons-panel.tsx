// Stepper panel for buying extra AOS seats and workspaces.
// Today this is only mounted for book buyers — other tiers either have
// unlimited capacity already (Circle / Hardcore / Power Hour / S&M /
// Contractor School) or are not in scope for this round (Intensive).
//
// Pricing is monthly recurring, quantity-based:
//   - Extra seat:      $9.99/mo each (STRIPE_PRICE_ID_AOS_SEAT_MONTH)
//   - Extra workspace: $25/mo each   (STRIPE_PRICE_ID_AOS_WORKSPACE_MONTH)
//
// If the buyer already has an active add-on of a given kind, the server
// redirects them to the Stripe billing portal so they can bump the quantity
// in place instead of opening a second subscription.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  createAosAddonCheckout,
  getMyAosAddons,
  type AosAddonRow,
} from "@/lib/billing.functions";

const SEAT_PRICE = 9.99;
const WORKSPACE_PRICE = 25;

type Kind = "seat" | "workspace";

function existing(rows: AosAddonRow[] | undefined, kind: Kind): AosAddonRow | undefined {
  return rows?.find(
    (r) => r.kind === kind && (r.status === "active" || r.status === "trialing"),
  );
}

export function AosAddonsPanel() {
  const checkoutFn = useServerFn(createAosAddonCheckout);
  const addonsFn = useServerFn(getMyAosAddons);

  const { data: addons, refetch } = useQuery({
    queryKey: ["aos-addons"],
    queryFn: () => addonsFn(),
    staleTime: 30_000,
  });

  const seatRow = existing(addons, "seat");
  const wsRow = existing(addons, "workspace");

  const [seatQty, setSeatQty] = useState(1);
  const [wsQty, setWsQty] = useState(1);
  const [busy, setBusy] = useState<Kind | null>(null);

  const total = seatQty * SEAT_PRICE + wsQty * WORKSPACE_PRICE;

  async function handleBuy(kind: Kind) {
    const quantity = kind === "seat" ? seatQty : wsQty;
    if (quantity < 1) return;
    setBusy(kind);
    try {
      const { url } = await checkoutFn({ data: { kind, quantity } });
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(null);
      void refetch();
    }
  }

  return (
    <div className="rounded-2xl border border-paper-edge bg-work-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-ink">
          Need more capacity?
        </p>
        <p className="text-[11px] text-muted-foreground">Monthly · cancel anytime</p>
      </div>

      <div className="mt-4 grid gap-3">
        <Row
          label="Extra seats"
          subLabel={`$${SEAT_PRICE.toFixed(2)} / month each`}
          qty={seatQty}
          onChange={setSeatQty}
          owned={seatRow?.quantity ?? 0}
          busy={busy === "seat"}
          onBuy={() => handleBuy("seat")}
          ctaLabel={seatRow ? "Manage in billing portal" : "Add seats"}
        />
        <Row
          label="Extra workspaces"
          subLabel={`$${WORKSPACE_PRICE.toFixed(2)} / month each`}
          qty={wsQty}
          onChange={setWsQty}
          owned={wsRow?.quantity ?? 0}
          busy={busy === "workspace"}
          onBuy={() => handleBuy("workspace")}
          ctaLabel={wsRow ? "Manage in billing portal" : "Add workspaces"}
        />
      </div>

      <p className="mt-4 border-t border-paper-edge pt-3 text-[11px] text-muted-foreground">
        New purchase preview: +{seatQty} seat{seatQty === 1 ? "" : "s"} · +{wsQty} workspace
        {wsQty === 1 ? "" : "s"} ={" "}
        <span className="font-bold text-ink">${total.toFixed(2)} / month</span>
      </p>
    </div>
  );
}

function Row({
  label,
  subLabel,
  qty,
  onChange,
  owned,
  busy,
  onBuy,
  ctaLabel,
}: {
  label: string;
  subLabel: string;
  qty: number;
  onChange: (n: number) => void;
  owned: number;
  busy: boolean;
  onBuy: () => void;
  ctaLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-paper-edge bg-white/60 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <p className="text-[11px] text-muted-foreground">
          {subLabel}
          {owned > 0 && (
            <>
              {" · "}
              <span className="text-signal">you own {owned}</span>
            </>
          )}
        </p>
      </div>
      <div className="inline-flex items-center rounded-md border border-paper-edge bg-white">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          className="grid h-7 w-7 place-items-center text-muted-foreground hover:bg-paper-deep disabled:opacity-40"
          onClick={() => onChange(Math.max(1, qty - 1))}
          disabled={qty <= 1}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-8 text-center text-[13px] font-medium">{qty}</span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          className="grid h-7 w-7 place-items-center text-muted-foreground hover:bg-paper-deep"
          onClick={() => onChange(Math.min(50, qty + 1))}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={onBuy}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-[11px] uppercase tracking-[0.18em] text-cream hover:opacity-90 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        {ctaLabel}
      </button>
    </div>
  );
}
