import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Container } from "@/components/portal/page-header";
import { DISCORD_CHANNELS, DISCORD_URL } from "@/lib/program";
import { ArrowUpRight, MessagesSquare } from "lucide-react";

export const Route = createFileRoute("/community")({
  head: () => ({
    meta: [
      { title: "Community — ALP Contractor Circle" },
      { name: "description", content: "How members use the Contractor Circle Discord between live sessions." },
    ],
  }),
  component: CommunityPage,
});

function CommunityPage() {
  return (
    <Container>
      <PageHeader
        eyebrow="The room between sessions"
        title={<>Discord is where the<br/>real work continues.</>}
        lede="Live calls are biweekly. Discord is where members post wins, debate pricing, and tee up the issues that earn time in the next room."
        actions={
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-medium text-cream hover:opacity-90"
          >
            <MessagesSquare className="h-4 w-4" /> Open Discord <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        }
      />

      <section className="mt-12 grid gap-4 sm:grid-cols-2">
        {DISCORD_CHANNELS.map((c) => (
          <div key={c.name} className="rounded-2xl border border-border bg-card p-6">
            <p className="font-mono text-sm text-signal">{c.name}</p>
            <p className="mt-2 text-sm text-muted-foreground">{c.purpose}</p>
          </div>
        ))}
      </section>

      <section className="mt-16 rounded-3xl border border-border bg-card p-8 sm:p-10">
        <p className="label-mono">How we post</p>
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          <Etiquette n="01" title="Specifics over vibes." body="Numbers, names, dollar amounts. Vague posts get vague help." />
          <Etiquette n="02" title="One issue per thread." body="If you're stuck on three things, post three threads." />
          <Etiquette n="03" title="Close the loop." body="When you act on advice, post what happened. The next member learns from it." />
        </div>
      </section>
    </Container>
  );
}

function Etiquette({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <span className="font-mono text-xs text-signal">{n}</span>
      <h4 className="mt-1 font-display text-lg">{title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
