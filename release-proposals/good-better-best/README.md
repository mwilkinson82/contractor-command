# Good, Better, Best: database parts for Lovable

Not applied. Paste each file into Lovable's migration tool as SQL text, in order,
once the feature PR is approved. Every part is safe to rerun.

1. `01-tables.sql`: private board, board history and customer share tables.
2. `02-validation.sql`: board validation (mirrors `src/lib/selections/model.ts`).
3. `03-board-functions.sql`: read and save a board (estimating access).
4. `04-customer-view.sql`: builds the customer view from whitelisted fields only.
5. `05-choice-and-sharing.sql`: record the customer's choice and make, open or
   turn off a customer link (full job access only).

What it touches: only the new `mcp_private` tables above. It does not alter any
existing table or function, and it does not change contracts, budgets, SOVs,
billing, accounting or the estimate.

This replaces the unapplied prototype `release-proposals/residential-selections.sql`.
Tests: `src/lib/selections/storage.test.ts` and
`src/lib/mcp/selection-proposal-e2e.test.ts` run all five parts (twice, to prove
rerunnability) on a local Postgres.
