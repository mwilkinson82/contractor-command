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
      <div className="w-full max-w-2xl rounded-2xl border border-[#e3e0d8] bg-[#fbfaf6] p-8 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_24px_60px_-30px_rgba(60,40,10,0.25)]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#1a1a1a] text-[#f7e9c2]">
            <Sparkles className="h-5 w-5" />
          </div>
          <h2 className="text-xl font-medium tracking-tight text-[#1a1a1a]">
            Start your CPM schedule
          </h2>
          <p className="mt-1 text-sm text-[#6b6a63]">
            Describe the job. Baseline builds the CPM. Or start from a sample, XER, or by hand.
          </p>
        </div>

        {onBuildWithAi ? (
          <button
            type="button"
            onClick={onBuildWithAi}
            data-testid="empty-schedule-build-with-ai"
            className="group mb-3 flex w-full items-center justify-between gap-3 rounded-xl border border-[#1a1a1a] bg-gradient-to-br from-[#1a1a1a] to-[#2a2a2a] p-4 text-left text-[#f7e9c2] transition hover:from-[#2a2a2a] hover:to-[#1a1a1a]"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#f7e9c2] text-[#1a1a1a]">
                <Wand2 className="h-4 w-4" />
              </span>
              <div>
                <div className="text-sm font-semibold tracking-tight">
                  Build with AI
                </div>
                <div className="text-xs text-[#d9c89a]">
                  Open the Build workspace — paste scope, an activity list, or an SOV.
                </div>
              </div>
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d9c89a] group-hover:text-[#f7e9c2]">
              Open →
            </span>
          </button>
        ) : null}



        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onApplySample(commercialFitOutSample())}
            className="group flex flex-col items-start gap-2 rounded-xl border border-[#1a1a1a] bg-[#1a1a1a] p-4 text-left text-[#f7e9c2] transition hover:bg-[#2a2a2a]"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              Create from sample
            </div>
            <div className="text-xs text-[#d9c89a]">
              Loads a 32-activity Commercial Fit-Out with WBS, deps, and progress.
            </div>
          </button>

          <button
            type="button"
            onClick={onAddActivity}
            className="group flex flex-col items-start gap-2 rounded-xl border border-[#dad7cd] bg-white p-4 text-left transition hover:border-[#1a1a1a]"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-[#1a1a1a]">
              <Plus className="h-4 w-4" />
              Add activity
            </div>
            <div className="text-xs text-[#6b6a63]">
              Start from a blank row and build up by hand.
            </div>
          </button>

          <div className="flex flex-col items-start gap-2 rounded-xl border border-[#dad7cd] bg-white p-4 transition hover:border-[#1a1a1a]">
            <div className="flex items-center gap-2 text-sm font-medium text-[#1a1a1a]">
              <Upload className="h-4 w-4" />
              Import XER
            </div>
            <div className="text-xs text-[#6b6a63]">
              Bring in an existing Primavera P6 schedule (.xer).
            </div>
            <div className="-mx-1 mt-1">
              <XerImportButton onImport={onXerImport} />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPasteOpen(true)}
            className="group flex flex-col items-start gap-2 rounded-xl border border-[#dad7cd] bg-white p-4 text-left transition hover:border-[#1a1a1a]"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-[#1a1a1a]">
              <ClipboardPaste className="h-4 w-4" />
              Paste activity list
            </div>
            <div className="text-xs text-[#6b6a63]">
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
