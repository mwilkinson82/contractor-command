import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileDown } from "lucide-react";
import type { ScheduleResult } from "@/lib/scheduler/types";
import { buildReportHtml, openReportWindow, type ReportKind } from "@/lib/scheduler/reports";

interface Props {
  result: ScheduleResult;
  /** CSS selector to a container that holds the rendered Gantt SVG. */
  ganttContainerSelector?: string;
}

const KINDS: { value: ReportKind; label: string; hint: string }[] = [
  { value: "critical", label: "Critical path", hint: "All driving activities, in date order" },
  { value: "float", label: "Total float", hint: "Sorted by least slack first" },
  { value: "lookahead", label: "Look-ahead", hint: "Activities in a forward window" },
  { value: "full", label: "Full schedule", hint: "Every activity, ES order" },
  { value: "gantt", label: "Gantt chart", hint: "Bar chart snapshot" },
];

const LOOKAHEAD_OPTIONS = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "3 weeks", days: 21 },
  { label: "6 weeks", days: 42 },
];

export function ReportsPanel({ result, ganttContainerSelector }: Props) {
  const [kind, setKind] = useState<ReportKind>("critical");
  const [lookAheadDays, setLookAheadDays] = useState(21);

  const generate = () => {
    let ganttSvg: string | undefined;
    if (kind === "gantt" && ganttContainerSelector) {
      const node = document.querySelector(`${ganttContainerSelector} svg`);
      if (node) ganttSvg = node.outerHTML;
    }
    const html = buildReportHtml(result, { kind, lookAheadDays, ganttSvg });
    openReportWindow(html);
  };

  const active = KINDS.find((k) => k.value === kind);

  return (
    <section className="rounded border border-[var(--sched-surface-rule)] bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--sched-graphite)]">
        Reports & export
      </h2>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Report type</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as ReportKind)}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k.value} value={k.value}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {active ? <p className="mt-1 text-[11px] text-[var(--sched-graphite)]">{active.hint}</p> : null}
        </div>

        {kind === "lookahead" ? (
          <div>
            <Label className="text-xs">Window</Label>
            <Select
              value={String(lookAheadDays)}
              onValueChange={(v) => setLookAheadDays(Number(v))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOOKAHEAD_OPTIONS.map((o) => (
                  <SelectItem key={o.days} value={String(o.days)}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <Button onClick={generate} className="w-full">
          <FileDown className="mr-2 h-4 w-4" />
          Open printable report
        </Button>
        <p className="text-[11px] text-[var(--sched-graphite)]">
          Opens in a new tab. Use your browser's Print → Save as PDF.
        </p>
      </div>
    </section>
  );
}
