import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, ArrowUpRight, ChevronDown, Map, Route as RouteIcon } from "lucide-react";
import { createThread } from "@/lib/ask.functions";
import { GreetingIcon, type GreetingIconKey } from "@/components/portal/greeting-icon";

const STARTERS = [
  "Pricing a job is too slow",
  "PM isn't owning the schedule",
  "Cash is tight this month",
  "I need to hire a #2",
  "We're chasing too many bids",
  "Margin slipped on the last job",
];

export function HomeHero({
  companyName,
  greeting,
  firstName,
  today,
  greetingIcon,
}: {
  companyName: string;
  greeting: string;
  firstName: string;
  today: string;
  greetingIcon?: GreetingIconKey | null;
}) {
  const navigate = useNavigate();
  const createThreadFn = useServerFn(createThread);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    try {
      const { id } = await createThreadFn({ data: { source: "dashboard_hero" } });
      // Stash first message in history state so the thread page can auto-send.
      window.history.replaceState(
        { ...(window.history.state ?? {}), firstMessage: message },
        "",
      );
      navigate({ to: "/ask/$threadId", params: { threadId: id } });
    } catch (e) {
      console.error(e);
      setBusy(false);
    }
  };

  return (
    <section className="relative flex min-h-[calc(100vh-3.5rem)] flex-col justify-center px-4 sm:px-6 py-10 sm:py-14">
      <div className="reveal-up mb-8 flex justify-end lg:absolute lg:right-8 lg:top-9 lg:mb-0 xl:right-12">
        <div className="w-full max-w-[310px] rounded-2xl border border-border bg-card/88 p-3 shadow-[0_18px_45px_-28px_color-mix(in_oklab,var(--ink)_45%,transparent)] backdrop-blur">
          <div className="flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink text-cream">
              <Map className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-signal animate-signal-pulse" />
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal">
                  Client beta live
                </p>
              </div>
              <p className="mt-1 text-[12.5px] leading-snug text-foreground/78">
                Start the Contractor OS install path, then save the Navigator result to Vault.
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link
              to="/operating-playbook"
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-ink px-2.5 py-2 text-[11px] font-medium text-cream hover:opacity-90"
            >
              Start path <ArrowUpRight className="h-3 w-3" />
            </Link>
            <Link
              to="/tools"
              search={{ t: "cos-navigator" } as never}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-[11px] font-medium text-foreground/78 hover:bg-muted"
            >
              Navigator <RouteIcon className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-[820px]">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-[12px] uppercase tracking-[0.18em] text-muted-foreground">
            · Ask Marshall · {today || "\u00A0"}
          </p>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            v4
          </p>
        </div>

        <h1 className="reveal-up mt-8 font-display text-[2.25rem] leading-[1.05] tracking-tight sm:text-[3.25rem]">
          {greeting}, {companyName}.
          {greetingIcon && (
            <GreetingIcon
              iconKey={greetingIcon}
              className="ml-3 inline-block align-middle text-[2rem] sm:text-[2.75rem]"
            />
          )}
        </h1>
        <p
          className="reveal-up mt-3 text-[15px] text-muted-foreground"
          style={{ animationDelay: "120ms" }}
        >
          Bring me one issue, {firstName}. I'll give you the read and a next move.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="reveal-up mt-8"
          style={{ animationDelay: "220ms" }}
        >
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm focus-within:border-foreground/40">
            <textarea
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Ask Marshall anything…"
              rows={1}
              className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink text-cream transition-opacity disabled:opacity-40"
              aria-label="Send"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </form>

        <div
          className="reveal-up mt-5 flex flex-wrap justify-center gap-2"
          style={{ animationDelay: "320ms" }}
        >
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void send(s)}
              disabled={busy}
              className="rounded-full border border-border bg-card px-3.5 py-1.5 text-[14px] italic text-foreground/85 transition-colors hover:bg-muted disabled:opacity-50"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {s}
            </button>
          ))}
        </div>

        <div
          className="reveal-up mt-10 flex justify-center"
          style={{ animationDelay: "420ms" }}
        >
          <p
            className="max-w-[620px] rounded-2xl border border-border bg-card px-6 py-4 text-center text-[13px] leading-relaxed text-foreground/85"
            style={{
              fontFamily: "var(--font-serif)",
              boxShadow:
                "0 14px 40px -18px color-mix(in oklab, var(--ink) 35%, transparent), 0 2px 6px -2px color-mix(in oklab, var(--ink) 18%, transparent)",
            }}
          >
            You're talking to me. This is trained on my own playbooks, SOPs,
            field notes, and lessons from $2.5B in construction.
          </p>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <span
            className="text-[14px] italic"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Your command center
          </span>
          <ChevronDown className="h-4 w-4 animate-bounce" />
        </div>
      </div>
    </section>
  );
}
