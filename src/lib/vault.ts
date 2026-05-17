// Vault — persistent operating memory for Contractor Circle.
// localStorage today; schema shaped for Supabase migration tomorrow.

export type PacketStatus = "Open" | "Brought to Session" | "Carried into AOS" | "Archived";

export type CommandPacket = {
  id: string;
  createdAt: string; // ISO
  kind: "command";
  source: string; // e.g. "Growth Constraint Map"
  title: string;
  primaryFinding: string;
  primaryConstraint: string;
  financialConsequence: string;
  missingSystem: string;
  recommendedAction: string;
  relatedAos: string;
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

const KEY = "alp.cc.vault.v1";

function read(): Packet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Packet[]) : [];
  } catch {
    return [];
  }
}

function write(packets: Packet[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(packets));
  window.dispatchEvent(new CustomEvent("vault:changed"));
}

export const vault = {
  list(): Packet[] {
    return read().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  get(id: string): Packet | undefined {
    return read().find((p) => p.id === id);
  },
  save(packet: Omit<CommandPacket, "id" | "createdAt" | "status"> | Omit<IssuePacket, "id" | "createdAt" | "status">): Packet {
    const full = {
      ...packet,
      id: `pkt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date().toISOString(),
      status: "Open" as PacketStatus,
    } as Packet;
    write([full, ...read()]);
    return full;
  },
  updateStatus(id: string, status: PacketStatus) {
    write(read().map((p) => (p.id === id ? ({ ...p, status } as Packet) : p)));
  },
  remove(id: string) {
    write(read().filter((p) => p.id !== id));
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
      `RELATED AOS AREA`,
      p.relatedAos,
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
