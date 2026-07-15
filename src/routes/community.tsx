import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Container } from "@/components/portal/page-header";
import { DISCORD_CHANNELS, DISCORD_URL } from "@/lib/program";
import { ArrowUpRight, Clock, Users, Zap } from "lucide-react";
import { FeatureAccessBoundary } from "@/components/portal/feature-access";

export const Route = createFileRoute("/community")({
  head: () => ({
    meta: [
      { title: "Community — ALP Contractor Circle" },
      {
        name: "description",
        content: "How members use the Contractor Circle Discord between live sessions.",
      },
    ],
  }),
  component: CommunityRoute,
});

function CommunityRoute() {
  return (
    <FeatureAccessBoundary feature="community">
      <CommunityPage />
    </FeatureAccessBoundary>
  );
}

// Official Discord wordmark + logo (Discord brand "Blurple" #5865F2)
const DISCORD_BLURPLE = "#5865F2";

function DiscordMark({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 127.14 96.36" className={className} style={style} aria-hidden>
      <path
        fill="currentColor"
        d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"
      />
    </svg>
  );
}

function CommunityPage() {
  return (
    <Container>
      <PageHeader
        eyebrow="The room between sessions"
        title={
          <>
            Discord is where the
            <br />
            real work continues.
          </>
        }
        lede="Live calls are biweekly. Discord is where members post wins, debate pricing, and tee up the issues that earn time in the next room."
      />

      {/* Product-media hero — house dark panel (dark used deliberately as focal
          contrast); Discord identity carried by its logo mark, not a blurple
          brand fill. */}
      <section className="relative mt-10 overflow-hidden rounded-3xl bg-ink text-white shadow-[var(--shadow-focus)]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.10]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)",
            backgroundSize: "22px 22px",
          }}
        />
        <DiscordMark className="pointer-events-none absolute -right-10 -bottom-16 h-72 w-72 text-white/[0.06]" />

        <div className="relative grid gap-8 px-6 py-10 sm:px-10 sm:py-12 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-7">
            <div className="flex items-center gap-3">
              <DiscordMark className="h-7 w-auto" style={{ color: DISCORD_BLURPLE }} />
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/70">
                Hosted on Discord
              </span>
            </div>
            <h2 className="mt-5 font-display text-[2rem] leading-[1.05] sm:text-[2.5rem]">
              The Contractor Circle server.
            </h2>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/80">
              One server. Members only. Voice rooms for office hours, threads for every issue you
              bring, an archive of every fix that's already been worked. Free app, two minutes to
              join.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href={DISCORD_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-[11px] bg-signal px-5 py-3 text-[14px] font-medium text-white shadow-[0_8px_20px_-8px_rgb(247_106_22_/_0.6)] transition hover:-translate-y-px hover:bg-signal/90"
              >
                <DiscordMark className="h-4 w-auto" />
                Join the server
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
              <a
                href="https://discord.com/download"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-white/30 px-4 py-3 text-[13px] text-white/90 hover:bg-white/10"
              >
                Get the Discord app
              </a>
            </div>
          </div>

          <div className="lg:col-span-5">
            <div className="grid gap-3">
              <Stat
                icon={<Users className="h-4 w-4" />}
                label="Members only"
                body="Every account in the server is an active Circle member."
              />
              <Stat
                icon={<Clock className="h-4 w-4" />}
                label="Always on"
                body="Post overnight, get a take by morning. Marshall reads daily."
              />
              <Stat
                icon={<Zap className="h-4 w-4" />}
                label="Feeds the calls"
                body="The best threads here become the next biweekly agenda."
              />
            </div>
          </div>
        </div>
      </section>

      {/* Channels */}
      <section className="mt-14">
        <div className="flex items-baseline justify-between border-b border-border pb-3">
          <h2 className="font-display text-xl">Channels</h2>
          <span className="text-xs text-muted-foreground">{DISCORD_CHANNELS.length} rooms</span>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {DISCORD_CHANNELS.map((c) => (
            <div key={c.name} className="rounded-2xl border border-border bg-card p-6">
              <p className="font-mono text-sm text-clay">{c.name}</p>
              <p className="mt-2 text-sm text-muted-foreground">{c.purpose}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How we post */}
      <section className="mt-14 rounded-3xl border border-border bg-card p-8 sm:p-10">
        <p className="label-mono">How we post</p>
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          <Etiquette
            n="01"
            title="Specifics over vibes."
            body="Numbers, names, dollar amounts. Vague posts get vague help."
          />
          <Etiquette
            n="02"
            title="One issue per thread."
            body="If you're stuck on three things, post three threads."
          />
          <Etiquette
            n="03"
            title="Close the loop."
            body="When you act on advice, post what happened. The next member learns from it."
          />
        </div>
      </section>

      {/* Footer CTA */}
      <section className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card px-6 py-5">
        <div className="flex items-center gap-3">
          <DiscordMark className="h-6 w-auto" style={{ color: DISCORD_BLURPLE }} />
          <p className="text-sm text-muted-foreground">
            Not in the server yet? You're missing the half of the program that happens between
            calls.
          </p>
        </div>
        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[13px] font-medium text-cream hover:opacity-90"
        >
          Open Discord <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </section>
    </Container>
  );
}

function Stat({ icon, label, body }: { icon: React.ReactNode; label: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/[0.06] p-4">
      <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white/80">
        <span className="text-white">{icon}</span>
        {label}
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-white/75">{body}</p>
    </div>
  );
}

function Etiquette({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div>
      <span className="font-mono text-xs text-clay">{n}</span>
      <h4 className="mt-1 font-display text-lg">{title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
