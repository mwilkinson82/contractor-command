import { useEffect, useRef, useState } from "react";

export type ComputeStep = { label: string; ms?: number };

export function ComputeStream({
  steps,
  running,
  onDone,
}: {
  steps: ComputeStep[];
  running: boolean;
  onDone?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!running) return;
    setIndex(0);
    let i = 0;
    const tick = () => {
      i += 1;
      setIndex(i);
      if (i >= steps.length) {
        onDone?.();
        return;
      }
      timerRef.current = setTimeout(tick, steps[i - 1]?.ms ?? 420);
    };
    timerRef.current = setTimeout(tick, 280);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return (
    <div className="space-y-1.5">
      {steps.slice(0, Math.min(index + 1, steps.length)).map((s, i) => {
        const isCurrent = running && i === index && i < steps.length;
        return (
          <div
            key={i}
            className="compute-line flex items-center gap-2 text-[12px]"
            style={{ animationDelay: `${i * 30}ms` }}
          >
            <span className={isCurrent ? "text-signal" : "text-cream/40"}>
              {isCurrent ? "▸" : "✓"}
            </span>
            <span className={isCurrent ? "text-cream" : "text-cream/55"}>{s.label}</span>
            {isCurrent && <span className="inline-block h-3 w-1.5 bg-cream/80 animate-cursor-blink" />}
          </div>
        );
      })}
    </div>
  );
}
