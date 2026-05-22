# AOS Add-Capacity Deep Link

The external AOS app (subdomain) doesn't have access to the portal's Stripe.
When an AOS user wants to add a seat or workspace, link them to the portal:

```
https://app.alpcontractorcircle.com/aos/add-capacity?kind=seat&return_to=<encoded AOS url>
https://app.alpcontractorcircle.com/aos/add-capacity?kind=workspace&return_to=<encoded AOS url>
```

## Behavior

- Opens in the same tab. User is already SSO-linked to the portal.
- Auto-opens the "Add capacity" modal (seats + workspaces steppers).
- On Stripe checkout success, the portal webhook updates `aos_addons`, then
  Stripe redirects the user back to `return_to`.
- `return_to` must be an `https://` URL on `*.alpcontractorcircle.com`
  (enforced by `src/lib/return-to.ts`). Invalid URLs are silently dropped
  and the user lands on `/aos`.

## Params

| param       | values              | notes                                          |
|-------------|---------------------|------------------------------------------------|
| `kind`      | `seat` \| `workspace` | Hints which row to pre-emphasize (cosmetic).  |
| `return_to` | absolute https url  | Subdomain allowlisted; persisted in session.  |

## AOS app wiring (example)

```ts
const portal = "https://app.alpcontractorcircle.com";
const returnTo = encodeURIComponent(window.location.href);
window.location.href = `${portal}/aos/add-capacity?kind=seat&return_to=${returnTo}`;
```

No backend changes are required on the AOS side — the portal owns Stripe,
the webhook, and the `aos_addons` table that `get_user_aos_limits` reads from.
