import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Container } from "@/components/portal/page-header";
import { STRIPE_PORTAL_URL } from "@/lib/program";
import { ArrowUpRight } from "lucide-react";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account — ALP Contractor Circle" }] }),
  component: AccountPage,
});

function AccountPage() {
  return (
    <Container>
      <PageHeader
        eyebrow="Account"
        title="Profile & billing."
        lede="Your Contractor Circle membership and billing details."
      />
      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-7">
          <p className="label-mono">Profile</p>
          <dl className="mt-4 space-y-3 text-sm">
            <Row k="Name" v="Member" />
            <Row k="Company" v="Demo Construction Co." />
            <Row k="Email" v="member@example.com" />
          </dl>
        </div>
        <div className="rounded-2xl border border-border bg-card p-7">
          <p className="label-mono">Membership</p>
          <dl className="mt-4 space-y-3 text-sm">
            <Row k="Plan" v="Contractor Circle" />
            <Row k="Rate" v="$497 / month" />
            <Row k="Status" v="Active" />
            <Row k="Next renewal" v="June 1, 2026" />
          </dl>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
            <a
              href={STRIPE_PORTAL_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-cream hover:opacity-90"
            >
              Manage subscription <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
            <a
              href="mailto:hello@alpcontractorcircle.com?subject=Billing question"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm hover:bg-muted"
            >
              Billing question
            </a>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Card updates, invoices, and cancellation are handled through the Stripe customer portal.
          </p>
        </div>
      </div>
    </Container>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2 last:border-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
