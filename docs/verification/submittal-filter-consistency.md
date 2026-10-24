# Submittal filtered-view consistency

An empty filtered view must not say the job has no log. The full list and
filtered list continue to read the same saved rows and select the latest
revision of each submittal number before applying overdue/status/ball filters.

For a saved log with three current rows and no overdue work, the overdue view
says “No overdue submittals match this view. The full log contains 3 current
submittals.” It offers the full log or different filters, rather than directing
the member to create a new log. A genuinely empty job retains its setup prompt.

Local regression fixtures reproduce the dates read on job 2701 on October 24,
2026: two future review dates and one already returned submittal. A separate
fixture adds an overdue row and verifies the filtered rows equal the overdue
subset of the full current log, without creating production test records.

Validation: 2,327 tests across 220 files; all 17 locked behaviors; production
build; semantic ESLint. The inherited files have existing Prettier failures;
no broad formatting change is included. No migration, auth, Hub, email,
permission, drawing, payment or production-data changes.
