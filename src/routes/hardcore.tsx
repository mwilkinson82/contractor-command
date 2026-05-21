import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Container } from "@/components/portal/page-header";
import { useTier } from "@/hooks/use-tier";
import { useIsAdmin } from "@/hooks/use-is-admin";

// Hardcore-only surface. Daily class calendar (Power Hour, Contractor School,
// S&M School) lives here via a Google Calendar embed. Meet recordings open
// from each event in the calendar itself.
//
// To wire this in, set VITE_HARDCORE_GCAL_SRC to the public calendar address
// (the long URL-encoded `src=` value Google generates under "Settings →
// Integrate calendar → Public URL to this calendar"). Without it we render an
// instructions stub so the page never crashes.

export const Route = createFileRoute("/hardcore")({
  head: () => ({
    meta: [
      { title: "Hardcore Calendar — ALP Contractor Circle" },
      { name: "description", content: "Daily Power Hour, Contractor School, and S&M School calendar." },
    ],
  }),
  component: HardcorePage,
});

function HardcorePage() {
  const { tier, loading } = useTier();
  const isAdmin = useIsAdmin();
  const allowed = isAdmin || tier === "hardcore";
  const gcalSrc = import.meta.env.VITE_HARDCORE_GCAL_SRC as string | undefined;

  return (
    <Container>
      <PageHeader
        eyebrow="ALP Hardcore"
        title={<>The daily room.</>}
        lede="Power Hour every weekday at 8AM PT. Contractor School Tuesdays. Sales & Marketing School Wednesdays. Click any past event to open the Google Meet recording."
      />

      {loading ? (
        <div className="mt-8 text-sm text-muted-foreground">Loading…</div>
      ) : !allowed ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          This room is for ALP Hardcore members.
        </div>
      ) : gcalSrc ? (
        <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-card">
          <iframe
            src={`https://calendar.google.com/calendar/embed?src=${encodeURIComponent(gcalSrc)}&mode=WEEK&ctz=America%2FLos_Angeles`}
            className="h-[800px] w-full border-0"
            title="ALP Hardcore Calendar"
          />
        </div>
      ) : (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Calendar not connected yet.</p>
          <p className="mt-2">
            Send Marshall the public Google Calendar address that hosts the daily classes
            and we'll wire it in. (Calendar → Settings → Integrate calendar → Public address in
            iCal format.)
          </p>
        </div>
      )}
    </Container>
  );
}
