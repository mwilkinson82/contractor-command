# Athena responsive coverage

Scope is the Athena host's board, report, detail and account entry surfaces. Every rendered fixture is synthetic. `athena-routes.ts` redirects Circle Hub/scheduler routes to `/account` on the Athena host, so those are outside this inventory. API-only drawing transport and file/PDF download responses have no application HTML layout.

The viewport scripts test 320/375/430px mobile, 500/600/700px panes, 1110/1365px desktop and selected adjacent breakpoints. Actual 600px child frames are also measured inside a 1440px host. They do not treat root overflow suppression as a passing fit.

| Layout family | Actual renderer/fixture coverage | Limits |
| --- | --- | --- |
| Project overview | `JobHome`, long project/company references and expanded disclosures | Query functions never run |
| Purchase orders | Current/history in the separate financial responsive fixture suite (PR374) | No save/issue operation |
| Suppliers and buyout | Supplier/terms views in PR374; actual `PurchaseOrderBuyout` here with large amounts | No commitment/payment changes |
| PO revision/comparison | Actual revision editor and comparison in PR374 | No edit submission |
| Accounting report modes | All five modes in PR374 | Synthetic source ledger |
| Exact financial record | Shared `AccountingRecordView` with long facts, history, originals and related links in PR374 | Invoice-shaped read; the shared presenter has no record-kind branches. Backend kind/version acceptance is separate |
| Billing evidence | Expanded version/history in PR374 | Original downloads not exercised |
| Production | Actual `ProductionReportPage`, source references, quantities and rates | Synthetic saved daily data |
| Daily review/capture | Actual `DailyReportReview` and `DailyReportCapture` | Initial review/capture states; save/correction confirmation is not clicked |
| IOR | Generated full-scope tables, complete amounts and metrics | Current and standalone/shared rendering |
| CPM/schedule | Actual fixed-width calendar/table and horizontal panning | Fixture uses a long-named activity; WBS grouping and calculation semantics remain covered by existing domain tests |
| Lookahead and pay app | Calendar, priorities, monthly billing, full values | No schedule/billing mutation |
| Portfolio | Actual generated job grid, long titles and complete contract values | Synthetic single-company view |
| Field/items/briefing/photos | All four generated bodies, long references and a local synthetic image | No field submission |
| Submittal/request/change logs | Generated submittal log; actual RFI/RFC/change-log components and filters | Filters initially show all records |
| Submittal/request/change detail | Actual `renderSubmittalRecordBody` for approval, RFI, RFC and change order, evidence/history | No build/send/approval |
| Today/morning brief | Actual `TodayBriefView`, push bar and `buildMorningBrief` card renderer | No notification permission or subscription |
| Shared/token reports | Same generated standalone document renderer; explicit shared IOR and unavailable state | PDF/submittal-preview responses stream files rather than rendering application HTML |
| Upload/download entry | Actual `uploadPage` initial/received and unavailable file-link page | No file transfer or capability redemption |
| Native assistant cards | Generic stacked/wide tables; initialized file picker/recovery, drawing preview and takeoff selection/sheet | Synthetic host delivers only result and selected-upload resume read. Local drawing zoom/pan is exercised; no measurement or file write |
| Account and access | Account overview, actual organization/team editors, saved-project links, board sign-in, login/code, magic link, consent, forgot-password, reset/callback initial states | Billing-question dialog, team-edit/removal confirmation and post-sign-in states are not certified by static fixtures |
| Support | Actual administrator list/detail renderer with long subject/evidence and expanded delivery details | Synthetic admin hook; no live support read, attachment download or sending |

These are layout checks in Chromium, not a claim of live business-workflow or cross-browser acceptance. Dialog states called out above still need interactive acceptance. Existing access checks and mutation code are unchanged.
