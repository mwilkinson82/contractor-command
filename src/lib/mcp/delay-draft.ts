import type { EmailDraft } from "./email-safety";
import { emailContact, type JobContact } from "./contacts";

/** Fill only a generic notice greeting from saved recipient evidence. Never replace a named addressee. */
export function delayDraft(draft: EmailDraft, contacts: JobContact[], memberRecipient?: string) {
  const delay = /\bdelay\b/i.test(draft.subject) || /\bnotice of (?:a )?delay\b/i.test(draft.body);
  if (!delay) return { draft, contact: null };
  const candidates = draft.to
    ? contacts.filter((c) => c.email?.toLowerCase() === draft.to!.toLowerCase())
    : contacts.filter((c) => /^(pm|project manager)$/i.test(c.role ?? ""));
  const supplied = memberRecipient?.trim();
  const contact =
    candidates.length === 1
      ? candidates[0]
      : candidates.length === 0 &&
          supplied &&
          !/\b(recipient|placeholder|project manager|first ?name|contact name)\b/i.test(supplied)
        ? {
            name: supplied,
            email: draft.to,
            role: null,
            company: null,
            source: "member-provided draft recipient",
          }
        : null;
  const generic =
    /^(?:Dear|Hi|Hello)\s+(?:\[?(?:Project Manager|Contractor|Recipient|Contact(?: Name)?|Name|First ?Name|Sir\/?Madam)\]?)[,:]?/im;
  return {
    draft: contact
      ? {
          ...draft,
          to: draft.to ?? contact.email,
          body: draft.body.replace(generic, `Hi ${contact.name.split(/\s+/)[0]},`),
        }
      : draft,
    contact: emailContact(contact).structured,
  };
}
