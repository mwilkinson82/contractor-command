# Can the managed migration record a function replacement without psql access?

This answer is based only on the tool's published description and what I've seen it do earlier in this project. Nothing was run, queried or changed.

## Short answer
Yes, in principle. The managed migration operation uses its own privileged session connection, so it does not depend on the agent's psql role. The `permission denied` on `drizzle.__drizzle_migrations` means the agent cannot read that history itself. It does not show that the operation would fail.

## What the operation does (from its description)
- Creates an empty Drizzle Kit custom migration and writes the submitted SQL into it verbatim.
- Runs `drizzle-kit check` on the migration set.
- Applies the migration with Drizzle's migrator over a privileged connection that the tool supplies. Drizzle records the history row in `drizzle.__drizzle_migrations`.
- Regenerates `src/integrations/supabase/types.ts`.
- If anything fails, it rolls back the migration file and the journal entry, so nothing is applied.

## Prerequisites and permissions
- The SQL must be DDL only and cannot contain `BEGIN;`/`COMMIT;`.
- Breaking changes are refused before they run: DROP or rename, type changes, or adding a NOT NULL column without a default.
- Destructive SQL waits for the user's yes or no. A `CREATE OR REPLACE FUNCTION` followed by `REVOKE` is not on that list, so it should apply straight away.
- `INSERT`/`UPDATE` on `storage.buckets` is refused.
- On a draft, the change is staged rather than applied.
- The "Execute backward incompatible database migrations" preference only matters for breaking changes.

## Receipt and evidence the operation provides
- On success, it returns the path of the applied migration file (`drizzle/migrations/NNNN_<name>.sql`).
- The repo gets the new `.sql` file, a `meta/NNNN_snapshot.json`, an updated `meta/_journal.json`, and the types refresh.
- The file content can be hashed against the reviewed SHA-256.

## What I can verify vs. don't know
I can verify:
- The submitted text and its hash.
- The generated file, journal and snapshot entries.
- The success or failure message the tool returns.

I don't know, and can't verify without read access:
- The database history row: its id, `created_at` and hash.
- Whether the migrator silently skipped the entry. Drizzle skips, without an error, any entry whose `when` is not greater than the newest applied `created_at`, and `drizzle-kit check` exits 0 anyway. This is the main gap.
- Whether the live function body changed. Earlier releases confirmed this with read queries, such as MD5 of the function definition. Without SELECT access to `pg_proc`, that confirmation isn't available.
- Whether the tool keeps or strips the final newline. Earlier runs did both.
- The tool does not return a structured receipt with a database transaction ID or history row.

## Recommendation (no action taken)
To get independent proof after applying, read access is needed for:
- `drizzle.__drizzle_migrations` (history count and newest row).
- `pg_proc` / `pg_get_functiondef` (function MD5 and ACL).

Without it, the evidence is limited to what the tool returns plus the files it generates in the repo.
