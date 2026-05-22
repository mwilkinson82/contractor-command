import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Flag, Plus, Trash2 } from "lucide-react";
import type { Annotation, AnnotationKind, Task } from "@/lib/scheduler/types";

interface Props {
  annotations: Annotation[];
  tasks: Task[];
  onChange: (next: Annotation[]) => void;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function AnnotationsPanel({ annotations, tasks, onChange }: Props) {
  const [label, setLabel] = useState("");
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<AnnotationKind>("milestone");
  const [taskId, setTaskId] = useState<string>("__none__");

  const add = () => {
    if (!label.trim() || !date) return;
    onChange([
      ...annotations,
      {
        id: newId(),
        kind,
        date,
        label: label.trim(),
        taskId: taskId === "__none__" ? undefined : taskId,
      },
    ]);
    setLabel("");
    setDate("");
    setTaskId("__none__");
  };

  const remove = (id: string) => {
    onChange(annotations.filter((a) => a.id !== id));
  };

  return (
    <section className="rounded border border-[#d8cdb8] bg-white p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
        <Flag className="h-4 w-4" /> Annotations
      </h2>
      <p className="mb-3 text-[11px] text-[#776e5e]">
        Pin milestones (owner approval, permit) and callouts to dates. They appear on the Gantt and
        on the printable PDF.
      </p>

      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_110px] gap-2">
          <div>
            <Label className="text-xs">Label</Label>
            <Input
              value={label}
              maxLength={120}
              placeholder="Owner approval"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as AnnotationKind)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="milestone">Milestone</SelectItem>
                <SelectItem value="callout">Callout</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-[140px_1fr] gap-2">
          <div>
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Linked task</Label>
            <Select value={taskId} onValueChange={setTaskId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="(none)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">(none)</SelectItem>
                {tasks.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.id} · {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={add} disabled={!label.trim() || !date} className="w-full" size="sm">
          <Plus className="mr-1 h-4 w-4" /> Add annotation
        </Button>
      </div>

      {annotations.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-[#eee7d8] pt-3">
          {annotations
            .slice()
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-[#f7f4ed]"
              >
                <div className="min-w-0 flex-1">
                  <span
                    className="mr-1 inline-block rounded px-1 text-[9px] font-semibold uppercase"
                    style={{
                      background: a.kind === "milestone" ? "#7a5cc4" : "#c47a1f",
                      color: "white",
                    }}
                  >
                    {a.kind === "milestone" ? "MS" : "CL"}
                  </span>
                  <span className="font-medium text-[#1f241f]">{a.label}</span>
                  <span className="ml-1 text-[#776e5e]">· {a.date}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => remove(a.id)}
                  aria-label="Remove"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
        </ul>
      ) : null}
    </section>
  );
}
