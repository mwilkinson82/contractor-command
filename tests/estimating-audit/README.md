# Pricing audit diagnostics

`estimating-pricing-baseline.test.ts` preserves the original nine diagnostic characterizations of commit `d57f7ec615574d45e860f0a4886fd4b330ac6b6e`. It deliberately asserts observed defects. It is outside the application's `src/**/*.test.ts` discovery and must not be treated as a correctness specification.

To reproduce those historical observations, use an isolated checkout of that exact commit and copy this file to `src/lib/mcp/estimating-pricing-baseline.test.ts` in the baseline checkout before running Vitest there. Its relative imports intentionally assume that original location. Do not run it against the fixed source.

Current correctness regressions are `src/lib/mcp/estimating-pricing-audit.test.ts` (real pricing handlers with an isolated persistence boundary and real measurement-state calculations) and `src/lib/mcp/estimating-pricing.test.ts` (pure pricing cases). Before the implementation, the initial nine correctness cases produced one passing control and eight failures. All of these fixtures remain internal to tests; they do not create jobs, call providers, or change live financial records.
