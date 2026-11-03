# PM agent role tests (TEST only)

Runs the real `/mcp` handler (OAuth check with `requireOAuthClientClaim` on) and the real tools in-process,
against an in-memory Postgres (PGlite) loaded with `drizzle/migrations`. A TEST company and TEST users on a
reserved `.invalid` domain only; nothing talks to the live backend or sends email.

    npx vitest run -c tests/mcp-roles/vitest.config.ts

Use the already installed dependencies. The default `destination` fixture adds
the exact company `time_zone` column from migration 0026, current document-reader
columns/spec table with its actual scope policy, the exact `contract_completion_date`
column from the existing living-reports migration, the real billing/SOV guard
prerequisites, and the unapplied estimating destination-version proposal
to an in-memory database. It represents the proposed coordinated schema, not
the live database. Empty change-order source tables expose only the columns
needed by that proposal and deny direct member access; execution of actual
change orders has separate full-chain tests. The fixture asserts that existing
job/company/member/fact grants, RLS policies and `mcp_job_scope` are unchanged.

To reproduce the historical timezone-only comparison:

    ATHENA_ROLE_SCHEMA=legacy npx vitest run -c tests/mcp-roles/vitest.config.ts

This older schema intentionally cannot accept current versioned budget/SOV
writes. Do not count tests stopped at setup as passing or use that profile as
the proposed-schema regression result. The shared `makeDb` fixture remains at
migration 0024; other feature suites still install their own prerequisites.

The allowlist module is swapped for TEST emails inside this test process only; production code has no bypass.
Kept out of the default `vitest run` so the app's dependencies don't change.
Existing role assertions are retained even when wording or legacy behavior
fails. Compare individual results with an isolated baseline using the identical
fixture, proposal bytes, configuration and installed dependency tree.
