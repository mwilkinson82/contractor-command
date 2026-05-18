// Vault — persistent operating memory for Contractor Circle.
// Backed by Lovable Cloud (Supabase). Reads/writes scoped to the
// signed-in member via RLS. Local in-memory cache keeps the existing
// synchronous read API used across the UI.

import { supabase } from "@/integrations/supabase/client";

export type PacketStatus = "Open" | "Brought to Session" | "Carried into AOS" | "Archived";

export type CommandPacket = {
  id: string;
  createdAt: string;
  kind: "command";
  source: string;
  title: string;
  primaryFinding: string;
  primaryConstraint: string;
  financialConsequence: string;
  missingSystem: string;
  recommendedAction: string;
  relatedAos?: string;
  bringOneIssuePrompt: string;
  intensiveRecommended: boolean;
  inputs: Record<string, number | string>;
  status: PacketStatus;
};

export type IssuePacket = {
  id: string;
  createdAt: string;
  kind: "issue";
  source: "Bring One Issue";
  title: string;
  needsPressure: string;
  alreadyTried: string;
  decisionAvoided: string;
  financialConsequence: string;
  winLooksLike: string;
  status: PacketStatus;
};

export type Packet = CommandPacket | IssuePacket;

let cache: Packet[] = [];
let hydrated = false;
let hydratingFor: string | null = null;

function emit() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vault:changed"));
  }
}

type Row = {
  id: string;
  created_at: string;
  kind: "command" | "issue";
  source: string;
  title: string;
  status: PacketStatus;
  payload: Record<string, unknown>;
};

function rowToPacket(r: Row): Packet {
  const base = {
    id: r.id,
    createdAt: r.created_at,
    source: r.source,
    title: r.title,
    status: r.status,
  };
  if (r.kind === "command") {
    return { ...base, kind: "command", ...(r.payload as object) } as CommandPacket;
  }
  return { ...base, kind: "issue", source: "Bring One Issue", ...(r.payload as object) } as IssuePacket;
}

function packetToPayload(p: Packet): Record<string, unknown> {
  // Strip fields stored as columns; keep everything else in payload jsonb.
  const { id: _id, createdAt: _c, kind: _k, source: _s, title: _t, status: _st, ...rest } = p as Record<string, unknown> & Packet;
  void _id; void _c; void _k; void _s; void _t; void _st;
  return rest;
}

async function hydrate(userId: string) {
  if (hydrated && hydratingFor === userId) return;
  hydratingFor = userId;
  const { data, error } = await supabase
    .from("vault_packets")
    .select("id, created_at, kind, source, title, status, payload")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[vault] hydrate failed", error);
    return;
  }
  cache = (data as Row[]).map(rowToPacket);
  hydrated = true;
  emit();
}

export const vault = {
  list(): Packet[] {
    return [...cache].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  get(id: string): Packet | undefined {
    return cache.find((p) => p.id === id);
  },
  async hydrateFor(userId: string) {
    if (hydratingFor !== userId) {
      cache = [];
      hydrated = false;
    }
    await hydrate(userId);
  },
  reset() {
    cache = [];
    hydrated = false;
    hydratingFor = null;
    emit();
  },
  save(
    packet:
      | Omit<CommandPacket, "id" | "createdAt" | "status">
      | Omit<IssuePacket, "id" | "createdAt" | "status">,
  ): Packet {
    const tempId = `pkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const full = {
      ...packet,
      id: tempId,
      createdAt: new Date().toISOString(),
      status: "Open" as PacketStatus,
    } as Packet;
    cache = [full, ...cache];
    emit();

    // Async write-through. Replace temp id with server id on success.
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) return;
      const { data, error } = await supabase
        .from("vault_packets")
        .insert({
          user_id: uid,
          kind: full.kind,
          source: full.source,
          title: full.title,
          status: full.status,
          payload: packetToPayload(full) as never,
        })
        .select("id, created_at")
        .single();
      if (error) {
        console.error("[vault] save failed", error);
        return;
      }
      cache = cache.map((p) =>
        p.id === tempId ? ({ ...p, id: data.id, createdAt: data.created_at } as Packet) : p,
      );
      emit();
    })();

    return full;
  },
  updateStatus(id: string, status: PacketStatus) {
    cache = cache.map((p) => (p.id === id ? ({ ...p, status } as Packet) : p));
    emit();
    void supabase.from("vault_packets").update({ status }).eq("id", id);
  },
  remove(id: string) {
    cache = cache.filter((p) => p.id !== id);
    emit();
    void supabase.from("vault_packets").delete().eq("id", id);
  },
};

export function packetToClipboard(p: Packet): string {
  if (p.kind === "command") {
    return [
      `${p.source} — ${p.title}`,
      `Date: ${new Date(p.createdAt).toLocaleDateString()}`,
      "",
      `WHAT WE FOUND`,
      p.primaryFinding,
      "",
      `PRIMARY CONSTRAINT`,
      p.primaryConstraint,
      "",
      `FINANCIAL CONSEQUENCE`,
      p.financialConsequence,
      "",
      `MISSING SYSTEM / PROCESS`,
      p.missingSystem,
      "",
      `RECOMMENDED NEXT ACTION`,
      p.recommendedAction,
      "",
      `BRING ONE ISSUE`,
      p.bringOneIssuePrompt,
    ].join("\n");
  }
  return [
    `Bring One Issue — ${p.title}`,
    `Date: ${new Date(p.createdAt).toLocaleDateString()}`,
    "",
    `1. What needs pressure?`,
    p.needsPressure,
    "",
    `2. What have you already tried?`,
    p.alreadyTried,
    "",
    `3. What decision are you avoiding?`,
    p.decisionAvoided,
    "",
    `4. What is the financial consequence?`,
    p.financialConsequence,
    "",
    `5. What would make this a win?`,
    p.winLooksLike,
  ].join("\n");
}

export const AOS_URL = "https://alpos.alpcontractorcircle.com";
