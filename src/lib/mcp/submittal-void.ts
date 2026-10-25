// Void keeps the row. Draft, submitted, and approved all take the same mark.
// The member confirms first. Who, when, and the reason stay on the project record.

export const VOID_STATUS = "void";
export const VOID_LABEL = "Void";

export type VoidTarget = {
  id: string;
  number: string;
  revision: number;
  title: string;
  status: string;
};

export type VoidAsk = {
  reason?: string | null;
  confirmed?: boolean | null;
  confirm_key?: string | null;
};

export type VoidDecision =
  | { write: false; already: boolean; needReason: boolean; key: string | null; prompt: string }
  | { write: true; payload: { submittal_id: string; reason: string; confirmed: true } };

export function voidConfirmKey(id: string, reason: string): string {
  const body = `${id}|void|${reason.trim()}`;
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) >>> 0;
  return `V${h.toString(16).toUpperCase().padStart(8, "0").slice(0, 8)}`;
}

export function cleanVoidReason(reason: string | null | undefined): string | null {
  const text = (reason ?? "").trim();
  if (text.length < 3 || text.length > 500) return null;
  return text;
}

/** Latest revision for a number, or the exact id. Same row the database void action updates. */
export function pickSubmittal<T extends VoidTarget>(
  rows: T[],
  query: { submittal_id?: string | null; number?: string | null },
): T | null {
  if (query.submittal_id) return rows.find((row) => row.id === query.submittal_id) ?? null;
  const number = query.number?.trim().toLowerCase();
  if (!number) return null;
  const matches = rows.filter((row) => row.number.trim().toLowerCase() === number);
  matches.sort((a, b) => b.revision - a.revision || b.id.localeCompare(a.id));
  return matches[0] ?? null;
}

export function voidPrompt(row: VoidTarget): string {
  return `Void ${row.number} revision ${row.revision}, ${row.title}? It stays on the record as ${VOID_LABEL}. Yes or no?`;
}

/** Nothing is written until the reason is present and the confirm key matches a yes. */
export function voidDecision(row: VoidTarget, ask: VoidAsk): VoidDecision {
  if (row.status === VOID_STATUS) {
    return {
      write: false,
      already: true,
      needReason: false,
      key: null,
      prompt: `That submittal is already ${VOID_LABEL}. Nothing was changed.`,
    };
  }
  const reason = cleanVoidReason(ask.reason);
  if (!reason) {
    return {
      write: false,
      already: false,
      needReason: true,
      key: null,
      prompt: "A reason is required. Nothing was changed.",
    };
  }
  const key = voidConfirmKey(row.id, reason);
  if (ask.confirmed !== true || ask.confirm_key !== key) {
    return { write: false, already: false, needReason: false, key, prompt: voidPrompt(row) };
  }
  return { write: true, payload: { submittal_id: row.id, reason, confirmed: true } };
}
