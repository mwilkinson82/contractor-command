import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Container } from "@/components/portal/page-header";

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
  return (
    <Container>
      <PageHeader
        eyebrow="When the room is not enough"
        title={<>Six-Week Contractor<br/>Intensive.</>}
        lede="Contractor Circle gives you the operating room. The Intensive gives you six private sessions to pressure-test the business, install the right priorities, and move faster with direct guidance."
      />

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
            <div className="mt-9 flex flex-wrap gap-2">
              <a
                href="mailto:hello@alpcontractorcircle.com?subject=Six-Week Intensive — Request"
                className="inline-flex items-center gap-2 rounded-lg bg-gold px-5 py-3 text-sm font-medium text-ink hover:opacity-90"
              >
                Request Intensive
              </a>
              <a
                href="mailto:hello@alpcontractorcircle.com?subject=Six-Week Intensive — Discussion"
                className="inline-flex items-center gap-2 rounded-lg border border-cream/15 px-5 py-3 text-sm text-cream hover:bg-cream/5"
              >
                Discuss fit first
              </a>
            </div>
            <p className="mt-8 border-t border-cream/10 pt-5 text-xs text-cream/55">
              For members who need direct private guidance beyond the group room. Not for everyone, and not a substitute for doing the work.
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
