import { createFileRoute } from "@tanstack/react-router";
import Stripe from "stripe";
import { buildTokenHashAuthUrl } from "@/lib/auth-link-url";
import { syncPaidResendContact } from "@/lib/resend/capture";
import {
  hubTierForPurchase,
  resendSegmentForPurchase,
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
// customer.subscription.deleted, checkout.session.completed, invoice.payment_failed.
//
// Hub tier + Resend segment mapping lives in src/lib/stripe/paid-product-map.ts.
// Circle live monthly (hardcoded, not env-only):
//   price_1TVh3TJdDAUSVXbNJRsYFTbp / prod_UUgQlHRk9H1ZUS
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

function splitPersonName(name?: string | null): { firstName: string | null; lastName: string | null } {
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
}): Promise<void> {
  const segment = resendSegmentForPurchase({
    priceId: opts.priceId,
    productId: opts.productId,
    metaProduct: opts.metaProduct,
    metaKind: opts.metaKind,
  });
  if (!segment) return;
  await syncPaidResendContact({
    email: opts.email,
    firstName: opts.firstName,
    lastName: opts.lastName,
    company: opts.company,
    segment,
    source: "stripe",
    source_url: "https://app.alpcontractorcircle.com",
    magnet: segment,
  });
}

function productLabelForTier(tier: Tier): string {
  if (tier === "book_buyer") return "book_v2";
  return tier;
}

function stripeObjectId(event: Stripe.Event): string | null {
  const object = event.data.object as { id?: unknown };
  return typeof object.id === "string" ? object.id : null;
}

async function beginWebhookEvent(supabaseAdmin: SupabaseAdminClient, event: Stripe.Event): Promise<WebhookEventClaim> {
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

async function finishWebhookEvent(supabaseAdmin: SupabaseAdminClient, eventId: string, status: "processed" | "failed", err?: unknown) {
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
            case "customer.subscription.deleted": {
              const sub = event.data.object as Stripe.Subscription;
              if (isAosAddonSubscription(sub)) {
                await upsertAosAddon(supabaseAdmin, stripe, sub);
              } else {
                await upsertSubscription(supabaseAdmin, stripe, sub);
              }
              break;
            }
            case "checkout.session.completed": {
              const session = event.data.object as Stripe.Checkout.Session;
              if (session.subscription) {
                const sub = await stripe.subscriptions.retrieve(
                  typeof session.subscription === "string"
                    ? session.subscription
                    : session.subscription.id,
                );
                if (isAosAddonSubscription(sub)) {
                  await upsertAosAddon(supabaseAdmin, stripe, sub);
                } else {
                  await upsertSubscription(supabaseAdmin, stripe, sub);
                }
              } else {
                // One-time purchase (book, intensive). No subscription object;
                // we synthesize a row keyed on the session id so the tier
                // resolver and claim flow still work.
                await upsertOneTimePurchase(supabaseAdmin, stripe, session);
              }
              break;
            }
            case "invoice.payment_failed": {
              const invoice = event.data.object as Stripe.Invoice;
              const subscription = (
                invoice as Stripe.Invoice & {
                  subscription?: string | { id?: string } | null;
                }
              ).subscription;
              const subscriptionId =
                typeof subscription === "string" ? subscription : subscription?.id;
              if (subscriptionId) {
                const sub = await stripe.subscriptions.retrieve(subscriptionId);
                await upsertSubscription(supabaseAdmin, stripe, sub);
              }
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

async function upsertSubscription(supabaseAdmin: SupabaseAdminClient, stripe: Stripe, sub: Stripe.Subscription) {
  let email: string | null = null;
  let customerName: string | null = null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const existingByStripe = await supabaseAdmin
    .from("subscriptions")
    .select("user_id,email,tier,status,is_founding,is_comped")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle();
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

  const normalizedEmail = (existingByStripe.data?.email ?? email).toLowerCase();
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const rawProduct = sub.items.data[0]?.price?.product;
  const productId =
    typeof rawProduct === "string"
      ? rawProduct
      : rawProduct && typeof rawProduct === "object" && "id" in rawProduct
        ? String((rawProduct as { id: string }).id)
        : null;
  const cpe = (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end;
  const currentPeriodEnd = cpe ? new Date(cpe * 1000).toISOString() : null;
  const metadata = (sub.metadata ?? {}) as Record<string, string>;
  const purchaseIds = {
    priceId,
    productId,
    metaProduct: metadata.product,
    metaKind: metadata.kind,
  };
  const tier = hubTierForPurchase(purchaseIds);
  const resendSegment = resendSegmentForPurchase(purchaseIds);
  if (!tier && !resendSegment) return;

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
      });
    }
    return;
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  const row = {
    user_id: profile?.id ?? existingByStripe.data?.user_id ?? null,
    email: normalizedEmail,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    price_id: priceId,
    product_id: productId,
    status: sub.status === "past_due" && existingByStripe.data?.status === "active" ? "active" : sub.status,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    current_period_end: currentPeriodEnd,
    metadata: { ...metadata, stripe_customer_email: email.toLowerCase(), product: productLabelForTier(tier) },
    tier: tier === "aos_only" && existingByStripe.data?.tier === "circle" ? "circle" : tier,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await supabaseAdmin
    .from("subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });

  if (upsertErr) {
    console.error("Failed to upsert subscription", upsertErr);
    throw new Error(upsertErr.message);
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

  // Fire Circle welcome email on first activation. Idempotent per Stripe
  // subscription id, so retries / status updates won't duplicate the send.
  if (tier === "circle" && (sub.status === "active" || sub.status === "trialing")) {
    try {
      const origin = (
        process.env.PUBLIC_APP_ORIGIN ||
        process.env.APP_ORIGIN ||
        "https://app.alpcontractorcircle.com"
      ).replace(/\/$/, "");
      const loginUrl = await ensureMagicLinkForMember(supabaseAdmin, normalizedEmail, origin);
      const { enqueueCircleWelcome } = await import("@/lib/email/enqueue-circle-welcome");
      const result = await enqueueCircleWelcome({
        supabaseAdmin,
        email: normalizedEmail,
        firstName,
        loginUrl,
        idempotencyKey: `circle-welcome-${sub.id}`,
      });
      if (result.status === "failed") {
        console.error("Circle welcome enqueue failed", { sub: sub.id, reason: result.reason });
      }
    } catch (err) {
      // Never fail the webhook over an email send.
      console.error("Circle welcome enqueue threw", { sub: sub.id, err });
    }
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
    });
  }
}

// Make sure the auth user exists, then return a one-click magic link that
// signs them straight into the portal. Falls back to the bare site URL if
// link generation fails — the welcome email is never worth blocking on.
async function ensureMagicLinkForMember(
  supabaseAdmin: SupabaseAdminClient,
  email: string,
  origin: string,
): Promise<string | null> {
  try {
    const perPage = 200;
    let exists = false;
    for (let page = 1; page <= 25; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const users = data?.users ?? [];
      if (users.some((u) => (u.email ?? "").toLowerCase() === email)) {
        exists = true;
        break;
      }
      if (users.length < perPage) break;
    }
    if (!exists) {
      const { error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { source: "stripe_purchase", invited_at: new Date().toISOString() },
      });
      // The existence scan above pages through listUsers and can MISS a real
      // user (past its paging window, or on a race). When it does, createUser
      // hits a duplicate-email DB constraint and returns a GENERIC
      // "Database error creating new user" — which contains none of
      // already/registered/exists. Do NOT throw on it: any failure here just
      // means we couldn't create the user, and if they already exist,
      // generateLink below still succeeds and issues their login link.
      // (Previously this threw, so a paying member got no one-click link and a
      // link-less welcome email.) generateLink is the real source of truth.
      if (createErr) {
        console.warn("createUser during welcome-link failed; proceeding to generateLink", {
          email,
          message: createErr.message,
          status: (createErr as { status?: number }).status,
          code: (createErr as { code?: string }).code,
        });
      }
    }
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${origin}/auth/callback` },
    });
    if (error) throw error;
    const tokenHash = data?.properties?.hashed_token;
    return tokenHash
      ? buildTokenHashAuthUrl({ origin, tokenHash, type: "magiclink" })
      : null;
  } catch (err) {
    console.error("ensureMagicLinkForMember failed", { email, err });
    return null;
  }
}

// One-time purchase path (book, intensive). Mirrors upsertSubscription so the
// tier/claim resolver works the same way for recurring and one-time products.
async function upsertOneTimePurchase(supabaseAdmin: SupabaseAdminClient, stripe: Stripe, session: Stripe.Checkout.Session) {
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
  const fromCustomer = splitPersonName(session.customer_details?.name ?? metadata.first_name ?? null);
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
      console.warn("Call pack purchase has no matching profile yet", { email: normalizedEmail, session: session.id });
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
    metaProduct: metadata.product,
    metaKind: metadata.kind,
  };
  const tier = hubTierForPurchase(purchaseIds);
  const resendSegment = resendSegmentForPurchase(purchaseIds);

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

async function upsertAosAddon(supabaseAdmin: SupabaseAdminClient, stripe: Stripe, sub: Stripe.Subscription) {
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
  const cpe = (sub as Stripe.Subscription & { current_period_end?: number }).current_period_end;
  const currentPeriodEnd = cpe ? new Date(cpe * 1000).toISOString() : null;
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
