/** Routing references only. Reading the saved application still verifies current job access and version. */
export type PaymentEmailReference = { job_id: string; application_id: string; version: number };
export type PaymentEmailRoute = { kind: "none" } | { kind: "saved"; reference: PaymentEmailReference } | { kind: "clarify" };
export function paymentEmailRoute(link?: string | null, body = ""): PaymentEmailRoute {
  const refs = new Map<string, PaymentEmailReference>(); let incomplete = false;
  for (const raw of [link ?? "", ...body.matchAll(/https?:\/\/[^\s<>()]+/g)].map(x => typeof x === "string" ? x : x[0])) {
    if (!raw) continue;
    let url: URL; try { url = new URL(raw.replace(/[.,;]+$/, "")); } catch { continue; }
    if (!url.pathname.endsWith("/payment-applications")) continue;
    const job = url.pathname.match(/^\/r\/job\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/payment-applications$/i)?.[1];
    const id = url.searchParams.get("application_id"), value = url.searchParams.get("version");
    if (url.origin !== "https://app.meetathena.io" || url.username || url.password || !job ||
      !id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
      url.searchParams.getAll("application_id").length !== 1 || url.searchParams.getAll("version").length !== 1 ||
      !value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) { incomplete = true; continue; }
    const reference = { job_id: job, application_id: id, version: Number(value) };
    refs.set(`${job}/${id}/${value}`, reference);
  }
  if (incomplete || refs.size > 1) return { kind: "clarify" };
  return refs.size ? { kind: "saved", reference: [...refs.values()][0] } : { kind: "none" };
}
export function explicitPaymentLinkFallback(args: { delivery_mode?: string; fallback_reason?: string }): boolean {
  return args.delivery_mode === "link" && ["member_requested_link", "host_attachment_unavailable"].includes(args.fallback_reason ?? "");
}
export const EMAIL_CONFIRMATION_SURFACE_RULE = "Use one Athena confirmation surface. When the interactive email card provides an enabled Approve and send action, use that action and do not add another yes/no question or your own approval controls. If the card cannot approve, ask the supplied confirm_question once in ordinary text. A required connected-provider permission prompt must still be completed. Approval is not a provider receipt, and changed drafts or uncertain outcomes require review or reconciliation.";
