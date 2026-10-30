# Support dashboard candidate

Proposed bookmark after deployment: https://app.meetathena.io/admin/support
Ticket link: /admin/support?ticket=<UUID>. New owner notices include this fixed-origin link in plain text and HTML. Existing frozen notices are intentionally not rewritten or resent.

Permissions: authenticated server functions plus authoritative user_roles admin check on each list, detail, attachment-list and download request. Errors fail closed. Existing service-role access only; no public table grants or new credentials. All admins see both brands, consistent with existing admin support scope. Account ownership alone does not grant this role.

Account worker contract: Link to /admin/support with search={{ticket:undefined}}, visible only when useIsAdmin()===true. The account.tsx change is only this link and its imports/hook; relocate it freely in the separate account redesign. Admin home has the same link. Dashboard/components own all functionality; no account layout/branding redesign here.

Features: 50-ticket pages with status and last received-message timestamp (creation-date ordering); 50-message chronological pages per ticket; full stored evidence as escaped text/JSON, explicit legacy/unknown/review states; independent automatic-receipt and owner-notice delivery states. No HTML execution. Explicitly requested attachment listings/downloads use existing frozen owner copies only, bounded content and inert .bin filenames. Original attachment manifest remains visible; files omitted upstream are unavailable here. No arbitrary URL fetch. No duplicated ticket storage.

Review-only boundary: draft editor + review preview on the current page. No send action, outbox enqueue, status write or persistent draft storage. Draft is lost on navigation/reload. Existing manually authenticated reply function remains unchanged and preview-only; automatic receipt gates remain default off. Full approve-to-send semantics/audit/persistent drafts are NOT implemented or implied.

Schema: zero additional migration. Requires existing candidate support_messages/support_deliveries migration. Until applied, conversation loading reports unavailable/migration required. Original support_tickets used for list/status; no guessed live rows.

Identity privacy: reactive auth gate remounts admin check per user; cache keys are identity-scoped, removed on view unmount with gcTime0; pending downloads/list responses do not act after unmount. Independent reviewer found original stale-cache issue, now resolved, with no further security blocker. UI link visibility is not relied upon for authorization.

Validation: focused server authorization, identity query scoping, attachment isolation/bounds/inert names, support processing and owner link tests, account-team regression tests. Typecheck and build logs tracked separately. No authenticated browser/production email/database verification performed. Source and accounting business logic untouched outside separate account nav hook/link and generated route registration. No external agent requests/live deployment/migration/export/mail.