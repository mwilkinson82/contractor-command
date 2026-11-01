# Responsive financial workspaces

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

The checker allows only loopback fixtures and the application's public font hosts. It waits for fonts, expands history, and checks visible bounds and clipping ancestors rather than relying on document width alone. It checks whole header words, intact numeric values, focusable internal scrolling and access to the final table column.

Coverage includes 320/375/430px mobile, 500/600/700px panes, 1110/1365px desktop, adjacent PO breakpoints and a 600px iframe in a 1440px outer viewport. The result's `failed` list must be empty. Screenshots and results belong in ignored `output/playwright`; do not commit them. The CLI function intentionally has no trailing semicolon because `run-code --filename` evaluates a function expression.

This is a layout check, not live connector, payment, download, save or cross-browser acceptance. Other Athena board families have their own renderers and require separate coverage.
