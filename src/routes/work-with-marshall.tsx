import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, Container } from "@/components/portal/page-header";
import { createIntensiveCheckout } from "@/lib/billing.functions";
import { Loader2, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/work-with-marshall")({
  head: () => ({
    meta: [
      { title: "Work With Marshall — Six-Week Contractor Intensive" },
      { name: "description", content: "Six private sessions with Marshall. For members who need direct guidance beyond the group room." },
    ],
  }),
  component: WorkPage,
});

function WorkPage() {
  // (navigation handled via window.location.assign for external Stripe redirect)
  const checkoutFn = useServerFn(createIntensiveCheckout);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Read ?intensive=success|cancelled from URL
  const [status, setStatus] = useState<"success" | "cancelled" | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("intensive");
    if (v === "success" || v === "cancelled") setStatus(v);
  }, []);

  async function startCheckout() {
    setLoading(true);
    setErr(null);
    try {
      const { url } = await checkoutFn({ data: { source: "intensive_page" } });
      window.location.assign(url);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : "Could not start checkout.";
      setErr(m);
      setLoading(false);
    }
  }

  return (
    <Container>
      <PageHeader
        eyebrow="When the room is not enough"
        title={<>Six-Week Contractor<br/>Intensive.</>}
        lede="Contractor Circle gives you the operating room. The Intensive gives you six private sessions to pressure-test the business, install the right priorities, and move faster with direct guidance."
      />

      {status === "success" && (
        <div className="mt-8 flex items-start gap-3 rounded-2xl border border-signal/30 bg-gold-soft px-5 py-4">
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-signal" />
          <div className="text-[13px] text-foreground/80">
            <strong className="font-display text-[15px] tracking-tight">You're in.</strong>
            <p className="mt-1">Payment received. Marshall will reach out within one business day to schedule your first session.</p>
          </div>
        </div>
      )}
      {status === "cancelled" && (
        <div className="mt-8 rounded-2xl border border-border bg-card px-5 py-4 text-[13px] text-foreground/70">
          Checkout cancelled. No charge made — you can pick it back up below when you're ready.
        </div>
      )}

      <div className="mt-12 grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="rounded-3xl bg-ink p-8 text-cream shadow-[var(--shadow-focus)] sm:p-10">
            <p className="label-mono !text-cream/55">The engagement</p>
            <div className="mt-5 flex items-baseline gap-3">
              <span className="font-display text-5xl text-cream">$5,000</span>
              <span className="text-sm text-cream/55">six private sessions over six weeks</span>
            </div>
            <ul className="mt-8 space-y-3 text-sm text-cream/80">
              <li>· Six private working sessions with Marshall.</li>
              <li>· Direct pressure-testing of the business, the numbers, and the next moves.</li>
              <li>· Priorities and structure to install over the engagement.</li>
              <li>· Outputs you carry into AOS and run the company against.</li>
            </ul>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button
                onClick={startCheckout}
                disabled={loading || status === "success"}
                className="inline-flex items-center gap-2 rounded-lg bg-gold px-5 py-3 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading ? "Opening checkout…" : status === "success" ? "Already enrolled" : "Enroll · $5,000"}
              </button>
              {err && <p className="text-[12px] text-gold-soft/90">{err}</p>}
            </div>
            <p className="mt-8 border-t border-cream/10 pt-5 text-xs text-cream/55">
              For members who need direct private guidance beyond the group room. Not for everyone, and not a substitute for doing the work. Secure checkout via Stripe.
            </p>
          </div>
        </div>

        <aside className="lg:col-span-5">
          <div className="rounded-3xl border border-border bg-card p-7">
            <p className="label-mono">Good fit if</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>· You're carrying a decision the group can't unblock alone.</li>
              <li>· The business is at a real inflection — capacity, leadership, sale, or scale.</li>
              <li>· You're ready to install structure, not just talk about it.</li>
            </ul>
          </div>
          <div className="mt-5 rounded-3xl border border-border bg-card p-7">
            <p className="label-mono">Not the right fit if</p>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>· You want unlimited access to Marshall.</li>
              <li>· You're looking for a support inbox.</li>
              <li>· You haven't brought issues to Contractor Circle yet.</li>
            </ul>
          </div>
        </aside>
      </div>
    </Container>
  );
}

