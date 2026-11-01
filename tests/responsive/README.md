# Responsive reports and boards

The two fixture suites render production components and HTML renderers with synthetic evidence. They never authenticate, run query functions, submit forms or call a backend. The card fixtures use a minimal local host that delivers initialization and a synthetic result only.

Build for the current compiled application CSS, generate fixtures, and serve only their directory:

```sh
npm run build
ATHENA_RESPONSIVE_ARTIFACTS=output/playwright/reports-responsive npx vitest run src/lib/report-responsive.test.ts src/lib/board-responsive.test.ts
python3 -m http.server 4181 --bind 127.0.0.1 --directory output/playwright/reports-responsive
playwright-cli -s=responsive-boards open about:blank
playwright-cli -s=responsive-boards run-code --filename=tests/responsive/report-viewports.js
playwright-cli -s=responsive-boards run-code --filename=tests/responsive/board-viewports.js
playwright-cli -s=responsive-boards close
```

The checkers wait for fonts and rendering, expand history, inspect visible descendant bounds and clipping ancestors, check header words and financial number integrity, and verify local table scrolling. They assert the actual child frame's 600px viewport in a 1440px split-pane host. Root `overflow-x:hidden` is not accepted as evidence of a fitting layout. Decorative `aria-hidden` artwork and deliberate internal schedule/table/canvas scrolling are excluded from essential-content clipping checks. Interactive controls remain checked even inside `aria-hidden` ancestors. Script errors fail acceptance.

Widths: 320, 375, 430, 500, 600, 700, 1110 and 1365px, with adjacent project/schedule breakpoints. Screenshots and structured results stay private in `output/playwright`. The function-expression files intentionally have no final semicolon because of CLI evaluation.

These checks cover layout of supplied read states. They do not establish live connector behavior, permissions, financial changes, sign-in delivery, uploads, downloads, drawing measurement accuracy, every dialog state, or cross-browser acceptance. Query functions and mutation callbacks must remain uncalled.

See [COVERAGE.md](COVERAGE.md) for the 22-family inventory, the separate financial fixture coverage and explicit unmeasured states.
