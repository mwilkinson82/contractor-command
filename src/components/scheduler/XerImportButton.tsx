import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { importXer } from "@/lib/scheduler/xer";

interface Props {
  disabled?: boolean;
  onImport: (input: {
    name: string;
    projectStartDate?: string;
    tasks: ReturnType<typeof importXer>["tasks"];
    dependencies: ReturnType<typeof importXer>["dependencies"];
  }) => void;
}

export function XerImportButton({ disabled, onImport }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const text = await file.text();
      const result = importXer(text);
      if (result.tasks.length === 0) {
        toast.error("No activities found in XER file");
        return;
      }
      for (const w of result.warnings) toast.warning(w);
      toast.success(
        `Parsed ${result.stats.tasksParsed} tasks, ${result.stats.depsParsed} dependencies`,
      );
      onImport({
        name: result.projectName,
        projectStartDate: result.projectStartDate,
        tasks: result.tasks,
        dependencies: result.dependencies,
      });
    } catch (e) {
      toast.error(`Failed to parse XER: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xer,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <Button
        variant="outline"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Importing…" : "Import from Primavera (.xer)"}
      </Button>
    </>
  );
}
