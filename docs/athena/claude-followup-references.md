# Claude follow-up references

The #237 live QA test created exactly one approved item on job2701. ChatGPT found its ref and returned a still-open closure review. Claude rendered the full open-items card, but its model could not read the item ID/ref from structuredContent and did not call resolve_item. Independent read-only MCP verification found the exact stored item/ref and confirmed it remained open. This is a live Claude handoff failure, not a failed card renderer or database closure.

After the existing Claude text pass, include factual follow-up data in its first text block for two tools only:

- list_open_items: each item_ref and title already present in structuredContent;
- resolve_item: the current item ref, confirmation key and closed state, only when a review key actually exists.

The data is fenced JSON, not display orders or instructions. Every existing row remains; the original structuredContent/card/HTML, images and metadata stay unchanged. ChatGPT's result remains the exact original object. Other tools/hosts are unchanged. A second presentation pass does not duplicate the data. Failed calls and missing review keys do not invent facts.

The confirmation key is the existing workflow commitment, not an access token; Claude needs it as an input for the member's later yes. Nothing is closed or shared by this presentation change. No new schema, tool, renderer, resource identity, auth, permission, migration, email or connector.

Verification: 2,122 app tests across201files and production build pass. Four new transport cases cover readable refs, readable review key, ChatGPT identity preservation, complete data/card/image preservation, repeated passes, errors and missing evidence. Strict lint passes on the changed text pass; legacy formatting findings are not rewritten. Same34 baseline TypeScript diagnostics, no additions. Existing lookahead counts/rows and locked16 tests pass.

After exact approved publication, refresh existing tools and rerun the natural-language Claude test in a fresh normal chat: locate the already-approved QA-237 item without being given its ref, preview with confirmed false, verify no closure, then close only that item with the approved fictional evidence. Do not create another QA item. Finish the ChatGPT comparison and check the other30 existing open items are unchanged. Grok Bot live acceptance remains outstanding.
