// Upgrade page — shown to Book Buyers (and Intensive grads) so they can step
// up to the next tier in-app. Two cards side-by-side; user self-selects.

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Loader2, Sparkles, Users } from "lucide-react";
import { useTier } from "@/hooks/use-tier";
import { createIntensiveCheckout, createCircleCheckout } from "@/lib/billing.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/upgrade")({
  head: () => ({
    meta: [
      { title: "Upgrade — Contractor Circle" },
      {
        name: "description",
        content:
          "Step up from the ALP Handbook into the Six-Week Intensive or Contractor Circle.",
      },
    ],
  }),
  component: UpgradePage,
});

function UpgradePage() {
  const { tier, isBookBuyer } = useTier();
  const intensive = useServerFn(createIntensiveCheckout);
  const circle = useServerFn(createCircleCheckout);
  const [busy, setBusy] = useState<"intensive" | "circle" | null>(null);

  async function buy(kind: "intensive" | "circle") {
    setBusy(kind);
    try {
      const { url } = kind === "intensive"
        ? await intensive({ data: { source: "intensive_page" } })
        : await circle({ data: {} });
      window.location.href = url;
    } catch (e) {
      setBusy(null);
      toast.error(e instanceof Error ? e.message : "Couldn't start checkout.");
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <div className="mb-12 max-w-2xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Your next step
        </p>
        <h1 className="mt-3 font-display text-4xl md:text-5xl leading-[1.05] tracking-tight">
          {isBookBuyer
            ? "You've got the playbook. Now run it with Marshall."
            : "Go deeper."}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          The Handbook teaches you the operating system. The Intensive installs
          it in your business. The Circle keeps it running for life.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <UpgradeCard
          eyebrow="Six-Week Intensive"
          icon={Sparkles}
          price="$5,000"
          priceNote="One-time"
          headline="Six private sessions. Marshall in your business."
          bullets={[
            "Weekly 1:1 working sessions with Marshall",
            "Your scorecard, rocks, and L10 built side-by-side",
            "Direct chat between calls",
            "Includes Circle access during the program",
          ]}
          cta="Start the Intensive"
          busy={busy === "intensive"}
          onClick={() => buy("intensive")}
          disabled={tier === "circle"}
        />
        <UpgradeCard
          eyebrow="Contractor Circle"
          icon={Users}
          price="Membership"
          priceNote="Monthly"
          headline="The room. Calls, Vault, Marshall, community."
          bullets={[
            "Bi-weekly group calls with Marshall",
            "Full Vault of templates, replays, frameworks",
            "Ask Marshall — direct line, any topic",
            "The community of operators running AOS",
            "Everything in the Handbook tier",
          ]}
          cta="Join the Circle"
          busy={busy === "circle"}
          onClick={() => buy("circle")}
          highlighted
          disabled={tier === "circle"}
        />
      </div>

      {tier === "circle" && (
        <p className="mt-10 text-center text-[13px] text-muted-foreground">
          You're already in the Circle.{" "}
          <Link to="/" className="underline underline-offset-4">
            Back to your command center
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function UpgradeCard(props: {
  eyebrow: string;
  icon: React.ComponentType<{ className?: string }>;
  price: string;
  priceNote: string;
  headline: string;
  bullets: string[];
  cta: string;
  busy: boolean;
  onClick: () => void;
  highlighted?: boolean;
  disabled?: boolean;
}) {
  const Icon = props.icon;
  return (
    <div
      className={`rounded-2xl border p-8 transition-colors ${
        props.highlighted
          ? "border-ink/30 bg-[var(--paper-deep)] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {props.eyebrow}
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-display text-3xl tracking-tight">{props.price}</span>
        <span className="text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
          {props.priceNote}
        </span>
      </div>
      <p className="mt-3 text-[15px] leading-snug">{props.headline}</p>
      <ul className="mt-6 space-y-2">
        {props.bullets.map((b) => (
          <li key={b} className="flex items-start gap-2 text-[13px] text-foreground/80">
            <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 text-signal" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <button
        onClick={props.onClick}
        disabled={props.busy || props.disabled}
        className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-6 py-3 text-[13px] uppercase tracking-[0.22em] text-cream transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {props.busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            {props.cta}
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </div>
  );
}
