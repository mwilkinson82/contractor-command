// Compact trigger + Dialog wrapper around AosAddonsPanel.
// Used in /aos, /upgrade, and the deep-link route /aos/add-capacity so the
// external AOS app can hand its users back to the portal's Stripe.

import { useState } from "react";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AosAddonsPanel } from "@/components/portal/aos-addons-panel";

type Props = {
  /** Controlled open state. If omitted, component manages its own state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render a trigger button. Omit when using deep-link auto-open. */
  trigger?: React.ReactNode;
  className?: string;
};

export function AosAddonsModal({ open, onOpenChange, trigger, className }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : internalOpen;
  const setOpen = controlled ? (onOpenChange ?? (() => {})) : setInternalOpen;

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className={className ?? "max-w-xl border-paper-edge bg-cream"}>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-tight text-ink">
            Add capacity
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[#5b554d]">
            Extra seats and workspaces are monthly add-ons. Cancel anytime from
            the billing portal.
          </DialogDescription>
        </DialogHeader>
        <AosAddonsPanel />
      </DialogContent>
    </Dialog>
  );
}

/** Inline text-link trigger used on /aos and /upgrade. */
export function AosAddonsTriggerLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-signal underline-offset-4 hover:underline"
    >
      <Plus className="h-3 w-3" />
      Add seats or workspaces
    </button>
  );
}
