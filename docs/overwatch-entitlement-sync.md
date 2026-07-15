# OverWatch included access

Contractor Circle billing stays in the Circle Stripe account. The Hub remains
the membership authority; OverWatch Pro billing stays in the separate
OverWatch Stripe account.

The signed lookup endpoint is:

```text
POST /api/public/overwatch/tier-lookup
```

It accepts a normalized member email plus a timestamp and nonce, verifies an
HMAC signature, and returns whether the current Hub tier is eligible for
included OverWatch Pro access. Only `circle` and `hardcore` qualify.

Set the same high-entropy server-only secret in the Hub and OverWatch Lovable
projects:

```text
CONTRACTOR_CIRCLE_SHARED_SECRET
```

Never expose this value through a `VITE_` variable or paste it into client
code. Requests use the `x-overwatch-signature` header with the hexadecimal
HMAC-SHA256 of:

```text
{email}|{unix_timestamp}|{nonce}
```

The endpoint rejects timestamps more than 60 seconds from the server clock and
returns `Cache-Control: no-store`. It resolves membership through the existing
Hub subscription authority, including comped and Hardcore records.
