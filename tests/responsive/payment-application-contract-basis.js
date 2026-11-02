async (page) => {
  const root = "output/playwright/payment-applications";
  const fixtureHTML = await (
    await page.request.get("http://127.0.0.1:4183/interactive.html")
  ).text();
  await page
    .context()
    .route("http://127.0.0.1:4183/r/job/**", (r) =>
      r.fulfill({ body: fixtureHTML, contentType: "text/html" }),
    );
  await page.goto("http://127.0.0.1:4183/interactive.html?contract_missing=1");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const prepare = page.getByRole("button", { name: "Prepare a new application", exact: true });
  if (await prepare.isEnabled()) throw Error("Missing contract incorrectly allowed an application");
  await page.getByRole("button", { name: "Review contract basis", exact: true }).click();
  await page.getByLabel("Original contract amount (USD)", { exact: true }).fill("100000");
  await page
    .getByLabel("Basis or source reference", { exact: true })
    .fill("Owner-provided original contract amount");
  const widths = [];
  for (const width of [320, 375, 600, 1110]) {
    await page.setViewportSize({ width, height: 950 });
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll("input,textarea,button")].some((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.left < 0 || r.right > innerWidth);
      }),
    );
    if (clipped) throw Error("Contract controls clipped at " + width);
    widths.push(width);
  }
  await page.evaluate(() => sessionStorage.setItem("fixture-contract-delay", "500"));
  await page.getByRole("button", { name: "Review amount and basis", exact: true }).click();
  await page.getByRole("button", { name: "Cancel contract edit", exact: true }).click();
  await page.getByRole("button", { name: "Review contract basis", exact: true }).click();
  await page.getByLabel("Basis or source reference", { exact: true }).fill("Newer entered basis");
  await page.waitForTimeout(600);
  if (await page.getByRole("button", { name: "Confirm contract basis", exact: true }).isVisible())
    throw Error("Cancelled review leaked into newer edit");
  if (
    (await page.evaluate(() => document.querySelector("textarea").value)) !== "Newer entered basis"
  )
    throw Error("Newer input overwritten");
  await page.getByLabel("Original contract amount (USD)", { exact: true }).fill("100000");
  await page.evaluate(() => sessionStorage.removeItem("fixture-contract-delay"));
  await page.getByRole("button", { name: "Review amount and basis", exact: true }).click();
  await page.getByRole("button", { name: "Confirm contract basis", exact: true }).waitFor();
  const before = await page.evaluate(() =>
    window.__pa_calls.filter((c) => c._action === "contract_basis_save"),
  );
  if (before.length) throw Error("Saved without confirmation");
  await page.screenshot({ path: root + "/contract-review-1110.png", fullPage: true });
  await page.evaluate(() => sessionStorage.setItem("fixture-contract-version", "competing-change"));
  await page.getByRole("button", { name: "Confirm contract basis", exact: true }).click();
  await page.getByRole("button", { name: "Check contract save", exact: true }).waitFor();
  await page.getByRole("button", { name: "Check contract save", exact: true }).click();
  await page.getByRole("button", { name: "Reload current basis", exact: true }).click();
  await page.getByRole("button", { name: "Review contract basis", exact: true }).click();
  await page.getByLabel("Original contract amount (USD)", { exact: true }).fill("100000");
  await page
    .getByLabel("Basis or source reference", { exact: true })
    .fill("Reviewed latest owner basis");
  await page.getByRole("button", { name: "Review amount and basis", exact: true }).click();
  await page.getByRole("button", { name: "Confirm contract basis", exact: true }).waitFor();
  await page.evaluate(() => sessionStorage.setItem("fixture-contract-lose-response", "1"));
  await page.getByRole("button", { name: "Confirm contract basis", exact: true }).click();
  await page.getByRole("button", { name: "Check contract save", exact: true }).waitFor();
  const uncertain = await page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith("contract-basis:v1:"));
    return { key, value: sessionStorage.getItem(key) };
  });
  await page.reload();
  await page.getByRole("button", { name: "Retry contract save", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Contract basis saved and refreshed" })
    .waitFor();
  // A second interrupted tab can still hold the same pending request; outcome lookup must not save again.
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), uncertain);
  await page.reload();
  await page.getByRole("button", { name: "Check contract save", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "saved contract basis was found" }).waitFor();
  if (!(await prepare.isEnabled()))
    throw Error("Canonical prerequisites did not refresh after save recovery");
  await page.setViewportSize({ width: 375, height: 950 });
  await page.screenshot({ path: root + "/contract-saved-375.png", fullPage: true });
  await prepare.click();
  await page.getByRole("heading", { name: "Prepare application", exact: true }).waitFor();
  const calls = await page.evaluate(() => window.__pa_calls);
  if (calls.some((c) => c._action === "payment_application_save"))
    throw Error("Contract setup wrote a financial application");
  const ops = await page.evaluate(() =>
    Object.keys(sessionStorage).filter((k) => k.startsWith("fixture-contract-op:")),
  );
  if (ops.length !== 1) throw Error("Lost response produced duplicate saved facts");
  for (const [label, value] of [
    ["Application number", "New application"],
    ["Period start", "2026-01-01"],
    ["Period end / billing date", "2026-01-31"],
    ["Prior application cutoff", "2025-12-31"],
    ["Progress/application source", "Owner-entered progress; missing figures remain Needed"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Review application", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.waitForURL(/application_id=.*version=1/);
  await page.getByRole("button", { name: "Download saved PDF", exact: true }).waitFor();
  if (!(await page.getByText("Incomplete draft · Needed inputs", { exact: true }).isVisible()))
    throw Error("Missing progress was replaced with completed totals");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download saved PDF", exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(root + "/contract-then-application-draft.pdf");
  const concurrent = await page.evaluate(({key,value}) => {
    const p=JSON.parse(value), opKey=`fixture-contract-op:${p.request_id}`, operation=sessionStorage.getItem(opKey);
    sessionStorage.removeItem(opKey);sessionStorage.setItem(key,value);return {opKey,operation};
  },uncertain);
  await page.reload();
  await page.getByRole("button",{name:"Check contract save",exact:true}).click();
  await page.getByRole("button",{name:"Review amount and basis",exact:true}).waitFor();
  await page.evaluate(({opKey,operation})=>sessionStorage.setItem(opKey,operation),concurrent);
  await page.getByRole("button",{name:"Review amount and basis",exact:true}).click();
  await page.getByRole("status").filter({hasText:"This exact request was already saved"}).waitFor();
  return {
    widths,
    missingContractBlocked: true,
    cancelledReviewIgnored: true,
    newerInputPreserved: true,
    staleReviewRejected: true,
    confirmationRequired: true,
    lostResponseRecoveredAfterReload: true,
    oneContractOperation: true,
    applicationFormUnlocked: true,
    contractSetupDidNotSaveApplication: true,
    separatelyReviewedDraftSaved: true,
    exactDraftPdfDownloaded: true,
    concurrentCompletionDuringReviewHandled: true,
  };
}
