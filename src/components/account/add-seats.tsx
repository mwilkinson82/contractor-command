// Nov 2026: Add seats on the account page. This is the only place seats are paid for; the chat tool
// (team_add_seats) just links here. Pick a number, then continue to Stripe's secure page in this tab.
// When checkout is off, the owner gets the coming-soon note with the support address instead.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { getSeatPurchaseStatus, startSeatCheckout } from "@/lib/account-team.functions";
import {
  SEATS_COMING_SOON,
  SEATS_DONE,
  SEATS_FAILED,
  SEATS_PICK,
  OWNER_ONLY_MESSAGE,
} from "@/lib/account-team";

const SEAT_PRICE_CENTS = 4900;

export function AddSeats({
  companyId,
  buttonClassName,
  primaryClassName,
  noteClassName,
  label = "Add seats",
}: {
  companyId: string;
  buttonClassName: string;
  primaryClassName: string;
  noteClassName: string;
  label?: string;
}) {
  const statusFn = useServerFn(getSeatPurchaseStatus);
  const checkoutFn = useServerFn(startSeatCheckout);
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [seats, setSeats] = useState(1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Back from Stripe: /account?checkout=done#team
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search).get("checkout");
    if (q === "done") setNote(SEATS_DONE);
  }, []);

  async function onOpen() {
    setNote(null);
    let on = false;
    try {
      on = (await statusFn()).checkoutEnabled === true;
    } catch {
      on = false;
    }
    setEnabled(on);
    setOpen(true);
  }

  async function onContinue() {
    setBusy(true);
    setNote(null);
    try {
      const r = await checkoutFn({ data: { companyId, seats } });
      if (r.status === "ok") {
        window.location.assign(r.url);
        return;
      }
      if (r.status === "off") setEnabled(false);
      else setNote(r.status === "not_owner" ? OWNER_ONLY_MESSAGE : SEATS_FAILED);
    } catch {
      setNote(SEATS_FAILED);
    }
    setBusy(false);
  }

  const total = ((seats * SEAT_PRICE_CENTS) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  return (
    <div style={{ flexBasis: "100%" }}>
      {!open ? (
        <button type="button" className={buttonClassName} onClick={() => void onOpen()}>
          {label}
        </button>
      ) : enabled === false ? (
        <p className={noteClassName}>{SEATS_COMING_SOON}</p>
      ) : (
        <div
          role="group"
          aria-label="Add seats"
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}
        >
          <p className={noteClassName} style={{ flexBasis: "100%", margin: 0 }}>
            {SEATS_PICK}
          </p>
          <button
            type="button"
            className={buttonClassName}
            aria-label="One fewer seat"
            onClick={() => setSeats((n) => Math.max(1, n - 1))}
            disabled={busy || seats <= 1}
          >
            −
          </button>
          <span aria-live="polite" style={{ minWidth: 92, textAlign: "center", fontWeight: 600 }}>
            {seats} seat{seats === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className={buttonClassName}
            aria-label="One more seat"
            onClick={() => setSeats((n) => Math.min(500, n + 1))}
            disabled={busy || seats >= 500}
          >
            +
          </button>
          <button
            type="button"
            className={primaryClassName}
            onClick={() => void onContinue()}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Continue to payment · {total}/month
          </button>
          <button
            type="button"
            className={buttonClassName}
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      )}
      {note ? <p className={noteClassName}>{note}</p> : null}
    </div>
  );
}
