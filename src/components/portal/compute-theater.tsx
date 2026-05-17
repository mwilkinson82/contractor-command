// Compute Theater — the "AI is computing" moment for a Command Tool.
// Hybrid layout: ordered steps on the left, live data ticker on the right.
// Calls onDone() when the choreographed timeline finishes so the parent
// can reveal the actual result.

import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

export type ComputeStep = { label: string; ms?: number };

export function ComputeTheater({
  steps,
  ticker,
  running,
  onDone,
  subtitle,
}: {
  steps: ComputeStep[];
  ticker: string[];
  running: boolean;
  onDone?: () => void;
  subtitle?: string;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [visibleTicker, setVisibleTicker] = useState<string[]>([]);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Steps progression
  useEffect(() => {
    if (!running) return;
    setStepIdx(0);
    let i = 0;
    const tick = () => {
      i += 1;
      setStepIdx(i);
      if (i >= steps.length) {
        // small delay after last step before declaring done
        stepTimer.current = setTimeout(() => onDone?.(), 320);
        return;
      }
      stepTimer.current = setTimeout(tick, steps[i - 1]?.ms ?? 420);
    };
    stepTimer.current = setTimeout(tick, 260);
    return () => {
      if (stepTimer.current) clearTimeout(stepTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // Ticker stream — paced to roughly match the steps timeline
  useEffect(() => {
    if (!running) {
      setVisibleTicker([]);
      return;
    }
    setVisibleTicker([]);
    const totalMs = steps.reduce((acc, s) => acc + (s.ms ?? 420), 280);
    const perLine = Math.max(70, Math.floor(totalMs / Math.max(1, ticker.length)));
    let i = 0;
    const push = () => {
      if (i >= ticker.length) return;
      setVisibleTicker((prev) => [...prev, ticker[i]]);
      i += 1;
      // jitter so it doesn't feel mechanical
      const jitter = Math.random() * 80 - 40;
      tickerTimer.current = setTimeout(push, Math.max(40, perLine + jitter));
    };
    tickerTimer.current = setTimeout(push, 180);
    return () => {
      if (tickerTimer.current) clearTimeout(tickerTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  // Auto-scroll ticker to bottom
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [visibleTicker]);

  return (
    <div className="rounded-2xl border border-border bg-ink text-cream shadow-[var(--shadow-soft)] overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-cream/10 px-5 py-3">
        <div className="flex items-center gap-2">
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-signal-success" />
          ) : (
            <Check className="h-3.5 w-3.5 text-signal-success" />
          )}
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cream/70">
            {running ? "Computing" : "Complete"}
            {subtitle ? <span className="ml-2 text-cream/40 normal-case tracking-normal">· {subtitle}</span> : null}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/40">
          ALP // Command Engine
        </span>
      </header>

      <div className="grid gap-0 md:grid-cols-[1fr_1.1fr]">
        {/* Steps panel */}
        <div className="border-b border-cream/10 p-5 md:border-b-0 md:border-r">
          <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-cream/40">
            Reasoning
          </p>
          <ol className="mt-3 space-y-2">
            {steps.map((s, i) => {
              const isDone = i < stepIdx;
              const isCurrent = running && i === stepIdx;
              return (
                <li
                  key={i}
                  className={`flex items-start gap-2.5 text-[12.5px] leading-snug transition-opacity ${
                    isDone || isCurrent ? "opacity-100" : "opacity-25"
                  }`}
                >
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">
                    {isDone ? (
                      <Check className="h-3 w-3 text-signal-success" />
                    ) : isCurrent ? (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal-success animate-signal-pulse" />
                    ) : (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-cream/25" />
                    )}
                  </span>
                  <span className={isCurrent ? "text-cream" : isDone ? "text-cream/80" : "text-cream/60"}>
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Ticker panel */}
        <div className="p-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.24em] text-cream/40">
            Stream
          </p>
          <div
            ref={scrollerRef}
            className="mt-3 h-[180px] overflow-y-auto rounded-md bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-cream/70 scrollbar-thin"
          >
            {visibleTicker.length === 0 ? (
              <span className="text-cream/30">waiting for inputs…</span>
            ) : (
              visibleTicker.map((line, i) => (
                <div
                  key={i}
                  className="ticker-line whitespace-pre-wrap"
                  style={{ animationDelay: `${Math.min(i * 12, 200)}ms` }}
                >
                  <span className="text-cream/35">{String(i + 1).padStart(2, "0")}  </span>
                  <span>{line}</span>
                </div>
              ))
            )}
            {running && (
              <span className="mt-1 inline-block h-3 w-1.5 bg-signal-success/80 animate-cursor-blink" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
