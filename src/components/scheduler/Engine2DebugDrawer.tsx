/**
 * Phase 2.7 — internal-only Engine2 comparison debug drawer.
 *
 * GUARDRAILS:
 *   - Renders `null` unless BOTH the engine2 comparison flag AND dev
 *     mode are on (see `shouldShowEngine2DebugViewer`). In a production
 *     build with default flags, this component is a no-op.
 *   - Never mutates the schedule, the legacy result, or the report.
 *   - Never blocks the main scheduler view (Sheet overlays on demand).
 *   - Never makes engine2 authoritative.
 *
 * Trigger is a small bottom-right pill so it cannot be confused with
 * normal product UI. Copy / download exports let developers ship the
 * report out of the browser easily.
 */

import { useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  buildComparisonViewModel,
  resolveDebugViewerVisibility,
  viewModelToJsonBlob,
  type DebugDifferenceRow,
  type DebugViewerViewModel,
} from "@/lib/scheduler/engine2/debug-viewer";
import type { ComparisonReport } from "@/lib/scheduler/engine2";

interface Engine2DebugDrawerProps {
  report?: ComparisonReport;
  /** Test/storybook override. When omitted, real flag resolution is used. */
  forceVisible?: boolean;
  /** Optional engine2 error string when no report was produced. */
  error?: string;
}

const SEVERITY_COLOR: Record<DebugDifferenceRow["severity"], string> = {
  high: "bg-red-600 text-white",
  medium: "bg-amber-500 text-black",
  low: "bg-zinc-300 text-zinc-800",
};

export function Engine2DebugDrawer({
  report,
  forceVisible,
  error,
}: Engine2DebugDrawerProps) {
  const visible = forceVisible ?? resolveDebugViewerVisibility();
  const vm = useMemo<DebugViewerViewModel | null>(
    () => (report ? buildComparisonViewModel(report) : null),
    [report],
  );
  const [copied, setCopied] = useState(false);

  if (!visible) return null;

  const handleCopy = async () => {
    if (!vm) return;
    try {
      await navigator.clipboard.writeText(vm.formattedReport);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // eslint-disable-next-line no-console
      console.info(vm.formattedReport);
    }
  };

  const handleDownloadJson = () => {
    if (!vm) return;
    const blob = new Blob([viewModelToJsonBlob(vm)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `engine2-comparison-${vm.scheduleName.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          data-testid="engine2-debug-trigger"
          className="fixed bottom-3 right-3 z-50 rounded-full border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 text-[11px] font-mono text-zinc-100 shadow-lg hover:bg-zinc-800"
        >
          engine2 · {vm ? vm.verdict : error ? "error" : "no report"}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">
            Engine2 Comparison · {vm?.scheduleName ?? "(no schedule)"}
          </SheetTitle>
          <SheetDescription>
            Internal-only. Legacy remains authoritative. Engine2 output is
            informational.
          </SheetDescription>
        </SheetHeader>

        {error && !vm ? (
          <div className="mt-4 rounded border border-red-500 bg-red-50 p-3 text-xs text-red-900">
            engine2 ERROR: {error}
          </div>
        ) : null}

        {vm ? (
          <div className="mt-4 space-y-4 text-xs">
            <section className="grid grid-cols-2 gap-3">
              <Stat label="Verdict" value={vm.verdict.toUpperCase()} />
              <Stat
                label="Engines"
                value={`${vm.legacyEngineVersion} / ${vm.engine2Version}`}
              />
              <Stat
                label="Activities"
                value={`legacy ${vm.activityCount.legacy} · engine2 ${vm.activityCount.engine2}`}
              />
              <Stat
                label="Relationships"
                value={`legacy ${vm.relationshipCount.legacy} · engine2 ${vm.relationshipCount.engine2}`}
              />
              <Stat
                label="Exact date matches"
                value={`${vm.exactDateMatches} / ${vm.activityCount.legacy}`}
              />
              <Stat label="Mismatches" value={String(vm.mismatchCount)} />
            </section>

            {vm.engine2Error ? (
              <div className="rounded border border-red-500 bg-red-50 p-3 text-red-900">
                engine2 ERROR: {vm.engine2Error}
              </div>
            ) : null}

            <section>
              <h3 className="mb-2 font-semibold">Classification</h3>
              <div className="flex flex-wrap gap-1.5">
                {vm.classificationSummary.length === 0 ? (
                  <span className="text-zinc-500">clean</span>
                ) : (
                  vm.classificationSummary.map((c) => (
                    <Badge
                      key={c.classification}
                      className={
                        c.classification === "investigate"
                          ? "bg-red-600 text-white"
                          : c.classification === "known-engine-limitation"
                            ? "bg-amber-500 text-black"
                            : "bg-zinc-300 text-zinc-800"
                      }
                    >
                      {c.classification}: {c.count}
                    </Badge>
                  ))
                )}
              </div>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">By category</h3>
              <div className="flex flex-wrap gap-1.5">
                {vm.categorySummary.length === 0 ? (
                  <span className="text-zinc-500">none</span>
                ) : (
                  vm.categorySummary.map((c) => (
                    <Badge key={c.category} variant="outline">
                      {c.category}: {c.count}
                    </Badge>
                  ))
                )}
              </div>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">
                Top differences ({vm.topDifferences.length})
              </h3>
              <div className="space-y-2">
                {vm.topDifferences.map((row, i) => (
                  <DiffCard key={`${row.id}-${row.category}-${i}`} row={row} />
                ))}
                {vm.topDifferences.length === 0 ? (
                  <p className="text-zinc-500">No differences.</p>
                ) : null}
              </div>
            </section>

            <section>
              <h3 className="mb-2 font-semibold">Diagnostics</h3>
              <p>engine2 diagnostics: {vm.diagnostics.engine2Count}</p>
              {vm.diagnostics.knownLimitations.length > 0 ? (
                <ul className="mt-1 list-inside list-disc text-zinc-700">
                  {vm.diagnostics.knownLimitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1 text-zinc-500">
                legacy {vm.runRecord.legacyDurationMs}ms · engine2{" "}
                {vm.runRecord.engine2DurationMs}ms · exception-clock={" "}
                {String(vm.runRecord.useExceptionAwareCalendars)}
              </p>
            </section>

            <section className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleCopy}>
                {copied ? "Copied" : "Copy report"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownloadJson}>
                Download JSON
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  // eslint-disable-next-line no-console
                  console.info(vm.formattedReport);
                }}
              >
                Log to console
              </Button>
            </section>

            <details className="rounded border border-zinc-200 bg-zinc-50 p-2">
              <summary className="cursor-pointer text-zinc-600">
                Raw formatted report
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-all text-[10px] text-zinc-800">
                {vm.formattedReport}
              </pre>
            </details>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5 font-mono">{value}</div>
    </div>
  );
}

function DiffCard({ row }: { row: DebugDifferenceRow }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold">{row.id}</span>
        <Badge className={SEVERITY_COLOR[row.severity]}>
          {row.classification}
        </Badge>
      </div>
      <div className="mt-1 text-zinc-600">{row.category}</div>
      <div className="mt-1 grid grid-cols-2 gap-2 font-mono text-[11px]">
        <div>
          <div className="text-[10px] uppercase text-zinc-500">legacy</div>
          <div>{row.legacyValue}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-zinc-500">engine2</div>
          <div>{row.engine2Value}</div>
        </div>
      </div>
      {row.likelyCause ? (
        <p className="mt-1 text-zinc-700">
          <span className="font-semibold">Cause:</span> {row.likelyCause}
        </p>
      ) : null}
      {row.recommendedAction ? (
        <p className="text-zinc-700">
          <span className="font-semibold">Action:</span> {row.recommendedAction}
        </p>
      ) : null}
    </div>
  );
}
