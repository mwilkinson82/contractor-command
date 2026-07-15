import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, Lock, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Container, PageHeader } from "@/components/portal/page-header";
import { useTier } from "@/hooks/use-tier";
import { CIRCLE_FEATURES, hasCircleFeature, type CircleFeature } from "@/lib/hub-access";

export function FeatureAccessBoundary({
  feature,
  children,
}: {
  feature: CircleFeature;
  children: ReactNode;
}) {
  const { tier, loading } = useTier();

  if (loading) {
    return (
      <Container>
        <div className="mt-10 animate-pulse rounded-3xl border border-border bg-card p-8">
          <div className="h-3 w-44 rounded bg-muted" />
          <div className="mt-5 h-12 max-w-xl rounded bg-muted" />
          <div className="mt-4 h-20 max-w-3xl rounded bg-muted" />
        </div>
      </Container>
    );
  }

  if (!hasCircleFeature(tier, feature)) {
    return <LockedFeaturePreview feature={feature} />;
  }

  return <>{children}</>;
}

export function LockedFeaturePreview({ feature }: { feature: CircleFeature }) {
  const meta = CIRCLE_FEATURES[feature];

  return (
    <Container>
      <PageHeader
        eyebrow="Contractor Circle preview"
        title={<>{meta.title}</>}
        lede={meta.description}
      />

      <section className="mt-10 overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--shadow-soft)]">
        <div className="grid lg:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
          <div className="relative min-h-[390px] overflow-hidden border-b border-border bg-[var(--paper-deep)] p-7 sm:p-10 lg:border-b-0 lg:border-r">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--signal)_12%,transparent),transparent_48%)]" />
            <div className="relative grid gap-4 opacity-35 blur-[1.5px]" aria-hidden>
              {["Working session", "Implementation file", "Operator discussion", "Next action"].map(
                (label, index) => (
                  <div
                    key={label}
                    className={`rounded-2xl border border-border bg-card p-5 ${index % 2 ? "ml-8" : "mr-8"}`}
                  >
                    <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-muted-foreground">
                      0{index + 1} · Contractor Circle
                    </p>
                    <p className="mt-3 font-display text-xl">{label}</p>
                    <div className="mt-4 h-2.5 w-full rounded bg-muted" />
                    <div className="mt-2 h-2.5 w-3/4 rounded bg-muted" />
                  </div>
                ),
              )}
            </div>

            <div className="absolute inset-0 grid place-items-center p-6">
              <div className="max-w-xs rounded-2xl border border-ink/10 bg-cream/95 p-6 text-center shadow-[0_24px_70px_-30px_rgb(18_13_8/0.55)] backdrop-blur">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-ink text-cream">
                  <Lock className="h-4 w-4" />
                </span>
                <p className="mt-4 font-mono text-[9px] font-semibold uppercase tracking-[0.24em] text-clay">
                  Available to Contractor Circle members
                </p>
                <p className="mt-3 text-[13px] leading-relaxed text-foreground/70">
                  You can see what is here. Membership unlocks the live content and working files.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col p-7 sm:p-10">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-clay">
              {meta.eyebrow}
            </p>
            <h2 className="mt-3 font-display text-3xl leading-tight">
              Install the system with the room behind you.
            </h2>
            <ul className="mt-7 space-y-4">
              {meta.benefits.map((benefit) => (
                <li
                  key={benefit}
                  className="flex gap-3 text-[13px] leading-relaxed text-foreground/78"
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-good/12 text-good">
                    <Check className="h-3 w-3" />
                  </span>
                  {benefit}
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-9">
              <Link
                to="/upgrade"
                className="inline-flex items-center gap-2 rounded-md bg-ink px-5 py-3 text-[13px] font-medium text-cream hover:opacity-90"
              >
                Explore Contractor Circle <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                to="/ecosystem"
                className="ml-3 inline-flex items-center gap-2 px-2 py-3 text-[13px] font-medium text-foreground/70 hover:text-foreground"
              >
                <Sparkles className="h-3.5 w-3.5 text-clay" /> See the ALP ecosystem
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Container>
  );
}
