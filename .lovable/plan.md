
# One portal, six tiers

Everything lives in Contractor Circle. Access is controlled by a single `tier` per user, plus a per-replay `category` so each class only sees its own shelf.

## Tier model

```text
Rank  Tier         Who                                  Price
5     hardcore     ALP Hardcore (annual $16K)           comped/manual
4     circle       Contractor Circle                    $497/mo
3     intensive    6-Week Intensive                     $5K one-time
2     power_hour   Power Hour monthly                   $997/mo
2     sm_school    S&M School one-off                   one-off
1     book_buyer   Book / Power Hour book buyers        one-off
0     aos_only     AOS workspace only                   free/signup
```

`power_hour` and `sm_school` share a rank but unlock different replay shelves. Hardcore sits above Circle and inherits everything Circle has, plus its own daily-call surface.

## Access matrix

```text
Surface           aos book  ph   sm   intens circle hard
                  only buyr                              core
AOS workspace      yes yes  yes  yes  yes    yes    yes
Handbook            -  yes  yes  yes  yes    yes    yes
Vault               -   -   yes  yes  yes    yes    yes
Tools               -   -   yes  yes  yes    yes    yes
Field tools         -   -   yes  yes  yes    yes    yes
Discord community   -   -   yes  yes  yes    yes    yes
Replays: PH         -   -   yes   -   yes    yes    yes
Replays: S&M        -   -    -   yes  yes    yes    yes
Replays: Circle     -  yes   -    -   yes    yes    yes
Templates           -   -    -    -    -     yes    yes
Calls (Circle)      -   -    -    -    -     yes    yes
Ask Marshall        -   -   yes  yes  yes    yes    yes
Hardcore Calendar   -   -    -    -    -      -     yes
```

Calls page stays Circle/Hardcore only (Circle bi-weekly + monthly bootcamp). Hardcore's daily Power Hour / Contractor School / S&M School lives in a separate **Hardcore Calendar** surface (Google Calendar embed → Meet recordings on each event).

## Replays: two views, one library

- **Circle / Intensive / Power Hour / S&M / Book Buyer** see the existing curated library, filtered to shelves they're entitled to. Tabs: *Circle Calls*, *Power Hour*, *S&M School* — each user only sees the tabs they unlock.
- **Hardcore** sees those tabs PLUS a *Hardcore Calendar* tab embedding Marshall's Google Calendar; daily replays open in Google Meet via the event. No upload work for the daily classes.

Existing Zoom-hosted Circle replays stay on Zoom in the curated library. No Meet migration of Circle replays.

## What you have to confirm before I build

1. **Hardcore roster to add** (already comped: AJ Hoover, Andy Ramirez, Joaquin Lascano, Nathan Olivera, Ronnie Silva, Dan del Monte). Send the email list of the remaining Hardcore members and I'll comp them at `hardcore`.
2. **Stripe products → tier mapping** so the webhook auto-tiers future buyers:
   - Power Hour monthly ($997) → `power_hour`
   - S&M School one-off → `sm_school`
   - Book / Power Hour book → `book_buyer`
   - Circle ($497/mo) → `circle`
   - 6-Week Intensive ($5K) → `intensive`
   - Hardcore stays manual/comp.
   I'll need the Stripe `product_id` (or price_id) for each so the webhook switch is exact. The ones already in code: Book + Intensive + Circle. New ones I need from you: Power Hour monthly, S&M School.
3. **Google Calendar for Hardcore**: which Google account hosts the recurring Power Hour / Contractor School / S&M School events? I'll wire a read-only calendar embed under a Hardcore-gated route.

## Technical plan

**Database**
- Extend `app_tier` enum: add `hardcore`, `power_hour`, `sm_school`.
- Update `tier_rank()`: aos_only=0, book_buyer=1, power_hour=2, sm_school=2, intensive=3, circle=4, hardcore=5.
- Add `replays.category` enum (`circle_call`, `power_hour`, `sm_school`, `contractor_school`); backfill existing rows to `circle_call`.
- New RLS on `replays`: select allowed when published AND user's tier unlocks that category (helper SQL fn `can_read_replay_category`). Hardcore + Intensive see all categories; Circle sees circle+ph+sm; PH sees ph; SM sees sm; book_buyer sees circle (Marshall's existing decision).
- Open Vault/Tools/Templates/Community surfaces: add `has_tier_at_least(uid,'power_hour')` to Vault/Tools/Community/Ask; keep Templates + Calls at `circle`.

**Stripe webhook (`src/routes/api/public/stripe/webhook.ts`)**
- Extend product→tier switch with `power_hour` and `sm_school` cases.

**Tier gates (`src/routes/__root.tsx`)**
- Replace the single `CIRCLE_ONLY_PREFIXES` list with a `{prefix → minTier}` map. Surfaces re-gated per the access matrix above.

**Replays UI (`src/routes/replays.tsx`)**
- Add tabbed shelves driven by `category` + entitlement. Show only unlocked tabs.
- Add a `Hardcore Calendar` tab (Hardcore-only) with a Google Calendar `<iframe>` embed.

**Admin (`src/routes/admin.index.tsx`)**
- Tier dropdown gets `hardcore`, `power_hour`, `sm_school`. Comp form supports them.

**Membership backfill**
- After you send the Hardcore email list, one migration inserts comped `hardcore` subscriptions.

## What I'm NOT doing in this pass

- Not migrating Circle replays off Zoom.
- Not building a Google Meet recording sync. Hardcore uses calendar embed only.
- Not changing Discord access logic — community gate just widens; existing Discord invites stand.
- Not touching the Intensive / Book Buyer Stripe wiring beyond adding the two new product cases.

Reply with (1) Hardcore email list, (2) Power Hour + S&M Stripe product/price IDs, (3) Google Calendar account/ID, and I'll execute.
