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

/** Data for drafts: who signs and the suggested From. Visible to the PM; how to use it is in DRAFT_GUIDANCE. */
export function draftIdentityText(pm: PmIdentity, company: Company): string {
  const d = draftIdentity(pm, company);
  return [
    "Drafts for this job:",
    `- Sign as: ${d.signature ? d.signature.replace(/\n/g, ", ") : "no PM set yet"}`,
    `- Suggested From: ${d.suggested_from ?? "PM email not recorded"}`,
  ].join("\n");
}

/** Assistant-only: how to use the draft data. Goes to structuredContent / _meta, never the visible text. */
export function draftGuidance(pm: PmIdentity, company: Company): string[] {
  const d = draftIdentity(pm, company);
  return [
    `Start every email or letter you draft for this job with these two lines, outside the email card: ${draftHeader(pm, company).replace(/\n/g, " / ")}.`,
    HOST_PICKS_SENDER,
    ...(d.missing.length ? [`Missing for drafts: ${d.missing.join(", ")}. Ask the member and save it with intake section job_settings.`] : []),
  ];
}

/** The literal lines a draft carries: "Suggested From: <PM email>" and "Sign as: <name, title, company>". */
export function draftHeader(pm: PmIdentity, company: Company): string {
  const d = draftIdentity(pm, company);
  return [
    `Suggested From: ${d.suggested_from ?? "PM email not recorded"}`,
    `Sign as: ${d.signature ? d.signature.replace(/\n/g, ", ") : "no PM set"}`,
  ].join("\n");
}
