# Circle welcome + magic-link (admin ops)

Member welcome is the **Lovable hub mailer** (`notify.mail.alpcontractorcircle.com`, template `circle-welcome`). Never Resend. Resend Custom/Ad-Hoc alerts to `marshall@` are internal only.

Do **not** ask an agent to email a member. Use the hub admin tools below.

## Recognition

Circle monthly is recognized from any of:

| Kind | Live ID |
| --- | --- |
| Price | `price_1TVh3TJdDAUSVXbNJRsYFTbp` |
| Product | `prod_UUgQlHRk9H1ZUS` |
| Payment Link | `plink_1ThaqAJdDAUSVXbN66bTiP9o` |
| Checkout metadata | `kind` / `product` = `circle` |

Payment Link checkouts often have no `kind=circle` metadata. The hub webhook reads `session.payment_link` plus the subscription price/product. The marketing-site (ALP Site) Stripe webhook must short-circuit these IDs so it does **not** treat them as Custom/unknown and does **not** send a Resend customer welcome.

`subscriptions.welcome_sent_at` is stamped only after `circle-welcome` status=`sent` in `email_send_log`. Enqueue is not delivery.

## Re-send magic link (no welcome email)

1. Open **Admin → People** (`/admin/people`).
2. Find the member.
3. **Copy sign-in link** — mints a one-time hub magic link. Hand-deliver via text/DM. This does not send email.
4. **Email sign-in link** — sends the branded hub `magic-link` template immediately (`notify.mail.alpcontractorcircle.com`). Use this when they need the link in inbox.

There is also a mint-by-email box at the bottom of People for addresses that are not in the table.

## Re-send Circle welcome (hub mailer only)

`sendCircleWelcomeBackfill` is the admin server function (`src/lib/email/circle-welcome.functions.ts`). It generates a fresh magic link and enqueues `circle-welcome` through the hub mailer.

Default idempotency key: `circle-welcome-backfill-{email}`. If that key already has a pending/sent log, the call returns `duplicate` and does **not** send again.

To force a new send after a bounce or a broken first mail:

1. Confirm you intend to email that member (not Dalton unless Marshall asked).
2. Call `sendCircleWelcomeBackfill` as an admin with a **new** `idempotencyKey`, e.g. `circle-welcome-admin-{email}-{YYYYMMDD}`.
3. Drain / wait for the transactional email queue. A successful send stamps `subscriptions.welcome_sent_at` if it is still null.

Do not use Resend, ALP Site welcome, or Kajabi for Circle members.

## Inspect without sending

```sql
select email, tier, status, price_id, product_id, welcome_sent_at, stripe_subscription_id
from subscriptions
where email ilike 'member@example.com';

select created_at, template_name, status, recipient_email, metadata
from email_send_log
where template_name = 'circle-welcome'
  and recipient_email ilike 'member@example.com'
order by created_at desc;
```

If `email_send_log` already has `status=sent` and `welcome_sent_at` is null, the next Stripe subscription event backfills the stamp. You can also set it by hand after confirming the sent log:

```sql
update subscriptions
set welcome_sent_at = now()
where stripe_subscription_id = 'sub_...'
  and welcome_sent_at is null;
```
