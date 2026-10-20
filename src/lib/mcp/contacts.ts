// 0.8.5: job contacts for email cards, contract delivery terms for notice items, and notice-item dedupe.
// Display only: nothing here writes or deletes data, so every function is safe to run on every read (idempotent).
import type { Sb } from "./guard";

export type JobContact = { name: string; role: string | null; company: string | null; email: string | null; source: string };

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const ROLE_WORDS = /^(PM|project manager|superintendent|super|owner'?s? rep|architect|engineer|estimator|APM|assistant project manager|foreman|contact)$/i;

/** "Calloway Builders (Jordan Reyes, PM)", "Calloway Builders (Jordan Reyes, PM, jordan@x.com)", "(Dana Whitfield, dana@x.com)". */
export function parseContacts(text: string | null | undefined, source = "job record"): JobContact[] {
  const out: JobContact[] = [];
  const t = (text ?? "").trim();
  if (!t) return out;
  const re = /(?:([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,5})\s*)?\(([^()]{3,160})\)/g;
  for (const m of t.matchAll(re)) {
    const parts = m[2].split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;
    const name = parts[0];
    if (!/^[A-Z][a-z'.-]+(?:\s+[A-Z][a-z'.-]+){1,3}$/.test(name)) continue;
    const email = parts.find((p) => EMAIL.test(p))?.match(EMAIL)?.[0] ?? null;
    const role = parts.slice(1).find((p) => !EMAIL.test(p) && ROLE_WORDS.test(p)) ?? null;
    out.push({ name, role: role ? (/^project manager$/i.test(role) ? "PM" : role) : null, company: m[1]?.trim() || null, email, source });
  }
  return out;
}

/** Merge contacts by name; keep the first non-empty role, company and email. */
export function mergeContacts(list: JobContact[]): JobContact[] {
  const by = new Map<string, JobContact>();
  for (const c of list) {
    const k = c.name.toLowerCase();
    const p = by.get(k);
    by.set(k, p ? { ...p, role: p.role ?? c.role, company: p.company ?? c.company, email: p.email ?? c.email } : c);
  }
  return [...by.values()];
}

/** Every contact the job has saved: deadline and item recipients, item text, and text facts. Our own company's people are left out. */
export async function jobContacts(sb: Sb, jobId: string, ownCompany?: string | null): Promise<JobContact[]> {
  const [dl, it, fa] = await Promise.all([
    sb.from("mcp_job_deadlines").select("recipient").eq("job_id", jobId),
    sb.from("mcp_open_items").select("action, recipient").eq("job_id", jobId).limit(500),
    sb.from("mcp_job_facts").select("key, value").eq("job_id", jobId).limit(500),
  ]);
  const all: JobContact[] = [];
  for (const r of (dl.data ?? []) as { recipient: string | null }[]) all.push(...parseContacts(r.recipient, "contract deadline"));
  for (const r of (it.data ?? []) as { action: string | null; recipient: string | null }[]) {
    all.push(...parseContacts(r.recipient, "open item"), ...parseContacts(r.action, "open item"));
  }
  for (const r of (fa.data ?? []) as { key: string; value: unknown }[]) if (typeof r.value === "string") all.push(...parseContacts(r.value, `job answer (${r.key.replace(/_/g, " ")})`));
  const own = (ownCompany ?? "").trim().toLowerCase();
  return mergeContacts(all).filter((c) => !own || (c.company ?? "").toLowerCase() !== own);
}

/** The contract's delivery terms: "delivered by email to Contractor's Project Manager with a copy by certified mail". */
export function clauseDelivery(verbatim: string | null | undefined): { method: string | null; to_role: string | null } {
  const t = (verbatim ?? "").replace(/\*\*/g, "");
  const m = t.match(/delivered\s+by\s+([\w\s-]+?)\s+to\s+([A-Z][\w'’\s]+?)(?=\s+(?:with|and|within|stating)\b|[.,;]|$)(\s+with a copy by [\w\s-]+?(?=[.,;]|$))?/i);
  if (!m) return { method: null, to_role: null };
  return { method: `${m[1].trim()}${m[3] ? ` (${m[3].trim().replace(/^with /i, "")})` : ""}`, to_role: m[2].trim() };
}

/** The saved contact matching a clause's recipient role ("Contractor's Project Manager" -> the other party's PM). */
export function contactForRole(contacts: JobContact[], role: string | null | undefined): JobContact | null {
  const r = (role ?? "").toLowerCase();
  const wantPm = /project manager|\bpm\b/.test(r);
  return (wantPm ? contacts.find((c) => (c.role ?? "").toUpperCase() === "PM") : null) ?? (contacts.length === 1 ? contacts[0] : null) ?? null;
}

export const contactText = (c: JobContact) => `${c.company ? `${c.company} (` : ""}${c.name}${c.role ? `, ${c.role}` : ""}${c.company ? ")" : ""}${c.email ? ` <${c.email}>` : ""}`;

type NoticeRow = { clause_source: string | null; delivery_method: string | null; recipient: string | null; item_type?: string | null };
type ClauseLite = { section: string; verbatim_text?: string | null };

/** Method and Recipient for a notice item: saved values first, else the clause's delivery terms and the matching job contact. */
export function fillNotice<T extends NoticeRow>(it: T, clauses: ClauseLite[], contacts: JobContact[]): T {
  if (it.delivery_method && it.recipient) return it;
  const sec = (it.clause_source ?? "").match(/§\s*([\d.]+[a-z]?)/i)?.[1];
  const cl = sec ? clauses.find((c) => c.section === sec) : undefined;
  if (!cl) return it;
  const d = clauseDelivery(cl.verbatim_text);
  const who = contactForRole(contacts, d.to_role);
  const method = it.delivery_method ?? (d.method ? `${d.method}, per §${sec}` : null);
  const recipient = it.recipient ?? (who ? `${contactText(who)}${d.to_role ? ` — ${d.to_role}, per §${sec}` : ""}` : d.to_role ? `${d.to_role} (per §${sec}; no saved contact — who should it go to?)` : null);
  return { ...it, delivery_method: method ?? it.delivery_method, recipient: recipient ?? it.recipient };
}

/** Same event + same notice type = one item. "Weather delay occurred today" and "Weather delay" share a key. */
export function noticeKey(it: { action: string; clause_source: string | null; item_type?: string | null }): string | null {
  const a = it.action ?? "";
  const m = a.match(/^(.*?\bnotice\b[^:]*?)\s+for:\s*(.+)$/i);
  if (!m) return null;
  const kind = (it.clause_source ?? m[1]).toLowerCase().replace(/\s+/g, " ").trim();
  const event = m[2].toLowerCase()
    .replace(/\b(occurred|happened|started|began)\b/g, " ")
    .replace(/\b(today|yesterday|this (morning|afternoon|week)|on \d{4}-\d{2}-\d{2})\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
  return event ? `${kind}|${event}` : null;
}

/** Group duplicate notice items. Keeps the oldest-ref (sorted) item; returns the rest as duplicates. Pure and idempotent. */
export function dedupeNotices<T extends { id: string; action: string; clause_source: string | null; item_type?: string | null; needed_by?: string | null }>(items: T[]) {
  const keep: T[] = [];
  const dups = new Map<string, T[]>();
  const first = new Map<string, T>();
  const order = [...items].sort((x, y) => x.action.length - y.action.length || x.id.localeCompare(y.id));
  const kept = new Set<string>();
  for (const it of order) {
    const k = noticeKey(it);
    const key = k ? `${k}|${it.needed_by ?? ""}` : null;
    if (key && first.has(key)) { const f = first.get(key)!; dups.set(f.id, [...(dups.get(f.id) ?? []), it]); continue; }
    if (key) first.set(key, it);
    kept.add(it.id);
  }
  for (const it of items) if (kept.has(it.id)) keep.push(it);
  return { items: keep, duplicates: dups };
}

/**
 * Email card recipient for any result that leads to an email: the known contact, or an honest ask. Never "Dear Project Manager".
 * 0.8.8: the first line is always "To: <email>" or "To: (ask: ...)", and structuredContent carries to_field so every
 * host (Claude included) shows a To field on the draft and asks for a missing address in the same reply.
 */
export function emailContact(c: JobContact | null) {
  if (c) {
    const first = c.name.split(/\s+/)[0];
    const ask = c.email ? null : `What's ${c.name}'s email?`;
    const toLine = c.email ? `To: ${c.email}` : `To: (ask: what's ${c.name}'s email?)`;
    return {
      structured: { known: true, name: c.name, role: c.role, company: c.company, email: c.email, greeting: `Hi ${first},`, to: c.email ?? null, ask,
        to_line: toLine, to_field: { show: true, label: "To", value: c.email ?? "", blank: !c.email }, ask_in_same_reply: !c.email },
      text: `${toLine}\nSend to: ${contactText(c)}${c.email ? "" : ` (no email on file — what's ${c.name}'s email?)`}. Greeting: "Hi ${first},"`,
    };
  }
  const ask = "Who should this go to? (name and email)";
  return {
    structured: { known: false, name: null, role: null, company: null, email: null, greeting: null, to: null, ask,
      to_line: "To: (ask: who should this go to? name and email)", to_field: { show: true, label: "To", value: "", blank: true }, ask_in_same_reply: true },
    text: `To: (ask: who should this go to? name and email)\nNo contact saved for this job. ${ask}`,
  };
}

export const EMAIL_CONTACT_RULE =
  "- Email cards: fill To and the greeting from structuredContent.email_contact (name, role, email). If email_contact.known is false or email is empty, leave To blank and ask who to send to in the same reply. Never write \"Dear Project Manager\", \"Dear Sir/Madam\" or any role in place of a name. REQUIRED in every host, Claude included: every email draft or card shows a To field (email_contact.to_field), filled or blank. Never show a draft without a To field and never offer a send button with no recipient. If the address is missing, show To blank and ask for it in that same reply.";
