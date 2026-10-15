# PM agent role tests (TEST only)

Runs the real `/mcp` handler (OAuth check with `requireOAuthClientClaim` on) and the real tools in-process,
against an in-memory Postgres (PGlite) loaded with `drizzle/migrations`. A TEST company and TEST users on a
reserved `.invalid` domain only; nothing talks to the live backend or sends email.

    npm i --no-save @electric-sql/pglite@0.3
    npx vitest run -c tests/mcp-roles/vitest.config.ts

The allowlist module is swapped for TEST emails inside this test process only; production code has no bypass.
Kept out of the default `vitest run` so the app's dependencies don't change.
