import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Container } from "@/components/portal/page-header";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Account — ALP Contractor Circle" }] }),
  component: AccountPage,
});

function AccountPage() {
  return (
    <Container>
      <PageHeader eyebrow="Account" title="Profile & billing." lede="Your Contractor Circle membership and billing details." />
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
