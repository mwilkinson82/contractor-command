import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ArrowUp, ArrowUpRight, Map, Route as RouteIcon } from "lucide-react";
import { createThread } from "@/lib/ask.functions";
import { GreetingIcon, type GreetingIconKey } from "@/components/portal/greeting-icon";
import type { DashboardMove } from "@/components/portal/dashboard-moves";

const STARTERS = ["Pricing is too slow", "Cash is tight", "I need to hire a #2"];

export function HomeHero({
  companyName,
  greeting,
  firstName,
  today,
  greetingIcon,
  moves,
  aosLinked,
}: {
  companyName: string;
  greeting: string;
  firstName: string;
  today: string;
  greetingIcon?: GreetingIconKey | null;
  moves: DashboardMove[];
  aosLinked: boolean;
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
      window.history.replaceState({ ...(window.history.state ?? {}), firstMessage: message }, "");
      navigate({ to: "/ask/$threadId", params: { threadId: id } });
    } catch (error) {
      console.error(error);
      setBusy(false);
    }
  };

  const primaryMove = moves[0];
  const ownerMove = moves.find((move) => move.owner);
  const commandMove = moves.find((move) => move.source !== "AOS");
  const moveCount = moves.length;
  const activeDay = today ? new Date().getDay() : 0;
  const week = [
    {
      day: "Monday",
      label: "Choose the move",
      detail: primaryMove?.title ?? "Name the constraint",
    },
    {
      day: "Tuesday",
      label: "Run the instrument",
      detail: commandMove?.source ?? "COS Navigator",
    },
    {
      day: "Wednesday",
      label: "Assign the owner",
      detail: ownerMove?.owner ?? "Put one name on it",
    },
    {
      day: "Thursday",
      label: "Pressure-test it",
      detail: "Bring one issue to the room",
    },
    {
      day: "Friday",
      label: "Record the win",
      detail: "Close the loop in Vault",
    },
  ];

  return (
    <section className="relative px-4 pb-8 pt-10 sm:px-6 sm:pb-10 sm:pt-14">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="grid gap-6 border-b border-border pb-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)] lg:items-end">
          <div className="max-w-[760px]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="h-8 w-[3px] rounded-full bg-signal" aria-hidden="true" />
              <p className="label-mono">Daily brief · {today || "Today"}</p>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {companyName}
              </span>
            </div>

            <p className="mt-7 text-[14px] text-muted-foreground">
              {greeting}, {firstName}.
              {greetingIcon ? (
                <GreetingIcon
                  iconKey={greetingIcon}
                  className="ml-2 inline-block align-middle text-xl"
                />
              ) : null}
            </p>
            <h1 className="mt-3 max-w-[720px] font-display text-[2.8rem] leading-[0.98] tracking-[-0.035em] sm:text-[4.35rem]">
              The company is moving.{" "}
              {moveCount === 1 ? "One commitment is" : `${moveCount} commitments are`} waiting on a
              move.
            </h1>
            <p className="mt-5 max-w-[650px] text-[15px] leading-relaxed text-muted-foreground sm:text-[16px]">
              {aosLinked
                ? "Your AOS operating read and Contractor Circle signals are together here. Choose the move that removes the most drag, then put an owner and a deadline on it."
                : "This read comes from your Contractor Circle tools and Vault. Connect AOS below to add the company operating view without replacing the work already here."}
            </p>
          </div>

          <div className="space-y-3">
            <article className="overflow-hidden rounded-xl border border-ink/15 bg-ink shadow-[0_18px_50px_-38px_color-mix(in_oklab,var(--ink)_55%,transparent)]">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-good">
                    <span
                      className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-good"
                      aria-hidden="true"
                    />
                    Thursday Contractor Circle Call
                  </p>
                  <h2 className="mt-1 font-display text-[20px] leading-tight text-cream">
                    Daily Project WIP Implementation
                  </h2>
                </div>
              </div>
              <div className="relative h-0 bg-black pb-[53.7927%]">
                <iframe
                  src="https://www.loom.com/embed/22d11e96c7084343b7160092a53575b9"
                  title="Daily Project WIP Implementation — Thursday Contractor Circle Call"
                  allow="autoplay; fullscreen; picture-in-picture"
                  allowFullScreen
                  loading="lazy"
                  className="absolute inset-0 h-full w-full"
                />
              </div>
            </article>

            <div className="rounded-xl border border-border bg-card p-4 shadow-[0_18px_50px_-38px_color-mix(in_oklab,var(--ink)_38%,transparent)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="label-mono text-clay">Ask Marshall</p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    Bring one issue. Get the read and the next move.
                  </p>
                </div>
                <Link
                  to="/ask"
                  className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-foreground/75 hover:text-foreground"
                >
                  History <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void send(input);
                }}
                className="mt-4"
              >
                <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-1.5 focus-within:border-foreground/35">
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void send(input);
                      }
                    }}
                    placeholder="Ask about the move in front of you…"
                    rows={2}
                    className="max-h-28 min-h-[52px] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    type="submit"
                    disabled={busy || !input.trim()}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink text-cream disabled:opacity-35"
                    aria-label="Send to Ask Marshall"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                </div>
              </form>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void send(starter)}
                    disabled={busy}
                    className="rounded-full border border-border px-2.5 py-1 text-[10px] text-foreground/70 hover:bg-muted disabled:opacity-40"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid border-b border-border sm:grid-cols-5">
          {week.map((step, index) => {
            const isToday =
              activeDay >= 1 && activeDay <= 5 ? activeDay === index + 1 : index === 0;
            return (
              <div
                key={step.day}
                className={`relative min-w-0 border-border px-3 py-4 sm:border-r sm:last:border-r-0 ${isToday ? "bg-card" : ""}`}
              >
                {isToday ? <span className="absolute inset-x-0 top-0 h-0.5 bg-signal" /> : null}
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                  {step.day}
                </p>
                <p className="mt-2 text-[12px] font-semibold text-foreground">{step.label}</p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Map className="h-3.5 w-3.5 text-foreground" />
            <span>Contractor OS path</span>
            <span aria-hidden="true">·</span>
            <span>Every finding lands in your Vault.</span>
          </div>
          <div className="flex gap-4">
            <Link
              to="/operating-playbook"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              Open path <ArrowRight className="h-3 w-3" />
            </Link>
            <Link
              to="/tools"
              search={{ t: "cos-navigator" } as never}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              Navigator <RouteIcon className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
