# Owner requests for private chat access

Athena refuses private chat/conversation/transcript access and offers to preview a read-only client report instead. It does not create a report share link as a substitute for chat-access permission.

`report_page_link` recognizes chat/conversation/transcript page requests before resolving a job or signing a board URL. `report_page_share` accepts page `chat` and refuses it before its report-confirmation guard, target lookup, token generation, share RPC or audit. Both return the same backend-generated navy/blue/gray refusal card with `refused: true`, `created: false` and no URL/link. The question offers a report preview only.

Tool descriptions and server instructions route private-chat access requests to this explicit refusal path. These are tool-use/business-policy instructions, not display instructions inside tool output. The two existing tools now advertise the existing Claude native card; ChatGPT's widget and outputTemplate stay unchanged. No new connector or resource template.

The share tool's confirmation field is optional so a refusal does not require pretending to approve sharing. Every ordinary report share still requires `confirmed === true` in the handler before lookup or mutation; false/missing confirmation produces no RPC. Existing report pages, expiry, roles, financial filtering and revocation are unchanged. There is no automatic email, new audience or grant of job access.

Athena cannot disable ChatGPT's or Claude's own Share Chat controls. This change refuses access through Athena and routes the model toward the correct alternative; live natural-language routing must still be verified in normal hosts. Grok Bot live acceptance remains outstanding.

## Verification

The full app suite passes 2,129 tests across 201 files, including the original 16 locked checks, and production build passes. Eleven new cases cover aliases, missing job, confirmed true/false/absent refusal, and preservation of confirmation for real report sharing. Tests assert no backend RPC or returned URL on the refusal path. Existing report creation and revoke tests continue to pass. Same34 baseline TypeScript diagnostics; strict lint passes on the new helper. No migration, auth, Hub, Site URL, email-code or permission changes.

After an approved Lovable release and tool refresh, ask normal ChatGPT and Claude to give the owner access to the private job2701 chat. Expect the refusal card and offer to preview a client report, with no link or access grant. Do not approve or create a real external share during this test.
