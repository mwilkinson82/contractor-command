# Review an item before closing it

The reported N3 failure was a closure request that skipped the selected-item review and claimed an action that had not happened. `resolve_item` now returns a review card before a closure write. The card identifies one selected item by ref, title, owner and due date, shows the exact proposed evidence/statement/waiver/commercial records, and asks yes or no. The item remains open.

After the member's separate yes, the host repeats that proposal with `confirmed: true` and the returned `confirmation_key`. The key commits to the actor, job, item snapshot and resolution fields. Missing, false or mismatched confirmation returns a fresh review without calling the mutation. Missing evidence, statement date, waiver reason or any of the three commercial records returns a question with no key. Changed saved details or proposal invalidate the earlier review.

This is a workflow commitment, not an authentication credential or independent proof of a human utterance: the host must honor the separate-yes contract. Snapshot comparison happens before the existing RPC, not in a new atomic database transaction. The existing database function still enforces active membership, job access, decision rights, evidence and open status, and preserves evidence/history. Status updates remain open, and N/A remains a refusal. No schema or permission changes.

`list_open_items` adds `item_ref` beside its existing item ID in structured data; the existing list card stays unchanged. `resolve_item` uses the existing native card in Claude and existing ChatGPT widget. Preview and final acknowledgments are backend-generated cards. Only the database's actual `closed` result controls the final closure acknowledgment. No optimism or "submitted for closure" wording.

## Verification

- 2,118 tests across 201 files pass, including the original 16 locked behavior tests. Production build passes.
- 18 new helper/database tests cover exact preview contents, no mutation without matching confirmation, changed actor/job/item/proposal, real saved evidence/history, stale replay, denied access, missing records, member statements, waivers, commercial closure, update and N/A behavior. Database tests load the current closure migration into local PGlite with scoped authenticated clients and fictional example.com people.
- Strict lint passes for new files; changed legacy files retain their existing formatting findings and one pre-existing unused-expression error in the SOV mapper (verified against the unchanged base); no new lint errors. The same 34 baseline TypeScript diagnostics remain, with no additions.
- Legacy role suite comparison against the exact #236 base: both have113 pass/57 fail, with identical failing test names and no new failures. Two old immediate-close assertions now explicitly preview and confirm. This suite is not green.
- Private390px browser preview has no horizontal page overflow.
- No production items have been closed during development. After an approved Lovable release, verify normal ChatGPT and Claude preview/refusal flows on job2701 without closing existing items; use a separately authorized disposable QA item for the affirmative close test. Grok Bot live acceptance is still outstanding.

This candidate is separate from drawing-card releases #235/#236. No sign-in, Hub, Site URL, email code, connector, migration, email or sharing changes.
