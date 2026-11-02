# Estimating pricing correctness — first slice

Base: `d57f7ec615574d45e860f0a4886fd4b330ac6b6e`. This is a source change for review, not a deployment or complete estimating acceptance claim.

## Result

The pricing walkthrough and final bid summary now consume `calculateEstimatePricing`. Each active takeoff line produces the same labor/material amounts, applied factors, confirmation flags, and missing-input blockers in both reports. Quote comparison also uses those computed component amounts.

- Missing components and incomplete production/rates hold final readiness and withhold the bid total. Known direct amounts remain visible. An explicitly confirmed zero component price remains valid. The existing model has no component N/A field; a missing component is never interpreted as N/A or zero.
- Labor and material factors apply only when requested. An explicit source must match a single carried choice; absent/duplicate/ambiguous choices or missing factor numbers remain unresolved. A valid unconfirmed factor can be displayed but holds readiness. No licensed prices or factors are supplied by the application.
- Unique legacy title references resolve consistently and migrate to stable refs when pricing is saved. Ambiguous titles, duplicate rates, and orphan references hold readiness. An explicit update can resolve conflicting old rows without inheriting arbitrary partial fields from one of them. Dropped scope retains historical rates without carrying their cost.
- Raw saved inputs remain raw. Failed saves return errors; a retry recomputes from current inputs, avoiding repeated factor multiplication. Current accepted measurement quantities override historical typed corrections. A stale source prevents the measured final-bid path from returning readiness or saving new markup percentages.
- Supervision accepts an explicit lump sum, including zero, without requiring a redundant unit rate or schedule duration. Quantity × rate supervision remains supported.
- Subcontract quotes remain visible individually for comparison. The current schema has no carried/additive/replacement/split selection, so **any saved quote holds the bid total** until that coverage workflow exists. The implementation neither sums competing quotes nor selects a vendor. This intentionally also holds apparently additive or single quotes; their non-overlapping coverage is not represented yet.

Sequential cent rounding in the underlying labor/factor/markup functions is preserved. A 100-unit line at 10 units/man-hour × $100/hour, plus $5/unit material, with confirmed 1.2 location and 1.1 work factors applied to labor, carries $1,820 direct and $2,202.20 after 10% overhead followed by 10% profit. Without factors it carries $1,500 direct and $1,815 total.

## Verification

- Before implementation: the nine initial handler correctness cases had **one passing control and eight failures**. Historical observed-bad diagnostics are archived under `tests/estimating-audit/` outside normal test discovery.
- Final full application suite: **3,690 passed, 4 pre-existing skipped, 0 failed, 371 files**. This includes **54 focused pricing/bid tests** and all **25 locked-behavior checks**. The initial sandboxed run had one Workers drawing failure from `listen EPERM` on `127.0.0.1`; the unchanged baseline failed identically. That test passed when local loopback was allowed, then the full suite passed with the same access.
- TypeScript: `tsc --noEmit --pretty false` exits 0 on both unchanged base and candidate using the same dependencies. Changed runtime/test files pass ESLint and Prettier checks. Production build passes.
- Separate legacy role harness is **not green**. Its checked-in config fails import in 11 files on a `.wasm` extension, identically on base and candidate. A temporary config using the application's existing PDFium/WASM aliases gets to setup, but both base and candidate fail the same `beforeAll` setup assertions; all **171 tests remain skipped/not executed**. No authorization or membership behavior was relaxed to make those tests pass. The full application suite still exercises its own guarded database and authorization tests.
- Reproduction checks cover missing/zero prices, labor and material factors, explicit/missing/ambiguous sources, unconfirmed inputs, cent rounding, title collisions, stale refs, dropped scope, invalid/nonfinite inputs, interrupted saves, interrupted responses after persistence, retries, quote-basis consistency, accepted measurements, and stale measurement sources.

Commands:

```sh
npx vitest run src/lib/mcp/estimating-pricing.test.ts src/lib/mcp/estimating-pricing-audit.test.ts src/lib/mcp/estimating-bid.test.ts
npx vitest run
npx tsc --noEmit --pretty false
npx eslint src/lib/mcp/estimating-pricing.ts src/lib/mcp/estimating-pricing.test.ts src/lib/mcp/estimating-pricing-audit.test.ts src/lib/mcp/estimating-bid.ts src/lib/mcp/estimating-bid.test.ts src/lib/mcp/tools/estimate-bid-tools.ts
npm run build
```

The isolated environment reuses a copied local dependency install. Vite was corrected from installed 7.3.2 to locked 7.3.3 using the cached package tarball without changing tracked manifests. A wider audit found a pre-existing package/lockfile discrepancy: ten root dependency specifications differ or are absent, including exact TanStack and Lovable build-config versions. An isolated offline `npm ci --dry-run --ignore-scripts` also stops at `ENOTCACHED` for `@ai-sdk/openai`. Consequently these checks are **not a clean-lockfile installation certification**. Dependency/lock reconciliation and a fresh install belong in the release verification gate; this change does not churn unrelated dependency files.

## Boundary and follow-on work

No migration, permission, membership, authentication, accounting, or live data change is included. The draft contains only estimating runtime code, isolated tests, and technical evidence.

`estimate_build` remains the existing separate quantity × explicitly supplied unit-rate PDF path; takeoff CSV/XLSX remain quantity exports. This slice does not turn them into canonical monetary bid exports. Immutable bid snapshots, explicit quote coverage and alternates, monetary export reconciliation, exact-version budget/SOV/buyout handoff, real-original drawing accuracy, and normal-host acceptance remain follow-on work. Stored rate inputs do not yet carry an immutable reviewed takeoff-version fingerprint; current inputs are recalculated on each call, rather than freezing approval of an old result.

Next quote slice: preserve all comparison quotes, bind scope packages to exact lines/trades/components and source versions, require estimator-selected additive/replacement/split coverage, prove every included component is carried once, and keep base/alternate scenarios separate. Never infer coverage from quote descriptions or choose the lowest vendor automatically. Publish only after the exact candidate and any later schema proposal receive release review.
