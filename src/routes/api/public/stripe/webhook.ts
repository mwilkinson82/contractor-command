import { createFileRoute } from "@tanstack/react-router";
import Stripe from "stripe";
import {
  cancellationActivation,
  cancellationFacts,
  cancellationEventMatches,
} from "@/lib/email/circle-cancellation";
import { enqueueCircleCancellation } from "@/lib/email/circle-cancellation.server";
import { shouldSkipResendCapture } from "@/lib/resend/never-email";
import { circleDecision, membershipDb } from "@/lib/membership/circle.server";
import { drainCircleAudienceSync } from "@/lib/membership/reconcile.server";
import {
  invoiceSubscriptionId,
  paidThroughFromInvoice,
  paymentEvidenceReviewReason,
  recurringInvoicePeriodEnd,
  subscriptionPeriodEnd,
} from "@/lib/stripe/subscription-evidence";
import {
  verifyInvoicePayment,
  type InvoicePaymentState,
} from "@/lib/stripe/invoice-payment.server";
import {
  circleWelcomeIdempotencyKey,
  findCircleWelcomeLog,
  markCircleWelcomeSent,
} from "@/lib/email/circle-welcome-state";
import { appOrigin, ensureMagicLinkForMember } from "@/lib/email/ensure-magic-link";
import { syncPaidResendContact } from "@/lib/resend/capture";
import {
  hubTierForPurchase,
  resendSegmentForPurchase,
  stripeRefId,
  type HubTier,
} from "@/lib/stripe/paid-product-map";

type SupabaseAdminClient = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// Stripe webhook: keeps `subscriptions` in sync with Stripe state.
// Live URL (do not change): https://app.alpcontractorcircle.com/api/public/stripe/webhook
// Required events: customer.subscription.created, customer.subscription.updated,
// customer.subscription.deleted, checkout.session.completed, checkout.session.async_payment_succeeded,
// invoice.paid, invoice.payment_failed, customer.subscription.paused/resumed.
// Also charge.refunded and charge.dispute.created/updated/closed for payment reversals.
//
// Hub tier + Resend segment mapping lives in src/lib/stripe/paid-product-map.ts.
// Circle live monthly (hardcoded, not env-only):
//   price_1TVh3TJdDAUSVXbNJRsYFTbp / prod_UUgQlHRk9H1ZUS / plink_1ThaqAJdDAUSVXbN66bTiP9o
// Payment Link checkouts pass session.payment_link into hubTierForPurchase so
// they stay Circle even when Stripe omits kind/product metadata.
// Anything else is ignored for hub rows. This Stripe account also sells
// products outside this portal, so unknown prices must not create people
// here. Resend contact upsert is an alongside path — it does not send mail
// and must not replace hub Circle welcome.
type Tier = HubTier;
type WebhookEventClaim = "process" | "duplicate" | "in_progress";
type SupabaseRpcResult<T> = Promise<{
  data: T | null;
  error: { message: string } | null;
}>;
type SupabaseRpcClient = {
  rpc: <T>(fn: string, args: Record<string, unknown>) => SupabaseRpcResult<T>;
};

function splitPersonName(name?: string | null): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { firstName: null, lastName: null };
  const parts = trimmed.split(/\s+/);
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null };
}

async function syncResendForPaidPurchase(opts: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  priceId: string | null;
  productId: string | null;
  metaProduct?: string | null;
  metaKind?: string | null;
  stripeSubscriptionId?: string | null;
}): Promise<void> {
  const segment = resendSegmentForPurchase({
    priceId: opts.priceId,
    productId: opts.productId,
    metaProduct: opts.metaProduct,
    metaKind: opts.metaKind,
  });
  if (!segment || segment === "circle") return; // Circle uses the canonical durable outbox.
  const result = await syncPaidResendContact(
    {
      email: opts.email,
      firstName: opts.firstName,
      lastName: opts.lastName,
      company: opts.company,
      segment,
      source: "stripe",
      source_url: "https://app.alpcontractorcircle.com",
      magnet: segment,
    },
    { logSource: "stripe_webhook", stripeSubscriptionId: opts.stripeSubscriptionId ?? null },
  );
  if (!result.ok) throw new Error(result.reason);
}

function productLabelForTier(tier: Tier): string {
  if (tier === "book_buyer") return "book_v2";
  return tier;
}

function stripeObjectId(event: Stripe.Event): string | null {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === "string" ? object.id : null;
}

async function beginWebhookEvent(
  supabaseAdmin: SupabaseAdminClient,
  event: Stripe.Event,
): Promise<WebhookEventClaim> {
  const rpc = supabaseAdmin as unknown as SupabaseRpcClient;
  const { data, error } = await rpc.rpc<WebhookEventClaim>("begin_stripe_webhook_event", {
    _event_id: event.id,
    _event_type: event.type,
    _object_id: stripeObjectId(event),
  });

  if (error) {
    throw new Error(`Failed to claim Stripe webhook event: ${error.message}`);
  }

  if (data === "process" || data === "duplicate" || data === "in_progress") {
    return data;
  }

  throw new Error(`Unexpected Stripe webhook claim result: ${String(data)}`);
}

async function finishWebhookEvent(
  supabaseAdmin: SupabaseAdminClient,
  eventId: string,
  status: "processed" | "failed",
  err?: unknown,
) {
  const message = err instanceof Error ? err.message : err ? String(err) : null;
  const rpc = supabaseAdmin as unknown as SupabaseRpcClient;
  const { error } = await rpc.rpc<void>("finish_stripe_webhook_event", {
    _event_id: eventId,
    _status: status,
    _last_error: message?.slice(0, 2000) ?? null,
  });

  if (error) {
    console.error("Failed to finish Stripe webhook event", {
      eventId,
      status,
      error,
    });
    throw new Error(`Failed to finish Stripe webhook event: ${error.message}`);
  }
}

export const Route = createFileRoute("/api/public/stripe/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_SECRET_KEY;
        const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret || !whSecret) {
          console.error("Stripe webhook: missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
          return new Response("Server not configured", { status: 500 });
        }

        const sig = request.headers.get("stripe-signature");
        if (!sig) return new Response("Missing signature", { status: 400 });

        const body = await request.text();
        const stripe = new Stripe(secret, { apiVersion: "2024-12-18.acacia" as never });
        const supabaseAdmin = await getSupabaseAdmin();

        let event: Stripe.Event;
        try {
          event = await stripe.webhooks.constructEventAsync(body, sig, whSecret);
        } catch (err) {
          console.error("Stripe signature verification failed", err);
          return new Response("Invalid signature", { status: 400 });
        }

        let claim: WebhookEventClaim;
        try {
          claim = await beginWebhookEvent(supabaseAdmin, event);
        } catch (err) {
          console.error("Stripe webhook idempotency check failed", {
            type: event.type,
            eventId: event.id,
            err,
          });
          return new Response("Idempotency check failed", { status: 500 });
        }

        if (claim === "duplicate") {
          return new Response(JSON.stringify({ received: true, duplicate: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (claim === "in_progress") {
          return new Response("Event already processing", { status: 409 });
        }

        try {
          switch (event.type) {
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted":
            case "customer.subscription.paused":
            case "customer.subscription.resumed": {
              // Events can arrive out of order. Always retrieve current Stripe state.
              const observedAt = new Date().toISOString();
              const sub = await stripe.subscriptions.retrieve(
                (event.data.object as Stripe.Subscription).id,
              );
              if (isAosAddonSubscription(sub)) {
                await upsertAosAddon(supabaseAdmin, stripe, sub);
              } else {
                await upsertSubscription(
                  supabaseAdmin,
                  stripe,
                  sub,
                  null,
                  observedAt,
                  undefined,
                  false,
                  event,
                );
              }
              break;
            }
            case "checkout.session.completed":
            case "checkout.session.async_payment_succeeded": {
              let session = event.data.object as Stripe.Checkout.Session;
              if (!session.subscription && session.mode === "subscription") {
                try {
                  session = await stripe.checkout.sessions.retrieve(session.id);
                } catch (err) {
                  console.warn("Could not re-fetch subscription-mode checkout session", {
                    sessionId: session.id,
                    err,
                  });
                }
              }
              if (
                session.payment_status !== "paid" &&
                session.payment_status !== "no_payment_required"
              )
                break;
              if (session.mode === "subscription" && !session.subscription)
                throw new Error("Subscription checkout has no subscription");
              if (session.subscription) {
                const observedAt = new Date().toISOString();
                const sub = await stripe.subscriptions.retrieve(
                  typeof session.subscription === "string"
                    ? session.subscription
                    : session.subscription.id,
                );
                if (isAosAddonSubscription(sub)) {
                  await upsertAosAddon(supabaseAdmin, stripe, sub);
                } else {
                  await upsertSubscription(
                    supabaseAdmin,
                    stripe,
                    sub,
                    stripeRefId(session.payment_link),
                    observedAt,
                  );
                }
              } else {
                // One-time purchase (book, intensive). No subscription object;
                // we synthesize a row keyed on the session id so the tier
                // resolver and claim flow still work.
                await upsertOneTimePurchase(supabaseAdmin, stripe, session);
              }
              break;
            }
            case "invoice.paid":
            case "invoice.payment_failed": {
              const invoice = event.data.object as Stripe.Invoice;
              const subscriptionId = invoiceSubscriptionId(invoice);
              if (subscriptionId) {
                const observedAt = new Date().toISOString();
                const sub = await stripe.subscriptions.retrieve(subscriptionId);
                if (isAosAddonSubscription(sub)) await upsertAosAddon(supabaseAdmin, stripe, sub);
                else
                  await upsertSubscription(
                    supabaseAdmin,
                    stripe,
                    sub,
                    null,
                    observedAt,
                    event.type === "invoice.paid" ? invoice.id : undefined,
                  );
              }
              break;
            }
            case "charge.refunded":
            case "charge.dispute.created":
            case "charge.dispute.updated":
            case "charge.dispute.closed": {
              const object = event.data.object as { id: string; charge?: unknown };
              const chargeId =
                event.type === "charge.refunded" ? object.id : stripeRefId(object.charge);
              if (!chargeId) throw new Error("Payment reversal has no charge reference");
              const charge = await stripe.charges.retrieve(chargeId);
              // Acacia's current Charge carries its invoice reference. One-time
              // charges have none and must not change unrelated product access.
              const invoiceId = stripeRefId(
                (charge as Stripe.Charge & { invoice?: unknown }).invoice,
              );
              if (!invoiceId) break;
              const invoice = await stripe.invoices.retrieve(invoiceId);
              const subscriptionId = invoiceSubscriptionId(invoice);
              if (!subscriptionId) break;
              const observedAt = new Date().toISOString();
              const sub = await stripe.subscriptions.retrieve(subscriptionId);
              await upsertSubscription(
                supabaseAdmin,
                stripe,
                sub,
                null,
                observedAt,
                invoiceId,
                true,
              );
              break;
            }
            default:
              break;
          }
          await finishWebhookEvent(supabaseAdmin, event.id, "processed");
        } catch (err) {
          console.error("Stripe webhook handler error", { type: event.type, err });
          try {
            await finishWebhookEvent(supabaseAdmin, event.id, "failed", err);
          } catch {
            // finishWebhookEvent already logs; preserve the Stripe retry signal.
          }
          return new Response("Handler error", { status: 500 });
        }

        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

async function upsertSubscription(
  supabaseAdmin: SupabaseAdminClient,
  stripe: Stripe,
  sub: Stripe.Subscription,
  paymentLinkId?: string | null,
  observedAt = new Date().toISOString(),
  paidInvoiceId?: string,
  circleOnly = false,
  lifecycleEvent?: Stripe.Event,
) {
  let email: string | null = null;
  let customerName: string | null = null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const existingByStripe = await supabaseAdmin
    .from("subscriptions")
    .select("id,user_id,email,tier,status,is_founding,is_comped,metadata")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
  if (existingByStripe.error) throw new Error(existingByStripe.error.message);
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!("deleted" in customer) || !customer.deleted) {
      const live = customer as Stripe.Customer;
      email = live.email ?? null;
      customerName = live.name ?? null;
    }
  } catch (err) {
    console.error("Failed to retrieve Stripe customer", { customerId, err });
    throw err;
  }

  if (!email) {
    throw new Error(`Stripe subscription has no resolvable email: ${sub.id}`);
  }

  const normalizedEmail = (existingByStripe.data?.email ?? email).trim().toLowerCase();
  const primaryItem =
    sub.items.data.find(
      (item) =>
        hubTierForPurchase({
          priceId: item.price.id,
          productId: stripeRefId(item.price.product),
        }) === "circle",
    ) ?? sub.items.data[0];
  const priceId = primaryItem?.price?.id ?? null;
  const rawProduct = primaryItem?.price?.product;
  const productId =
    typeof rawProduct === "string"
      ? rawProduct
      : rawProduct && typeof rawProduct === "object" && "id" in rawProduct
        ? String((rawProduct as { id: string }).id)
        : null;
  const currentPeriodEnd = subscriptionPeriodEnd(sub);
  const metadata = (sub.metadata ?? {}) as Record<string, string>;
  const purchaseIds = {
    priceId,
    productId,
    paymentLinkId: paymentLinkId ?? null,
    metaProduct: metadata.product,
    metaKind: metadata.kind,
  };
  const tier = hubTierForPurchase(purchaseIds);
  const resendSegment = resendSegmentForPurchase(purchaseIds);
  if (circleOnly && tier !== "circle") return;
  if (!tier && !resendSegment) {
    if (existingByStripe.data?.tier === "circle" || existingByStripe.data?.tier === "hardcore") {
      throw new Error("Existing Circle subscription has an unrecognized product; review required");
    }
    return;
  }

  if (
    tier !== "circle" &&
    (existingByStripe.data?.tier === "circle" || existingByStripe.data?.tier === "hardcore")
  ) {
    throw new Error("Circle product changed; explicit entitlement review required");
  }

  const metaFirst = (metadata.first_name ?? "").trim() || null;
  const fromCustomer = splitPersonName(customerName);
  const firstName = metaFirst ?? fromCustomer.firstName;
  const lastName = fromCustomer.lastName;
  const company = (metadata.company ?? "").trim() || null;
  const paidActive = sub.status === "active" || sub.status === "trialing";

  if (!tier) {
    if (resendSegment && paidActive) {
      await syncResendForPaidPurchase({
        email: normalizedEmail,
        firstName,
        lastName,
        company,
        priceId,
        productId,
        metaProduct: metadata.product,
        metaKind: metadata.kind,
        stripeSubscriptionId: sub.id,
      });
    }
    return;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (profileError) throw new Error(`Ambiguous membership identity: ${profileError.message}`);

  const row = {
    user_id: existingByStripe.data?.user_id ?? profile?.id ?? null,
    email: normalizedEmail,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    price_id: priceId,
    product_id: productId,
    status: sub.status,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    current_period_end: currentPeriodEnd,
    metadata: {
      ...((existingByStripe.data?.metadata ?? {}) as Record<string, unknown>),
      ...metadata,
      stripe_customer_email: email.toLowerCase(),
      product: productLabelForTier(tier),
      ...(paymentLinkId ? { payment_link: paymentLinkId } : {}),
    },
    tier,
    updated_at: new Date().toISOString(),
  };

  let circleEligible = false;
  let circleSourcePaid = false;
  if (tier === "circle") {
    const customerEmailChanged = email.trim().toLowerCase() !== normalizedEmail;
    const identityConflict = !!(
      profile?.id &&
      existingByStripe.data?.user_id &&
      profile.id !== existingByStripe.data.user_id
    );
    let approvedBillingIdentity = false;
    if (customerEmailChanged && !identityConflict && existingByStripe.data?.id && row.user_id) {
      const { data: approved, error: approvalError } = await membershipDb(supabaseAdmin).rpc(
        "circle_billing_identity_approved",
        {
          _source_id: existingByStripe.data.id,
          _stripe_subscription_id: sub.id,
          _stripe_customer_id: customerId,
          _hub_user_id: row.user_id,
          _hub_email: normalizedEmail,
          _billing_email: email.trim().toLowerCase(),
        },
      );
      if (approvalError) throw new Error(approvalError.message);
      approvedBillingIdentity = approved === true;
    }
    const invoiceId = stripeRefId(sub.latest_invoice);
    const priorInvoiceId = stripeRefId(
      (existingByStripe.data?.metadata as Record<string, unknown> | null)?.circle_paid_invoice_id,
    );
    const { data: priorEvidence, error: evidenceError } = await membershipDb(supabaseAdmin)
      .from("circle_subscription_evidence")
      .select("paid_through")
      .eq("stripe_subscription_id", sub.id)
      .maybeSingle();
    if (evidenceError) throw new Error(evidenceError.message);
    let paidThrough: string | null = null;
    let verifiedInvoiceId: string | null = null;
    let paymentPending = false;
    const rejected: { through: string; reason: Exclude<InvoicePaymentState, "settled"> }[] = [];
    // A late invoice.paid can arrive after the next invoice was opened. Verify
    // both references so the paid event cannot be lost behind latest_invoice.
    // Persisted provenance is needed when a later open renewal masks a refunded
    // paid invoice. Never rely on a previously saved future date without proof.
    const invoiceIds = [
      ...new Set([invoiceId, paidInvoiceId, priorInvoiceId].filter((id): id is string => !!id)),
    ];
    for (const candidateId of invoiceIds) {
      const invoice = await stripe.invoices.retrieve(candidateId);
      if (invoiceSubscriptionId(invoice) !== sub.id)
        throw new Error("Circle invoice belongs to another subscription");
      if (candidateId === invoiceId)
        paymentPending = invoice.status !== "paid" && sub.status === "active";
      const lines = await stripe.invoices
        .listLineItems(candidateId, { limit: 100 })
        .autoPagingToArray({ limit: 1000 });
      const periodInvoice = { ...invoice, lines: { data: lines, has_more: false } };
      const periodEnd = recurringInvoicePeriodEnd(periodInvoice, sub.id, priceId ? [priceId] : []);
      if (!periodEnd) continue;
      const paymentState = await verifyInvoicePayment(stripe, invoice, customerId);
      const candidatePaidThrough = paidThroughFromInvoice(
        periodInvoice,
        sub.id,
        priceId ? [priceId] : [],
        paymentState,
      );
      if (paymentState !== "settled") rejected.push({ through: periodEnd, reason: paymentState });
      if (candidatePaidThrough && (!paidThrough || candidatePaidThrough > paidThrough)) {
        paidThrough = candidatePaidThrough;
        verifiedInvoiceId = candidateId;
      }
    }
    const paymentReview = paymentEvidenceReviewReason(
      priorEvidence?.paid_through ?? null,
      paidThrough,
      rejected,
    );
    const reviewReason =
      identityConflict || (customerEmailChanged && !approvedBillingIdentity)
        ? "stripe_identity_mismatch"
        : (paymentReview ?? (paymentPending ? "renewal_payment_pending" : null));
    if (verifiedInvoiceId && !paymentReview)
      Object.assign(row.metadata, { circle_paid_invoice_id: verifiedInvoiceId });
    else Object.assign(row.metadata, { circle_paid_invoice_id: priorInvoiceId });
    const noticeFacts =
      cancellationActivation() === null
        ? null
        : cancellationFacts(sub, {
            periodEnd: currentPeriodEnd,
            paidThrough,
            reviewReason,
            memberEmail: normalizedEmail,
            billingEmail: email.trim().toLowerCase(),
            customerName,
            memberAllowed: !identityConflict && (!customerEmailChanged || approvedBillingIdentity),
            neverEmail: shouldSkipResendCapture({
              email: normalizedEmail,
              firstName,
              lastName,
              company,
            }),
          });
    if (cancellationActivation() !== null)
      Object.assign(row.metadata, { circle_cancellation_notice: noticeFacts });
    circleSourcePaid =
      !!paidThrough &&
      Date.parse(paidThrough) > Date.now() &&
      (!reviewReason || reviewReason === "renewal_payment_pending");
    const { data: applied, error } = await membershipDb(supabaseAdmin).rpc(
      "apply_circle_subscription_snapshot",
      {
        _row: row,
        _paid_through: paidThrough,
        _observed_at: observedAt,
        _review_reason: reviewReason,
      },
    );
    if (error) throw new Error(error.message);
    if (!applied) return; // Newer refresh already owns onboarding/claims/outbox.
    if (
      cancellationActivation() !== null &&
      lifecycleEvent &&
      lifecycleEvent.created * 1000 >= cancellationActivation()! &&
      ["customer.subscription.updated", "customer.subscription.deleted"].includes(
        lifecycleEvent.type,
      ) &&
      (sub.status === "canceled" || sub.cancel_at_period_end || sub.cancel_at) &&
      !sub.canceled_at &&
      !["payment_failed", "payment_disputed"].includes(sub.cancellation_details?.reason ?? "")
    )
      throw new Error(
        "Circle cancellation lacks a verified request timestamp; manual review required",
      );
    if (
      noticeFacts &&
      lifecycleEvent &&
      cancellationEventMatches(
        lifecycleEvent as Stripe.Event & { data: { object: Stripe.Subscription } },
        sub,
        noticeFacts,
      )
    )
      await enqueueCircleCancellation(supabaseAdmin, sub.id, noticeFacts, observedAt);
    circleEligible =
      (await circleDecision(supabaseAdmin, { userId: row.user_id, email: normalizedEmail }))
        .state === "eligible";
  } else {
    const { error } = await supabaseAdmin
      .from("subscriptions")
      .upsert(row, { onConflict: "stripe_subscription_id" });
    if (error) throw new Error(error.message);
  }

  if (!profile?.id) {
    const { error: pendingErr } = await supabaseAdmin.from("pending_claims").upsert(
      {
        email: normalizedEmail,
        stripe_customer_id: customerId,
        stripe_subscription_id: sub.id,
        price_id: priceId,
        status: sub.status,
        current_period_end: currentPeriodEnd,
        metadata: { ...metadata, product: productLabelForTier(tier) },
      },
      { onConflict: "stripe_subscription_id" },
    );
    if (pendingErr) {
      console.error("Failed to upsert pending claim", pendingErr);
      throw new Error(pendingErr.message);
    }

    if (sub.status === "active" || sub.status === "trialing") {
      // Circle gets the magic-link welcome below — skip the password-setup invite.
      if (tier !== "circle") {
        await invitePaidMemberIfNeeded(supabaseAdmin, normalizedEmail);
      }
    }
  }

  // Fire Circle welcome on first activation. welcome_sent_at is stamped only
  // after the hub mailer actually sends (process-queue). If email_send_log
  // already has a sent row for this subscription, backfill the stamp and skip
  // — that is the Dalton / Miragliotta double-send recovery path.
  if (tier === "circle" && circleEligible && circleSourcePaid && paidActive) {
    try {
      const idempotencyKey = circleWelcomeIdempotencyKey(sub.id);
      const { data: welcomeRow } = await supabaseAdmin
        .from("subscriptions")
        .select("welcome_sent_at")
        .eq("stripe_subscription_id", sub.id)
        .maybeSingle();

      if (welcomeRow?.welcome_sent_at) {
        // Already welcomed for this subscription — nothing to do.
      } else {
        const priorSent = await findCircleWelcomeLog(supabaseAdmin, idempotencyKey, ["sent"]);
        if (priorSent) {
          await markCircleWelcomeSent({
            supabase: supabaseAdmin,
            recipientEmail: normalizedEmail,
            idempotencyKey,
            sentAt: priorSent.created_at,
          });
        } else {
          const loginUrl = await ensureMagicLinkForMember(
            supabaseAdmin,
            normalizedEmail,
            appOrigin(),
          );
          const { enqueueCircleWelcome } = await import("@/lib/email/enqueue-circle-welcome");
          const result = await enqueueCircleWelcome({
            supabaseAdmin,
            email: normalizedEmail,
            firstName,
            loginUrl,
            idempotencyKey,
          });
          if (result.status === "failed") {
            console.error("Circle welcome enqueue failed", { sub: sub.id, reason: result.reason });
          }
        }
      }
    } catch (err) {
      // Never fail the webhook over an email send.
      console.error("Circle welcome enqueue threw", { sub: sub.id, err });
    }
  }

  if (tier === "circle") {
    const outcome = await drainCircleAudienceSync(supabaseAdmin, {
      apiKey: process.env.RESEND_API_KEY ?? "",
      email: normalizedEmail,
    });
    if (outcome.failed)
      throw new Error(`Circle audience sync failed (${outcome.failed}); durable retry required`);
  }

  if (resendSegment && paidActive) {
    await syncResendForPaidPurchase({
      email: normalizedEmail,
      firstName,
      lastName,
      company,
      priceId,
      productId,
      metaProduct: metadata.product,
      metaKind: metadata.kind,
      stripeSubscriptionId: sub.id,
    });
  }
}

// One-time purchase path (book, intensive). Mirrors upsertSubscription so the
// tier/claim resolver works the same way for recurring and one-time products.
async function upsertOneTimePurchase(
  supabaseAdmin: SupabaseAdminClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  let email: string | null = session.customer_details?.email ?? session.customer_email ?? null;
  const customerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  if (!email && customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (!("deleted" in customer) || !customer.deleted) {
        email = (customer as Stripe.Customer).email ?? null;
      }
    } catch (err) {
      console.error("Failed to retrieve Stripe customer for one-time purchase", {
        customerId,
        err,
      });
      throw err;
    }
  }
  if (!email) {
    throw new Error(`One-time purchase has no resolvable email: ${session.id}`);
  }

  const normalizedEmail = email.toLowerCase();
  const metadata = (session.metadata ?? {}) as Record<string, string>;
  const fromCustomer = splitPersonName(
    session.customer_details?.name ?? metadata.first_name ?? null,
  );
  const firstName = (metadata.first_name ?? "").trim() || fromCustomer.firstName;
  const lastName = (metadata.last_name ?? "").trim() || fromCustomer.lastName;
  const company = (metadata.company ?? "").trim() || null;

  // Call packs are services, not tier purchases — log to vault_packets
  // and skip subscription row creation.
  if (metadata.product === "calls" || metadata.kind === "calls") {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("email", normalizedEmail)
      .maybeSingle();
    if (profile?.id) {
      await supabaseAdmin.from("vault_packets").insert({
        user_id: profile.id,
        kind: "call_pack_purchase",
        source: "Stripe · Call pack",
        status: "Open",
        title: `Call pack: ${metadata.plan ?? "unknown"}`,
        payload: {
          plan: metadata.plan ?? "",
          email: normalizedEmail,
          checkout_session_id: session.id,
          amount_total: session.amount_total,
          captured_at: new Date().toISOString(),
        },
      });
    } else {
      console.warn("Call pack purchase has no matching profile yet", {
        email: normalizedEmail,
        session: session.id,
      });
    }
    return;
  }

  // Resolve price from line items.
  let priceId: string | null = null;
  let productId: string | null = null;
  try {
    const lines = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 1,
      expand: ["data.price.product"],
    });
    const price = lines.data[0]?.price;
    priceId = price?.id ?? null;
    productId =
      (price?.product as Stripe.Product | string | null) instanceof Object
        ? ((price?.product as Stripe.Product).id ?? null)
        : ((price?.product as string | null) ?? null);
  } catch (err) {
    console.warn("Could not list line items for one-time purchase", { sessionId: session.id, err });
  }

  const purchaseIds = {
    priceId,
    productId,
    paymentLinkId: stripeRefId(session.payment_link),
    metaProduct: metadata.product,
    metaKind: metadata.kind,
  };
  const tier = hubTierForPurchase(purchaseIds);
  const resendSegment = resendSegmentForPurchase(purchaseIds);
  if (tier === "circle" || resendSegment === "circle")
    throw new Error("Circle requires a recurring subscription");

  if (!tier) {
    if (resendSegment) {
      await syncResendForPaidPurchase({
        email: normalizedEmail,
        firstName,
        lastName,
        company,
        priceId,
        productId,
        metaProduct: metadata.product,
        metaKind: metadata.kind,
      });
    }
    return;
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  const syntheticSubId = `cs_${session.id}`; // unique per checkout session
  const row = {
    user_id: profile?.id ?? null,
    email: normalizedEmail,
    stripe_customer_id: customerId,
    stripe_subscription_id: syntheticSubId,
    price_id: priceId,
    product_id: productId,
    status: "active",
    cancel_at_period_end: false,
    current_period_end: null,
    metadata: { ...metadata, product: productLabelForTier(tier), checkout_session_id: session.id },
    tier,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });
  if (error) {
    console.error("Failed to upsert one-time purchase", error);
    throw new Error(error.message);
  }

  if (!profile?.id) {
    const { error: pendingErr } = await supabaseAdmin.from("pending_claims").upsert(
      {
        email: normalizedEmail,
        stripe_customer_id: customerId,
        stripe_subscription_id: syntheticSubId,
        price_id: priceId,
        status: "active",
        current_period_end: null,
        metadata: {
          ...metadata,
          product: productLabelForTier(tier),
          checkout_session_id: session.id,
        },
      },
      { onConflict: "stripe_subscription_id" },
    );
    if (pendingErr) {
      console.error("Failed to upsert one-time pending claim", pendingErr);
      throw new Error(pendingErr.message);
    }
    await invitePaidMemberIfNeeded(supabaseAdmin, normalizedEmail);
  }

  if (resendSegment) {
    await syncResendForPaidPurchase({
      email: normalizedEmail,
      firstName,
      lastName,
      company,
      priceId,
      productId,
      metaProduct: metadata.product,
      metaKind: metadata.kind,
    });
  }
}

async function invitePaidMemberIfNeeded(supabaseAdmin: SupabaseAdminClient, email: string) {
  const perPage = 200;
  for (let page = 1; page <= 25; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("Failed to check auth user before member invite", { email, error });
      throw error;
    }
    const users = data?.users ?? [];
    if (users.some((u) => (u.email ?? "").toLowerCase() === email)) return;
    if (users.length < perPage) break;
  }

  const origin = (
    process.env.PUBLIC_APP_ORIGIN ||
    process.env.APP_ORIGIN ||
    "https://app.alpcontractorcircle.com"
  ).replace(/\/$/, "");
  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    data: { source: "stripe_purchase", invited_at: new Date().toISOString() },
    redirectTo: `${origin}/welcome`,
  });
  if (error) {
    const msg = error.message ?? "";
    if (/already|registered|exists/i.test(msg)) return;
    console.error("Failed to send paid member invite", { email, error });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// AOS add-ons — separate table (aos_addons), separate code path. We never
// want add-on purchases to overwrite a user's primary tier in `subscriptions`.
// ---------------------------------------------------------------------------

function isAosAddonSubscription(sub: Stripe.Subscription): boolean {
  const seatPrice = process.env.STRIPE_PRICE_ID_AOS_SEAT_MONTH;
  const wsPrice = process.env.STRIPE_PRICE_ID_AOS_WORKSPACE_MONTH;
  const meta = (sub.metadata ?? {}) as Record<string, string>;
  if (meta.product === "aos_addon" || meta.kind === "aos_addon") return true;
  for (const item of sub.items.data) {
    const id = item.price?.id;
    if (id && (id === seatPrice || id === wsPrice)) return true;
  }
  return false;
}

function addonKindForPrice(priceId: string | null): "seat" | "workspace" | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_ID_AOS_SEAT_MONTH) return "seat";
  if (priceId === process.env.STRIPE_PRICE_ID_AOS_WORKSPACE_MONTH) return "workspace";
  return null;
}

async function upsertAosAddon(
  supabaseAdmin: SupabaseAdminClient,
  stripe: Stripe,
  sub: Stripe.Subscription,
) {
  let email: string | null = null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!("deleted" in customer) || !customer.deleted) {
      email = (customer as Stripe.Customer).email ?? null;
    }
  } catch (err) {
    console.error("Failed to retrieve Stripe customer for AOS add-on", { customerId, err });
    throw err;
  }
  if (!email) {
    throw new Error(`AOS add-on subscription has no resolvable email: ${sub.id}`);
  }
  const normalizedEmail = email.toLowerCase();

  // Each subscription = one line item of one add-on kind (we always create
  // them that way). If Stripe ever splits across items, take the first that
  // matches one of our two add-on price IDs.
  const item =
    sub.items.data.find((i) => addonKindForPrice(i.price?.id ?? null) !== null) ??
    sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const kind = addonKindForPrice(priceId);
  if (!kind) {
    console.warn("AOS add-on event with no matching price", { subId: sub.id, priceId });
    return;
  }
  const quantity = item?.quantity ?? 1;
  const currentPeriodEnd = subscriptionPeriodEnd(sub);
  const metadata = (sub.metadata ?? {}) as Record<string, string>;

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  // Map Stripe lifecycle to our status. 'canceled' subs go inactive so they
  // stop counting in get_user_aos_limits.
  const status =
    sub.status === "canceled" || sub.status === "incomplete_expired" ? "canceled" : sub.status;

  const { error } = await supabaseAdmin.from("aos_addons").upsert(
    {
      user_id: profile?.id ?? null,
      email: normalizedEmail,
      kind,
      quantity,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerId,
      price_id: priceId,
      status,
      current_period_end: currentPeriodEnd,
      metadata,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );
  if (error) {
    console.error("Failed to upsert aos_addons row", error);
    throw new Error(error.message);
  }
}
