## Where the bug actually lives

The misleading admin notice ("This purchase didn't match a known product. No welcome email was sent to the customer.") is **not** emitted from this portal. It comes from the separate **[ALP Site](/projects/d5d995bb-85ad-4c1b-b601-a214c4a121a0)** project, in `supabase/functions/stripe-webhook/index.ts` (the "Unrecognized product" branch around lines 388–422).

Cross-project tooling here is read-only, so this plan has to be applied inside the ALP Site project. Open that project and ask Lovable to apply the change below — I can hand it over verbatim.

## Root cause

That webhook only knows about marketing-site SKUs (Power Hour, Contractor School, S&M School, ALP University, etc.). Contractor Circle subscriptions are sold/managed by this portal, so their Stripe price IDs aren't in `PRODUCT_MAP` / `PRICE_ID_MAP`. When a Circle purchase fires `checkout.session.completed` on the shared Stripe account, `getProductFromSession()` returns `null`, the webhook drops into the "Custom / Ad-Hoc" branch, and Marshall gets the scary admin email — even though the **portal's** Stripe webhook (`src/routes/api/public/stripe/webhook.ts`) successfully enqueued the Circle welcome (`circle-welcome-<sub_id>` in `email_send_log`).

The three Circle price IDs currently in use (pulled from `subscriptions`):

```
price_1TDR3aJdDAUSVXbNWVzFLblo   circle
price_1TDR3aJdDAUSVXbNZOY6EXF3   circle
price_1TVh3TJdDAUSVXbNJRsYFTbp   circle
```

## Fix (applied in the ALP Site project)

Edit `supabase/functions/stripe-webhook/index.ts`:

1. Add a set of "handled-by-portal" price IDs near the top, alongside `PRICE_ID_MAP`:

   ```ts
   // Contractor Circle prices are handled end-to-end by the portal app
   // (app.alpcontractorcircle.com). The portal's Stripe webhook sends the
   // Circle welcome + magic link. We just acknowledge and log here.
   const PORTAL_HANDLED_PRICE_IDS = new Set<string>([
     "price_1TDR3aJdDAUSVXbNWVzFLblo",
     "price_1TDR3aJdDAUSVXbNZOY6EXF3",
     "price_1TVh3TJdDAUSVXbNJRsYFTbp",
   ]);

   function sessionIsPortalHandled(session: any): boolean {
     if (session.metadata?.kind === "circle" || session.metadata?.product === "circle") return true;
     const items = session.line_items?.data ?? [];
     for (const item of items) {
       const priceId = typeof item.price === "string" ? item.price : item.price?.id;
       if (priceId && PORTAL_HANDLED_PRICE_IDS.has(priceId)) return true;
     }
     return false;
   }
   ```

2. In `handler`, **before** the `getProductFromSession` lookup (just after we have `customerEmail`), short-circuit Circle purchases:

   ```ts
   if (sessionIsPortalHandled(session)) {
     console.log("Circle purchase — handled by portal app, skipping marketing-site flow");
     await supabase.from("purchase_log").insert({
       customer_name: customerName,
       customer_email: customerEmail,
       product_name: "Contractor Circle (handled by portal)",
       stripe_session_id: session.id,
       amount_cents: session.amount_total,
       welcome_email_sent: true,        // portal sent it
       kajabi_provisioned: false,       // intentional — Circle doesn't use Kajabi
     });
     return new Response(JSON.stringify({ received: true, handled_by: "portal" }), {
       status: 200,
       headers: { "Content-Type": "application/json", ...corsHeaders },
     });
   }
   ```

   No admin email is sent in this branch — the portal already handles confirmation + delivery + its own admin signal.

3. Leave the existing "Unrecognized product" branch untouched so genuinely unknown SKUs still page Marshall.

## Why this is the right shape

- Uses both `session.metadata.kind/product === "circle"` (the portal's checkout sets this) **and** an explicit Circle price-ID allowlist, so it's robust whether Stripe sends metadata, line items, or both.
- Keeps the marketing-site webhook authoritative for marketing-site products — only carves out Circle.
- New Circle price IDs in the future: add to `PORTAL_HANDLED_PRICE_IDS`. No other moving parts.

## Out of scope

- No changes in this portal project — its webhook already does the right thing.
- No changes to Kajabi, Resend, or `purchase_log` schema.
- No retroactive email cleanup; existing false-alarm notices stay in your inbox.

## Hand-off

Open [ALP Site](/projects/d5d995bb-85ad-4c1b-b601-a214c4a121a0) and paste the change request above. The edit is localized to `supabase/functions/stripe-webhook/index.ts` and a redeploy of that one edge function.
