# Payment application verification

All inputs are isolated fixtures. No browser harness connects to a backend, authenticates, or writes a production financial record. Database tests separately run the real SQL proposal and tool handlers in an isolated PGlite database under authenticated fixture roles.

Generate the actual saved React detail, incomplete state and exact-snapshot PDFs:

```sh
ATHENA_PAYMENT_APP_ARTIFACTS=output/playwright/payment-applications npx vitest run src/lib/payment-applications/render.test.ts
node scripts/build-payment-application-preview.mjs
python3 -m http.server 4182 --bind 127.0.0.1 --directory output/playwright/payment-applications
```

Use a separate headless Playwright CLI session:

```sh
playwright-cli -s=payment-apps-responsive open http://127.0.0.1:4182/saved.html
playwright-cli -s=payment-apps-responsive run-code --filename=tests/responsive/payment-application-viewports.js
playwright-cli -s=payment-apps-responsive run-code --filename=tests/responsive/payment-application-interaction.js
playwright-cli -s=payment-apps-responsive run-code --filename=tests/responsive/payment-application-certificate.js
playwright-cli -s=payment-apps-responsive run-code --filename=tests/responsive/payment-application-next.js
playwright-cli -s=payment-apps-responsive close
```

The `run-code` files are function expressions and intentionally have no trailing semicolon. The interaction harness substitutes only authentication and RPC transport at build time; it uses the actual editor, review, save/readback navigation and PDF download. Its in-browser records are disposable session fixtures, not a database/authorization test. It verifies no save before explicit confirmation and that incomplete values remain unknown; the certificate harness verifies read-only issued facts against a changed current SOV, unknown actual certificate amount, review/confirmation and exact saved version. Run the next-application harness after the certificate harness: it opens that saved certified detail, checks and cancels an unapplied recovered edit, prepares a new period with the saved predecessor/evidence, then verifies a new identity at version zero and unchanged first-record history. Predecessor reads are deliberately delayed to verify cancelled editor isolation, preservation of newer work inputs, and rapid clear/reselect ordering. The actual database suite covers the independent server checks, billing mapping, roles, source review, revisions and retry behavior.

Saved/incomplete detail and editor widths are 320, 375, 430, 500, 600, 700, 1110 and 1365px. The static checker verifies bounds, local Arrow-key horizontal scrolling and the last continuation column, plus a real 600px child frame in a 1440px parent. Render and inspect each generated PDF with Poppler or the available PDF renderer. Keep screenshots, bundles, downloaded PDFs and logs private under `output/playwright`.

These checks do not establish live connector selection, managed migration installation, email-code delivery, real-user confirmation, cross-browser behavior or production acceptance. Complete those through the authorized release lane after independent review.

For the contract-basis regression, build the same preview, serve it on loopback port 4183, and run `payment-application-contract-basis.js` in a separate CLI session. It starts with no canonical contract amount, checks 320/375/600/1110px bounds, cancellation and stale review, then verifies interrupted-save recovery and that the actual application editor becomes available. It confirms no application save or invoice was made. The private screenshots are `contract-review-1110.png` and `contract-saved-375.png`. The SQL proposal remains a separate reviewed Lovable Cloud installation step.
