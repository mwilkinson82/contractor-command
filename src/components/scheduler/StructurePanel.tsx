import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, ChevronRight, ChevronDown } from "lucide-react";
import {
  loadStructure,
  upsertWbsNode,
  deleteWbsNode,
  upsertCodeType,
  deleteCodeType,
  upsertCodeValue,
  deleteCodeValue,
  type WbsNode,
} from "@/lib/scheduler/structure.functions";

type Props = { scheduleId: string };

const SWATCHES = ["#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#4f46e5", "#9333ea", "#db2777"];

export function StructurePanel({ scheduleId }: Props) {
  const qc = useQueryClient();
  const loadFn = useServerFn(loadStructure);
  const upsertWbsFn = useServerFn(upsertWbsNode);
  const deleteWbsFn = useServerFn(deleteWbsNode);
  const upsertTypeFn = useServerFn(upsertCodeType);
  const deleteTypeFn = useServerFn(deleteCodeType);
  const upsertValueFn = useServerFn(upsertCodeValue);
  const deleteValueFn = useServerFn(deleteCodeValue);

  const { data, isLoading } = useQuery({
    queryKey: ["structure", scheduleId],
    queryFn: () => loadFn({ data: { scheduleId } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["structure", scheduleId] });

  const wbsAddMut = useMutation({
    mutationFn: (v: { code: string; name: string; parentId: string | null }) =>
      upsertWbsFn({ data: { scheduleId, ...v } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const wbsDelMut = useMutation({
    mutationFn: (id: string) => deleteWbsFn({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const typeAddMut = useMutation({
    mutationFn: (name: string) => upsertTypeFn({ data: { scheduleId, name } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const typeDelMut = useMutation({
    mutationFn: (id: string) => deleteTypeFn({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const valAddMut = useMutation({
    mutationFn: (v: { typeId: string; code: string; color: string }) =>
      upsertValueFn({ data: v }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const valDelMut = useMutation({
    mutationFn: (id: string) => deleteValueFn({ data: { id } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  const [tab, setTab] = useState<"wbs" | "codes">("wbs");

  return (
    <section className="rounded border border-[#d8cdb8] bg-white">
      <header className="flex items-center justify-between border-b border-[#e4dcc8] px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f241f]">
          Structure
        </h2>
        <div className="flex gap-1 text-[10px]">
          <button
            onClick={() => setTab("wbs")}
            className={`rounded px-2 py-0.5 font-semibold uppercase tracking-wider ${
              tab === "wbs" ? "bg-[#1f241f] text-[#f7f4ed]" : "text-[#746b5c] hover:bg-[#f0e8d6]"
            }`}
          >
            WBS
          </button>
          <button
            onClick={() => setTab("codes")}
            className={`rounded px-2 py-0.5 font-semibold uppercase tracking-wider ${
              tab === "codes" ? "bg-[#1f241f] text-[#f7f4ed]" : "text-[#746b5c] hover:bg-[#f0e8d6]"
            }`}
          >
            Codes
          </button>
        </div>
      </header>

      <div className="p-3">
        {isLoading ? (
          <p className="text-xs text-[#746b5c]">Loading…</p>
        ) : tab === "wbs" ? (
          <WbsTree
            nodes={data?.wbs ?? []}
            onAdd={(v) => wbsAddMut.mutate(v)}
            onDelete={(id) => wbsDelMut.mutate(id)}
          />
        ) : (
          <CodesEditor
            types={data?.codeTypes ?? []}
            onAddType={(name) => typeAddMut.mutate(name)}
            onDeleteType={(id) => typeDelMut.mutate(id)}
            onAddValue={(v) => valAddMut.mutate(v)}
            onDeleteValue={(id) => valDelMut.mutate(id)}
          />
        )}
      </div>
    </section>
  );
}

/* ----------------- WBS tree ----------------- */
function WbsTree({
  nodes,
  onAdd,
  onDelete,
}: {
  nodes: WbsNode[];
  onAdd: (v: { code: string; name: string; parentId: string | null }) => void;
  onDelete: (id: string) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const byParent = useMemo(() => {
    const map = new Map<string | null, WbsNode[]>();
    for (const n of nodes) {
      const list = map.get(n.parentId) ?? [];
      list.push(n);
      map.set(n.parentId, list);
    }
    return map;
  }, [nodes]);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const render = (parent: string | null, depth: number): ReactNode => {
    const list = byParent.get(parent) ?? [];
    return list.map((n) => {
      const kids = byParent.get(n.id) ?? [];
      const isOpen = !collapsed.has(n.id);
      return (
        <div key={n.id}>
          <div
            className="flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-[#f0e8d6]"
            style={{ paddingLeft: depth * 12 + 4 }}
          >
            {kids.length > 0 ? (
              <button onClick={() => toggle(n.id)} className="text-[#7a6a4d]">
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
            ) : (
              <span className="inline-block w-3" />
            )}
            <span className="font-mono text-[#7a6a4d]">{n.code}</span>
            <span className="flex-1 truncate">{n.name}</span>
            <button
              onClick={() => setParentId(n.id)}
              title="Add child"
              className="text-[#7a6a4d] hover:text-[#1f241f]"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete WBS "${n.code}"? Children will be removed.`)) onDelete(n.id);
              }}
              className="text-[#a05a4a] hover:text-[#7a3528]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
          {isOpen && kids.length > 0 ? render(n.id, depth + 1) : null}
        </div>
      );
    });
  };

  const submit = () => {
    if (!code.trim() || !name.trim()) return;
    onAdd({ code: code.trim(), name: name.trim(), parentId });
    setCode("");
    setName("");
  };

  const parentLabel =
    parentId === null ? "Root" : nodes.find((n) => n.id === parentId)?.code ?? "Root";

  return (
    <div className="space-y-3">
      <div className="max-h-64 overflow-y-auto rounded border border-[#e4dcc8] bg-[#fafaf3] p-1">
        {nodes.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-[#746b5c]">
            No WBS yet. Build your breakdown structure below.
          </p>
        ) : (
          render(null, 0)
        )}
      </div>
      <div className="space-y-1.5 rounded border border-dashed border-[#d8cdb8] p-2">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[#7a6a4d]">
          <span>Add under: {parentLabel}</span>
          {parentId !== null ? (
            <button onClick={() => setParentId(null)} className="underline">
              clear
            </button>
          ) : null}
        </div>
        <div className="flex gap-1">
          <Input
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="h-7 w-20 text-xs"
          />
          <Input
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 flex-1 text-xs"
          />
          <Button size="sm" onClick={submit} className="h-7 px-2">
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ----------------- Codes editor ----------------- */
function CodesEditor({
  types,
  onAddType,
  onDeleteType,
  onAddValue,
  onDeleteValue,
}: {
  types: import("@/lib/scheduler/structure.functions").ActivityCodeType[];
  onAddType: (name: string) => void;
  onDeleteType: (id: string) => void;
  onAddValue: (v: { typeId: string; code: string; color: string }) => void;
  onDeleteValue: (id: string) => void;
}) {
  const [newType, setNewType] = useState("");
  const [openType, setOpenType] = useState<string | null>(null);
  const [valCode, setValCode] = useState("");
  const [valColor, setValColor] = useState(SWATCHES[0]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <Input
          placeholder="New code type (e.g. Trade)"
          value={newType}
          onChange={(e) => setNewType(e.target.value)}
          className="h-7 flex-1 text-xs"
        />
        <Button
          size="sm"
          onClick={() => {
            if (!newType.trim()) return;
            onAddType(newType.trim());
            setNewType("");
          }}
          className="h-7 px-2"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {types.length === 0 ? (
        <p className="text-xs text-[#746b5c]">
          No activity codes yet. Add types like Phase, Area, Trade, Responsibility.
        </p>
      ) : (
        <div className="space-y-2">
          {types.map((t) => {
            const isOpen = openType === t.id;
            return (
              <div key={t.id} className="rounded border border-[#e4dcc8]">
                <div className="flex items-center justify-between bg-[#fafaf3] px-2 py-1">
                  <button
                    onClick={() => setOpenType(isOpen ? null : t.id)}
                    className="flex flex-1 items-center gap-1 text-left text-xs font-semibold uppercase tracking-wider text-[#1f241f]"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    {t.name}
                    <span className="ml-1 text-[10px] font-normal text-[#746b5c]">
                      ({t.values.length})
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete code type "${t.name}" and its values?`))
                        onDeleteType(t.id);
                    }}
                    className="text-[#a05a4a] hover:text-[#7a3528]"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {isOpen ? (
                  <div className="space-y-1.5 p-2">
                    {t.values.map((v) => (
                      <div key={v.id} className="flex items-center gap-1 text-xs">
                        <span
                          className="inline-block h-3 w-3 rounded-sm border border-black/10"
                          style={{ background: v.color ?? "#999" }}
                        />
                        <span className="font-mono">{v.code}</span>
                        {v.description ? (
                          <span className="text-[#746b5c]"> — {v.description}</span>
                        ) : null}
                        <button
                          onClick={() => onDeleteValue(v.id)}
                          className="ml-auto text-[#a05a4a] hover:text-[#7a3528]"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-1 pt-1">
                      <Input
                        placeholder="Code"
                        value={openType === t.id ? valCode : ""}
                        onChange={(e) => setValCode(e.target.value)}
                        className="h-7 flex-1 text-xs"
                      />
                      <div className="flex gap-0.5">
                        {SWATCHES.map((c) => (
                          <button
                            key={c}
                            onClick={() => setValColor(c)}
                            className={`h-5 w-3 rounded-sm border ${
                              valColor === c ? "ring-2 ring-[#1f241f]" : "border-black/10"
                            }`}
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (!valCode.trim()) return;
                          onAddValue({ typeId: t.id, code: valCode.trim(), color: valColor });
                          setValCode("");
                        }}
                        className="h-7 px-2"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
