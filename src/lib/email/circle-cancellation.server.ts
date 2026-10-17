import * as React from "react";
import { render } from "@react-email/components";
import { membershipDb } from "@/lib/membership/circle.server";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { MEMBER_REPLY_TO } from "./reply-to";
import {
  CIRCLE_CANCELLATION_MEMBER,
  CIRCLE_CANCELLATION_OWNER,
  CIRCLE_CANCELLATION_OWNER_EMAIL,
  cancellationActivation,
  isCircleCancellationLabel,
  type CircleCancellationFacts,
} from "./circle-cancellation";

type Payload = Record<string, unknown>;

export async function renderCancellation(facts: CircleCancellationFacts, owner: boolean) {
  const label = owner ? CIRCLE_CANCELLATION_OWNER : CIRCLE_CANCELLATION_MEMBER;
  const template = TEMPLATES[label];
  const element = React.createElement(template.component, { facts });
  const subject =
    typeof template.subject === "function" ? template.subject({ facts }) : template.subject;
  return { subject, html: await render(element), text: await render(element, { plainText: true }) };
}

/** Atomic per-recipient ledger + audit + queue; failures propagate to Stripe retry. */
export async function enqueueCircleCancellation(
  db: unknown,
  subscriptionId: string,
  facts: CircleCancellationFacts,
  observedAt: string,
) {
  if (cancellationActivation() === null) return;
  for (const owner of [false, true]) {
    const label = owner ? CIRCLE_CANCELLATION_OWNER : CIRCLE_CANCELLATION_MEMBER;
    const { data, error } = await membershipDb(db).rpc("enqueue_circle_cancellation_notice", {
      _subscription_id: subscriptionId,
      _observed_at: observedAt,
      _episode: facts.episode,
      _channel: owner ? "owner" : "member",
      _payload: {
        ...(await renderCancellation(facts, owner)),
        to: owner ? CIRCLE_CANCELLATION_OWNER_EMAIL : facts.memberEmail,
        from: "Contractor Circle <noreply@notify.mail.alpcontractorcircle.com>",
        reply_to: MEMBER_REPLY_TO,
        sender_domain: "notify.mail.alpcontractorcircle.com",
        purpose: "transactional",
        label,
        circle_cancellation_subscription_id: subscriptionId,
        circle_cancellation_episode: facts.episode,
      },
    });
    if (error) throw new Error(`Circle cancellation enqueue failed: ${error.message}`);
    if (!["queued", "duplicate", "suppressed"].includes(data))
      throw new Error(`Circle cancellation enqueue requires retry: ${String(data)}`);
  }
}

/** Shared by both Hub queue consumers. Does not require active membership. */
export async function prepareCircleCancellationDelivery(
  db: unknown,
  payload: Payload,
): Promise<
  | { allowed: true; content?: Awaited<ReturnType<typeof renderCancellation>> }
  | { allowed: false; reason: string }
> {
  if (!isCircleCancellationLabel(payload.label)) return { allowed: true };
  const cutoff = cancellationActivation();
  if (cutoff === null) return { allowed: false, reason: "cancellation_email_feature_disabled" };
  const client = membershipDb(db);
  const { data, error } = await client
    .from("subscriptions")
    .select("email,tier,status,cancel_at_period_end,metadata")
    .eq("stripe_subscription_id", payload.circle_cancellation_subscription_id)
    .maybeSingle();
  if (error) throw new Error(`Cancellation source verification failed: ${error.message}`);
  const facts = data?.metadata?.circle_cancellation_notice as CircleCancellationFacts | null;
  if (
    !data ||
    data.tier !== "circle" ||
    !facts ||
    facts.episode !== payload.circle_cancellation_episode ||
    Date.parse(facts.requestedAt) < cutoff ||
    !Number.isFinite(Date.parse(facts.requestedAt))
  )
    return { allowed: false, reason: "cancellation_episode_no_longer_current" };
  const owner = payload.label === CIRCLE_CANCELLATION_OWNER;
  const to = String(payload.to ?? "")
    .trim()
    .toLowerCase();
  if (
    to !== (owner ? CIRCLE_CANCELLATION_OWNER_EMAIL : data.email?.trim().toLowerCase()) ||
    (!owner && (!facts.memberAllowed || facts.neverEmail))
  )
    return { allowed: false, reason: "cancellation_recipient_not_verified" };
  const results = await Promise.all([
    client.from("suppressed_emails").select("email").eq("email", to).maybeSingle(),
    client.from("email_unsubscribe_tokens").select("used_at").eq("email", to).maybeSingle(),
  ]);
  for (const result of results)
    if (result.error)
      throw new Error(`Cancellation suppression lookup failed: ${result.error.message}`);
  if (results[0].data || results[1].data?.used_at)
    return { allowed: false, reason: "recipient_suppressed" };
  // Current refreshed Stripe snapshot supplies dates and coverage, not stale queued copy.
  return { allowed: true, content: await renderCancellation(facts, owner) };
}
