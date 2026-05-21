import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, Container } from "@/components/portal/page-header";
import { createSkuCheckout } from "@/lib/billing.functions";
import { Loader2, CheckCircle2, ArrowRight, Phone, Sparkles, type LucideIcon } from "lucide-react";

export const Route = createFileRoute("/work-with-marshall")({
  head: () => ({
    meta: [
      { title: "Work With Marshall — Private Sessions" },
      { name: "description", content: "One, three, or six private sessions with Marshall. For decisions the group can't unblock alone." },
    ],
  }),
  component: WorkPage,
});

type CallPack = {
  plan: "call_1" | "call_3" | "call_6";
  eyebrow: string;
  icon: LucideIcon;
  price: string;
  perCall: string;
  title: string;
  pitch: string;
  bullets: string[];
  badge?: string;
};

const PACKS: CallPack[] = [
  {
    plan: "call_1",
    eyebrow: "Single Call",
    icon: Phone,
    price: "$1,500",
    perCall: "$1,500 / session",
    title: "One hour with Marshall.",
    pitch: "One private session. Bring a decision you can't unblock alone.",
    bullets: [
      "1 × 60-minute private session",
      "Direct pressure-test of one decision",
      "Scheduled within one business day",
    ],
  },
  {
    plan: "call_3",
    eyebrow: "Three Call Pack",
    icon: Sparkles,
    price: "$3,000",
    perCall: "$1,000 / session",
    title: "Three sessions over six weeks.",
    pitch: "Enough cadence to install structure on a single inflection point.",
    bullets: [
      "3 × 60-minute private sessions",
      "Direct chat between calls",
      "Outputs you carry into AOS",
    ],
  },
  {
    plan: "call_6",
    eyebrow: "Six Call Pack",
    icon: Sparkles,
    price: "$5,000",
    perCall: "~$833 / session",
    title: "Six sessions. The full installation.",
    pitch: "What the Six-Week Intensive was — same six private sessions, paid as a pack.",
    bullets: [
      "6 × 60-minute private sessions",
      "Marshall in your business for six weeks",
      "Priorities and structure installed end-to-end",
    ],
    badge: "Best value",
  },
];

function WorkPage() {
  const checkoutFn = useServerFn(createSkuCheckout);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [status, setStatus] = useState<"success" | "cancelled" | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("calls") ?? sp.get("intensive");
    if (v === "success" || v === "cancelled") setStatus(v);
  }, []);

  async function startCheckout(plan: CallPack["plan"]) {
    setBusy(plan);
    setErr(null);
    try {
      const { url } = await checkoutFn({ data: { plan } });
      window.location.assign(url);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : "Could not start checkout.";
      setErr(m);
      setBusy(null);
    }
  }

  return (
    <Container>
      <PageHeader
        eyebrow="Work with Marshall"
        title={<>Private sessions.<br/>One, three, or six.</>}
        lede="Contractor Circle gives you the room. These are private working sessions for decisions and inflection points that need direct, focused time with Marshall."
      />

      {status === "success" && (
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-signal/30 bg-gold-soft px-5 py-4">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-signal" />
          <div className="text-[13px] text-foreground/80">
            <strong className="font-display text-[15px] tracking-tight">You're booked.</strong>
            <p className="mt-1">Payment received. Marshall will reach out within one business day to schedule your first session.</p>
          </div>
        </div>
      )}
      {status === "cancelled" && (
        <div className="mt-8 rounded-2xl border border-border bg-card px-5 py-4 text-[13px] text-foreground/70">
          Checkout cancelled. No charge made — pick one back up below when you're ready.
        </div>
      )}

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {PACKS.map((pack, i) => {
          const isPrimary = i === 2; // 6-pack highlighted (best per-session value)
          const Icon = pack.icon;
          const isBusy = busy === pack.plan;
          return (
            <div
              key={pack.plan}
              className={`flex flex-col rounded-3xl border p-8 transition-colors ${
                isPrimary
                  ? "border-ink bg-ink text-cream shadow-[var(--shadow-focus)]"
                  : "border-border bg-card"
              }`}
            >
              <div className={`flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] ${
                isPrimary ? "text-cream/55" : "text-muted-foreground"
              }`}>
                <Icon className="h-3.5 w-3.5" />
                {pack.eyebrow}
                {pack.badge && (
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] tracking-[0.18em] ${
                    isPrimary ? "bg-gold text-ink" : "bg-signal/15 text-signal"
                  }`}>
                    {pack.badge}
                  </span>
                )}
              </div>
              <div className="mt-5 flex items-baseline gap-2">
                <span className={`font-display text-4xl tracking-tight ${isPrimary ? "text-cream" : ""}`}>
                  {pack.price}
                </span>
              </div>
              <p className={`mt-1 text-[11px] uppercase tracking-[0.18em] ${
                isPrimary ? "text-cream/55" : "text-muted-foreground"
              }`}>
                {pack.perCall}
              </p>
              <p className={`mt-4 text-[15px] leading-snug ${isPrimary ? "text-cream" : ""}`}>
                {pack.title}
              </p>
              <p className={`mt-2 text-[13px] ${isPrimary ? "text-cream/70" : "text-muted-foreground"}`}>
                {pack.pitch}
              </p>
              <ul className="mt-5 space-y-2">
                {pack.bullets.map((b) => (
                  <li
                    key={b}
                    className={`flex items-start gap-2 text-[13px] ${
                      isPrimary ? "text-cream/80" : "text-foreground/80"
                    }`}
                  >
                    <CheckCircle2 className={`mt-[3px] h-3.5 w-3.5 shrink-0 ${
                      isPrimary ? "text-gold" : "text-signal"
                    }`} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-7">
                <button
                  onClick={() => startCheckout(pack.plan)}
                  disabled={isBusy || status === "success"}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-[12px] uppercase tracking-[0.22em] transition-opacity disabled:opacity-60 ${
                    isPrimary
                      ? "bg-gold text-ink hover:opacity-90"
                      : "bg-ink text-cream hover:opacity-90"
                  }`}
                >
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Continue to checkout
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {err && <p className="mt-4 text-[12px] text-destructive">{err}</p>}

      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        <div className="rounded-3xl border border-border bg-card p-7">
          <p className="label-mono">Good fit if</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li>· You're carrying a decision the group can't unblock alone.</li>
            <li>· The business is at a real inflection — capacity, leadership, sale, or scale.</li>
            <li>· You're ready to install structure, not just talk about it.</li>
          </ul>
        </div>
        <div className="rounded-3xl border border-border bg-card p-7">
          <p className="label-mono">Not the right fit if</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>· You want unlimited access to Marshall.</li>
            <li>· You're looking for a support inbox.</li>
            <li>· You haven't brought issues to Contractor Circle yet.</li>
          </ul>
        </div>
      </div>

      <p className="mt-8 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Secure checkout via Stripe · Sessions scheduled after payment
      </p>
    </Container>
  );
}
