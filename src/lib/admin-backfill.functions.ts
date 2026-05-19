// One-time admin backfill: pull every past book purchase from Stripe and seed
// `pending_claims` so future signups with the matching email auto-claim Book
// Buyer tier via the existing `claim_pending_subscription` trigger.

import { createServerFn } from "@tanstack/react-start";
import Stripe from "stripe";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function getStripe(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Stripe is not configured.");
  return new Stripe(secret, { apiVersion: "2024-12-18.acacia" as never });
}

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r) => r.role === "admin");
  if (!isAdmin) throw new Error("Forbidden");
}

export type BackfillResult = {
  dryRun: boolean;
  filterPriceId: string | null;
  scanned: number;
  matched: number;
  uniqueEmails: number;
  inserted: number;
  skippedAlreadyClaimed: number;
  skippedAlreadySubscribed: number;
  errors: string[];
  sampleEmails: string[];
};

export const backfillBookBuyers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      dryRun: z.boolean().default(true),
    }).parse,
  )
  .handler(async ({ data, context }): Promise<BackfillResult> => {
    await assertAdmin(context.userId);
    const stripe = getStripe();
    const priceId = process.env.STRIPE_PRICE_ID_BOOK ?? null;

    const result: BackfillResult = {
      dryRun: data.dryRun,
      filterPriceId: priceId,
      scanned: 0,
      matched: 0,
      uniqueEmails: 0,
      inserted: 0,
      skippedAlreadyClaimed: 0,
      skippedAlreadySubscribed: 0,
      errors: [],
      sampleEmails: [],
    };

    // Collect candidate (email, customer_id, charge_id) tuples
    const candidates = new Map<
      string,
      { email: string; customerId: string | null; chargeId: string }
    >();

    try {
      // Walk all completed checkout sessions. For one-time book sales we look
      // at sessions with line items matching the book price ID. Stripe doesn't
      // let us filter sessions by price server-side, so we paginate and filter
      // client-side.
      let startingAfter: string | undefined = undefined;
      // Safety cap so we never loop forever.
      const MAX_PAGES = 100;
      for (let page = 0; page < MAX_PAGES; page++) {
        const list: Stripe.ApiList<Stripe.Checkout.Session> =
          await stripe.checkout.sessions.list({
            limit: 100,
            starting_after: startingAfter,
            expand: ["data.line_items"],
          });

        for (const sess of list.data) {
          result.scanned += 1;
          if (sess.payment_status !== "paid") continue;

          // Match by price ID on a line item, OR by metadata.product === 'book_v2'
          let matches = sess.metadata?.product === "book_v2";
          if (!matches && priceId) {
            const items =
              sess.line_items?.data ??
              (
                await stripe.checkout.sessions.listLineItems(sess.id, {
                  limit: 10,
                })
              ).data;
            matches = items.some((li) => li.price?.id === priceId);
          }
          if (!matches) continue;

          const email =
            sess.customer_details?.email ??
            sess.customer_email ??
            null;
          if (!email) continue;

          result.matched += 1;
          const key = email.toLowerCase();
          if (!candidates.has(key)) {
            candidates.set(key, {
              email,
              customerId:
                typeof sess.customer === "string" ? sess.customer : null,
              chargeId: sess.id,
            });
          }
        }

        if (!list.has_more) break;
        startingAfter = list.data[list.data.length - 1]?.id;
        if (!startingAfter) break;
      }
    } catch (err) {
      result.errors.push(
        `Stripe scan failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    result.uniqueEmails = candidates.size;
    result.sampleEmails = Array.from(candidates.keys()).slice(0, 10);

    // Check what's already in pending_claims and subscriptions
    const emails = Array.from(candidates.keys());
    if (emails.length === 0) return result;

    const [{ data: existingClaims }, { data: existingSubs }] = await Promise.all([
      supabaseAdmin
        .from("pending_claims")
        .select("email")
        .in("email", emails),
      supabaseAdmin
        .from("subscriptions")
        .select("email")
        .in("email", emails),
    ]);
    const claimedSet = new Set(
      (existingClaims ?? []).map((r) => r.email.toLowerCase()),
    );
    const subbedSet = new Set(
      (existingSubs ?? []).map((r) => r.email.toLowerCase()),
    );

    const rowsToInsert: Array<{
      email: string;
      stripe_customer_id: string | null;
      status: string;
      metadata: Record<string, unknown>;
    }> = [];

    for (const [key, cand] of candidates) {
      if (subbedSet.has(key)) {
        result.skippedAlreadySubscribed += 1;
        continue;
      }
      if (claimedSet.has(key)) {
        result.skippedAlreadyClaimed += 1;
        continue;
      }
      rowsToInsert.push({
        email: cand.email,
        stripe_customer_id: cand.customerId,
        status: "active",
        metadata: {
          product: "book_v2",
          source: "backfill",
          checkout_session_id: cand.chargeId,
        },
      });
    }

    if (!data.dryRun && rowsToInsert.length > 0) {
      // Insert in chunks of 500
      for (let i = 0; i < rowsToInsert.length; i += 500) {
        const chunk = rowsToInsert.slice(i, i + 500);
        const { error } = await supabaseAdmin
          .from("pending_claims")
          .insert(chunk);
        if (error) {
          result.errors.push(`Insert chunk ${i}: ${error.message}`);
        } else {
          result.inserted += chunk.length;
        }
      }
    } else {
      // dry-run: report how many would be inserted via the inserted field
      result.inserted = rowsToInsert.length;
    }

    return result;
  });
