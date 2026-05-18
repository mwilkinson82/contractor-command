// Compute Theater — the "AI is computing" moment for a Command Tool.
// Manus-inspired: a clean paper panel with a breadcrumb header, a file tab,
// reasoning steps on the left, and a softly syntax-styled stream on the right.
// Not a green terminal — this should read as the system doing real work,
// in the same paper/ink language as the rest of the portal.

import { useEffect, useRef, useState } from "react";
import { Check, FileCode2, Loader2, Sparkles } from "lucide-react";

export type ComputeStep = { label: string; ms?: number };

export function ComputeTheater({
  steps,
  ticker,
  running,
  onDone,
  subtitle,
  fileLabel,
}: {
  steps: ComputeStep[];
  ticker: string[];
  running: boolean;
  onDone?: () => void;
  subtitle?: string;
  /** Faux file path shown in the header + tab, e.g. "tools/estimate-throughput.calc" */
  fileLabel?: string;
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

  // Stream — paced to roughly match the steps timeline
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
      const jitter = Math.random() * 80 - 40;
      tickerTimer.current = setTimeout(push, Math.max(40, perLine + jitter));
    };
    tickerTimer.current = setTimeout(push, 180);
    return () => {
      if (tickerTimer.current) clearTimeout(tickerTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [visibleTicker]);

  const file = fileLabel ?? "engine/command.calc";

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)]">
      {/* Header — breadcrumb-style, like Manus "is using Editor · Reading file …" */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/60 px-5 py-3">
        <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
          {running ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-foreground/70" />
          ) : (
            <Check className="h-3.5 w-3.5 shrink-0 text-signal-success" />
          )}
          <span className="font-medium text-foreground">ALP Engine</span>
          <span className="text-muted-foreground/60">is</span>
          <span className="text-foreground/80">{running ? "computing" : "done"}</span>
          {subtitle ? (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="truncate text-foreground/70">{subtitle}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
          <FileCode2 className="h-3.5 w-3.5" />
          <span className="truncate">{file}</span>
        </div>
      </header>

      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* Reasoning */}
        <div className="border-b border-border p-5 md:border-b-0 md:border-r">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-foreground/50" />
            <p className="label-mono">Reasoning</p>
          </div>
          <ol className="mt-3 space-y-2.5">
            {steps.map((s, i) => {
              const isDone = i < stepIdx;
              const isCurrent = running && i === stepIdx;
              return (
                <li
                  key={i}
                  className={`flex items-start gap-2.5 text-[13px] leading-snug transition-opacity ${
                    isDone || isCurrent ? "opacity-100" : "opacity-30"
                  }`}
                >
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">
                    {isDone ? (
                      <Check className="h-3 w-3 text-signal-success" />
                    ) : isCurrent ? (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-foreground animate-signal-pulse" />
                    ) : (
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-foreground/25" />
                    )}
                  </span>
                  <span
                    className={
                      isCurrent
                        ? "text-foreground"
                        : isDone
                          ? "text-foreground/80"
                          : "text-muted-foreground"
                    }
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Stream — soft "editor" surface, syntax-flavored but on paper */}
        <div className="p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="label-mono">Stream</p>
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {visibleTicker.length}/{ticker.length}
            </span>
          </div>

          {/* file tab */}
          <div className="mt-3 flex items-center gap-2 rounded-t-md border border-b-0 border-border bg-background/80 px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
            <span className="h-2 w-2 rounded-full bg-foreground/15" />
            <span className="ml-2 font-mono text-[10.5px] text-muted-foreground">{file}</span>
          </div>

          <div
            ref={scrollerRef}
            className="h-[200px] overflow-y-auto rounded-b-md border border-border bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed scrollbar-thin"
          >
            {visibleTicker.length === 0 ? (
              <span className="text-muted-foreground/60">waiting for inputs…</span>
            ) : (
              visibleTicker.map((line, i) => (
                <div
                  key={i}
                  className="ticker-line flex gap-3 whitespace-pre-wrap"
                  style={{ animationDelay: `${Math.min(i * 12, 200)}ms` }}
                >
                  <span className="select-none text-muted-foreground/40">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <SyntaxLine text={line} />
                </div>
              ))
            )}
            {running && (
              <span className="mt-1 inline-block h-3 w-1.5 bg-foreground/60 animate-cursor-blink" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Lightweight tokenizer: colors keywords, numbers, strings, and arrows
 * without leaning into the green-terminal cliché. Tuned for the
 * paper/ink palette.
 */
function SyntaxLine({ text }: { text: string | undefined }) {
  const safe = text ?? "";
  // Highlight a few token classes:
  // - leading keyword (load/derive/compare/project/rank/compose/done)
  // - $… or % numbers
  // - "→" arrow indent lines
  // - bare numbers
  const parts: { t: string; cls: string }[] = [];
  const keywordRe = /^(\s*)(load|derive|compare|project|rank|compose|done\.?)\b/;
  const m = safe.match(keywordRe);
  let rest = text;
  if (m) {
    parts.push({ t: m[1] ?? "", cls: "" });
    parts.push({ t: m[2], cls: "text-signal font-semibold" });
    rest = text.slice(m[0].length);
  }

  // Tokenize the rest by simple regex passes.
  const tokens = rest.split(
    /(\b\d[\d,]*(?:\.\d+)?\b|\$[\d,]+(?:\.\d+)?|[A-Za-z_]+\.[a-z_]+|→|\b%[\d.]*|=|\/wk|\/yr)/g,
  );
  for (const tk of tokens) {
    if (!tk) continue;
    if (tk === "→") parts.push({ t: tk, cls: "text-foreground/40" });
    else if (/^\$[\d,]/.test(tk) || /^\d/.test(tk))
      parts.push({ t: tk, cls: "text-foreground font-medium" });
    else if (/^[A-Za-z_]+\.[a-z_]+$/.test(tk))
      parts.push({ t: tk, cls: "text-foreground/85" });
    else if (tk === "=" || tk === "/wk" || tk === "/yr")
      parts.push({ t: tk, cls: "text-muted-foreground" });
    else parts.push({ t: tk, cls: "text-foreground/65" });
  }

  return (
    <span>
      {parts.map((p, i) => (
        <span key={i} className={p.cls}>
          {p.t}
        </span>
      ))}
    </span>
  );
}
