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
import { Layers, Plus } from "lucide-react";
import { toast } from "sonner";
import { FRAGNETS, insertFragnet } from "@/lib/scheduler/fragnets";
import type { Dependency, Task } from "@/lib/scheduler/types";

interface Props {
  tasks: Task[];
  dependencies: Dependency[];
  onInsert: (next: { tasks: Task[]; dependencies: Dependency[] }) => void;
}

export function FragnetPanel({ tasks, dependencies, onInsert }: Props) {
  const [fragnetId, setFragnetId] = useState(FRAGNETS[0].id);
  const [prefix, setPrefix] = useState("C1");
  const [attachTo, setAttachTo] = useState<string>("__none__");

  const def = FRAGNETS.find((f) => f.id === fragnetId)!;

  const insert = () => {
    try {
      const result = insertFragnet(
        { tasks, dependencies },
        fragnetId,
        { prefix, attachToTaskId: attachTo === "__none__" ? undefined : attachTo },
      );
      onInsert({ tasks: result.tasks, dependencies: result.dependencies });
      toast.success(
        `Inserted "${def.name}" (${result.addedIds.length} activities)`,
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section className="rounded border border-[#d8cdb8] bg-white p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[#675d4b]">
        <Layers className="h-4 w-4" /> Fragnets
      </h2>
      <p className="mb-3 text-[11px] text-[#776e5e]">
        Drop in a reusable chunk of activities with logic pre-wired.
      </p>
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Template</Label>
          <Select value={fragnetId} onValueChange={setFragnetId}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FRAGNETS.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-[11px] text-[#776e5e]">
            {def.description} · {def.items.length} activities
          </p>
        </div>

        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <div>
            <Label className="text-xs">ID prefix</Label>
            <Input
              value={prefix}
              maxLength={12}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="C1"
            />
          </div>
          <div>
            <Label className="text-xs">Attach after</Label>
            <Select value={attachTo} onValueChange={setAttachTo}>
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

        <Button onClick={insert} className="w-full" disabled={!prefix.trim()}>
          <Plus className="mr-2 h-4 w-4" /> Insert fragnet
        </Button>
      </div>
    </section>
  );
}
