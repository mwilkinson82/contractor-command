// Who a draft is from. Drafts are signed as the job's PM and suggest the PM's email as From.
// The host (ChatGPT, Claude, Grok Bot) picks the account that actually sends; Athena can only suggest it.

export type PmIdentity = { name: string | null; email: string | null; title: string | null; isMember: boolean };
export type Company = { name: string | null };

export const HOST_PICKS_SENDER =
  "The host's email card picks the account that actually sends. Before sending, tell the member which account it will send from; if it isn't the PM's, have the PM send it or sign it as the sender.";

export function draftIdentity(pm: PmIdentity, company: Company) {
  const name = pm.name?.trim() || null;
  const title = pm.title?.trim() || (name ? "Project Manager" : null);
  const signature = name ? [name, title, company.name].filter(Boolean).join("\n") : null;
  return {
    suggested_from: pm.email?.trim() || null,
    signature,
    missing: [!name && "PM name", !pm.email && "PM email"].filter(Boolean) as string[],
  };
}

export function draftIdentityText(pm: PmIdentity, company: Company): string {
  const d = draftIdentity(pm, company);
  return [
    "Drafts for this job:",
    `- Sign as: ${d.signature ? d.signature.replace(/\n/g, ", ") : "no PM set — ask who the PM is (intake job_settings)"}`,
    `- Suggested From: ${d.suggested_from ?? "PM email not recorded — ask for it (intake job_settings pm_email)"}`,
    `- ${HOST_PICKS_SENDER}`,
  ].join("\n");
}
