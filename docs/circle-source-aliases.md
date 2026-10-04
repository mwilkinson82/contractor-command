# Reviewed Circle source aliases

This follow-up to the payment-evidence correction supports explicitly approved Hub accounts that share one recurring paid Circle source. A mapping is not a comp or independent grant. It cannot outlive the source's verified paid period and cannot bypass a refund, dispute, missing evidence, source supersession, or identity review.

## Exact scope

The empty migration adds service-only `circle_source_aliases` and append-only `circle_source_alias_history` tables. It changes the canonical source lookup and adds dependent outbox triggers. It contains no member identities or backfill. With no alias rows, existing tier/access/AOS decisions remain unchanged.

Each mapping pins the source row, Stripe subscription/customer IDs, original Hub user/email, target Hub user/profile email, and verified billing email. It records the approving admin, reason, optional expiry, and revocation. Changed source bindings or target profile email invalidate the mapping. Members cannot read or write it; the service role cannot delete mappings or update history.

`set_circle_source_alias` validates the exact reviewed source snapshot and existing target profile, requires an admin actor and reason, and supports idempotent approval/revocation. The admin-only `setCircleSourceAlias` server function additionally requires the explicit confirmation string `apply-reviewed-circle-source-alias`. Neither function creates a paid period or owner grant. No automatic importer or member-facing alias form is included.

The canonical database decision allows an exact active mapping to follow the same `subscription_state` as the source. It never transfers the source owner's preserved legacy review access or independent owner grant. The alias account can still qualify through its own separate paid source or grant. An explicit mapping can therefore support two reviewed Hub profiles while arbitrary cross-user email matching remains on review.

## Billing and audience behavior

For a known billing-vs-Hub email difference, the Stripe webhook checks `circle_billing_identity_approved`. Approval must match the existing source account, Stripe subscription/customer, Hub email, and current billing email exactly. A mapping for a secondary account cannot rebind the original source. Unexpected differences still become `stripe_identity_mismatch`; lookup failures remain retryable. Charge refund/dispute verification and backing-invoice provenance remain required.

Canonical audience loading includes the explicitly recorded destinations separately. Retired destinations remain discoverable for removal reconciliation. A changed/deleted target profile becomes an explicit identity review case, so stale addresses cannot inherit access from a different current address. Marketing suppression and unsubscribe checks apply independently to each destination.

Source status, payment evidence, legacy review resolution and profile changes queue affected alias destinations. Alias approval/revocation is audited and queued. The existing expiry sweep also includes recorded alias destinations, including retired ones. No new schedule, credential or sender is added; the Hub announcement template and sender are unchanged.

## Private mapping and release review

1. Review this PR and exact migration hash separately from the refund correction. Rehearse against the existing schema and run hosted security advisors through Lovable.
2. Apply the empty migration through Lovable, record migration history version `20261004201435`, and compare every existing profile's tier/access/AOS limits before and after. Expect no changes and zero alias rows.
3. Publish the matching reviewed application commit. Publishing the application first would reference the missing alias table/RPC.
4. Review the exact private mapping matrix: source row and expected Stripe IDs, original source account, target profile/email, verified billing address, owner approval evidence, approved lifetime, and backing paid invoice reference. Known billing differences need an explicit primary-account mapping; an additional destination is a separate mapping. No inferred matching by name or domain is permitted.
5. Resolve any old duplicate legacy source in that same private review. A new alias does not erase an independent legacy review hold. Mark a duplicate superseded only when it represents the same paid source and has no independent grant. Preserve independently confirmed grants and other product purchases.
6. Apply only those exact approved rows and source/evidence resolutions, then verify each paid/alias/grant result and the complete audience diff. Keep unknown identities on review. No send is authorized by a mapping import or deployment.

Rollback or removal must preserve mapping/audit evidence and use explicit revocation. Revocation is allowed even after a source binding changes; it cannot create replacement access. Do not restore permissive cross-user email matching or create perpetual comps as a shortcut.

## Tests

Synthetic PostgreSQL tests execute both actual migrations and cover both approved accounts, expiry, cancellation, refunds/disputes, supersession, independent access, exact billing approval, retargeting, revocation history, outbox fan-out and role permissions. Provider tests cover approved renewals, blocked cross-user rebinding, failed approval lookups and per-address suppression. No test mutates real accounts or sends mail.
