// Command Tool drawer registry — full-screen Sheet shell that hosts the
// active tool. Keeps tools decoupled from where they're triggered
// (signal tiles, top-of-page picker, Today's Move, etc.).

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { EstimateThroughputTool } from "@/components/portal/tools/estimate-throughput-tool";

/** Add a tool here to make it openable as a drawer. Key is CommandTool.id. */
const TOOL_REGISTRY: Record<string, (props: { onClose: () => void }) => ReactNode> = {
  "estimate-throughput": (p) => <EstimateThroughputTool onClose={p.onClose} />,
};

export function hasToolDrawer(toolId: string): boolean {
  return toolId in TOOL_REGISTRY;
}

type Ctx = {
  open: (toolId: string) => void;
  close: () => void;
};

const ToolDrawerCtx = createContext<Ctx | null>(null);

export function useToolDrawer(): Ctx {
  const ctx = useContext(ToolDrawerCtx);
  if (!ctx) throw new Error("useToolDrawer must be used inside <ToolDrawerProvider>");
  return ctx;
}

export function ToolDrawerProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const value = useMemo<Ctx>(
    () => ({
      open: (id) => setOpenId(id),
      close: () => setOpenId(null),
    }),
    [],
  );

  const handleClose = useCallback(() => setOpenId(null), []);
  const render = openId ? TOOL_REGISTRY[openId] : null;

  return (
    <ToolDrawerCtx.Provider value={value}>
      {children}
      <Sheet open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent
          side="right"
          className="w-full max-w-none sm:max-w-none border-l p-0 overflow-y-auto bg-background"
        >
          <VisuallyHidden>
            <SheetTitle>Command Tool</SheetTitle>
            <SheetDescription>Run a command tool and save findings to your vault.</SheetDescription>
          </VisuallyHidden>
          {render ? render({ onClose: handleClose }) : null}
        </SheetContent>
      </Sheet>
    </ToolDrawerCtx.Provider>
  );
}
