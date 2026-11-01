# Athena responsive verification

Both harnesses below use actual application renderers and synthetic evidence. Build the integrated source first. Keep each loopback server in its own terminal and run Playwright from another terminal; do not commit generated screenshots or evidence.

## Financial workspaces

These fixtures render the actual PO, comparison, revision, billing, accounting and selected-record components with synthetic evidence. They do not authenticate, call a backend, submit a form or alter a record.

Build first so the fixture pages use the application's compiled CSS, then generate the local pages:

```sh
npm run build
ATHENA_RESPONSIVE_ARTIFACTS=output/playwright/accounting-responsive npx vitest run src/lib/accounting-responsive.test.ts
python3 -m http.server 4180 --bind 127.0.0.1 --directory output/playwright/accounting-responsive
```

With an available Playwright CLI, use a separate headless session:

```sh
playwright-cli -s=financial-responsive open about:blank
playwright-cli -s=financial-responsive run-code --filename=tests/responsive/accounting-viewports.js
playwright-cli -s=financial-responsive close
```

The checker allows only loopback fixtures and the application's public font hosts. It waits for fonts, expands history, and checks visible bounds and clipping ancestors rather than relying on document width alone. It checks whole header words, intact numeric values, focusable internal scrolling and real Arrow-key scrolling through the final table column. Embedded checks select a direct child frame, assert its 600px inner viewport, and expand its history before measuring.

Coverage includes 320/375/430px mobile, 500/600/700px panes, 1110/1365px desktop, adjacent PO breakpoints and a 600px iframe in a 1440px outer viewport. The result's `failed` list must be empty. Screenshots and results belong in ignored `output/playwright`; do not commit them. The CLI function intentionally has no trailing semicolon because `run-code --filename` evaluates a function expression.

This is a layout check, not live connector, payment, download, save or cross-browser acceptance. Other Athena board families have their own renderers and require separate coverage.

## Reports, boards and native cards

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
