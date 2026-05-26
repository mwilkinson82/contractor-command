import { useState } from "react";
import { Plus, Upload, Sparkles, ClipboardPaste, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { XerImportButton } from "./XerImportButton";
import type { Dependency, Task } from "@/lib/scheduler/types";
import {
  commercialFitOutSample,
  parsePastedActivities,
  type SamplePayload,
} from "@/lib/scheduler/sample";

interface Props {
  onAddActivity: () => void;
  onApplySample: (payload: SamplePayload) => void;
  onApplyPasted: (input: { tasks: Task[]; dependencies: Dependency[] }) => void;
  onXerImport: (input: {
    name: string;
    projectStartDate?: string;
    tasks: Task[];
    dependencies: Dependency[];
  }) => void;
  /** UI-2.1 — primary CTA: opens Schedule Intelligence → Build full-screen. */
  onBuildWithAi?: () => void;
}

export function EmptyScheduleState({
  onAddActivity,
  onApplySample,
  onApplyPasted,
  onXerImport,
  onBuildWithAi,
}: Props) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const handlePaste = () => {
    const parsed = parsePastedActivities(pasteText);
    if (parsed.tasks.length === 0) return;
    onApplyPasted(parsed);
    setPasteOpen(false);
    setPasteText("");
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-[var(--sched-surface-rule)] bg-[#fbfaf6] p-8 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_24px_60px_-30px_rgba(60,40,10,0.25)]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--sched-graphite-strong)] text-[var(--sched-brass-soft)]">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-medium tracking-tight text-[var(--sched-graphite-strong)]">
            Start your CPM schedule
          </h2>
          <p className="mt-1 text-sm text-[var(--sched-graphite)]">
            Describe the job. Baseline builds the CPM. Or start from a sample, XER, or by hand.
          </p>
        </div>

        {onBuildWithAi ? (
          <button
            type="button"
            onClick={onBuildWithAi}
            data-testid="empty-schedule-build-with-ai"
            className="group mb-3 flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--sched-graphite-strong)] bg-gradient-to-br from-[var(--sched-graphite-strong)] to-[var(--sched-graphite-strong)] p-4 text-left text-[var(--sched-brass-soft)] transition hover:from-[var(--sched-graphite-strong)] hover:to-[var(--sched-graphite-strong)]"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--sched-brass-soft)] text-[var(--sched-graphite-strong)]">
                <Wand2 className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold tracking-tight">
                  Build with AI
                </div>
                <div className="text-xs text-[var(--sched-brass-soft)]">
                  Open the Build workspace — paste scope, an activity list, or an SOV.
                </div>
              </div>
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--sched-brass-soft)] group-hover:text-[var(--sched-brass-soft)]">
              Open →
            </span>
          </button>
        ) : null}



        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onApplySample(commercialFitOutSample())}
            className="group flex flex-col items-start gap-2 rounded-xl border border-[var(--sched-graphite-strong)] bg-[var(--sched-graphite-strong)] p-4 text-left text-[var(--sched-brass-soft)] transition hover:bg-[var(--sched-graphite-strong)]"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              Create from sample
            </div>
            <div className="text-xs text-[var(--sched-brass-soft)]">
              Loads a 32-activity Commercial Fit-Out with WBS, deps, and progress.
            </div>
          </button>

          <button
            type="button"
            onClick={onAddActivity}
            className="group flex flex-col items-start gap-2 rounded-xl border border-[var(--sched-surface-rule)] bg-white p-4 text-left transition hover:border-[var(--sched-graphite-strong)]"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--sched-graphite-strong)]">
              <Plus className="h-4 w-4" />
              Add activity
            </div>
            <div className="text-xs text-[var(--sched-graphite)]">
              Start from a blank row and build up by hand.
            </div>
          </button>

          <div className="flex flex-col items-start gap-2 rounded-xl border border-[var(--sched-surface-rule)] bg-white p-4 transition hover:border-[var(--sched-graphite-strong)]">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--sched-graphite-strong)]">
              <Upload className="h-4 w-4" />
              Import XER
            </div>
            <div className="text-xs text-[var(--sched-graphite)]">
              Bring in an existing Primavera P6 schedule (.xer).
            </div>
            <div className="-mx-1 mt-1">
              <XerImportButton onImport={onXerImport} />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPasteOpen(true)}
            className="group flex flex-col items-start gap-2 rounded-xl border border-[var(--sched-surface-rule)] bg-white p-4 text-left transition hover:border-[var(--sched-graphite-strong)]"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--sched-graphite-strong)]">
              <ClipboardPaste className="h-4 w-4" />
              Paste activity list
            </div>
            <div className="text-xs text-[var(--sched-graphite)]">
              Paste from Excel — Name, Duration, optional WBS / % / Resource.
            </div>
          </button>
        </div>
      </div>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste activity list</DialogTitle>
            <DialogDescription>
              One activity per line. Tab- or comma-separated. Columns:{" "}
              <code className="rounded bg-muted px-1">name, duration, wbs, percent, resource</code>.
              A header row is optional.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={12}
            placeholder={"Demolition\t8\nMEP Rough-In\t12\nDrywall Hang & Tape\t10"}
            className="font-mono text-xs"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPasteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handlePaste} disabled={pasteText.trim().length === 0}>
              Add activities
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
