async (page) => {
  const root = "output/playwright/payment-applications";
  const fixtureHTML=await (await page.request.get('http://127.0.0.1:4182/interactive.html')).text();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .context()
    .route("**/r/job/**", (r) =>
      r.fulfill({ body: fixtureHTML, contentType: "text/html" }),
    );
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("http://127.0.0.1:4182/interactive.html");
  await page.getByRole("button", { name: "Prepare a new application" }).click();
  const editorWidths = [];
  for (const width of [320, 375, 430, 500, 600, 700, 1110, 1365]) {
    await page.setViewportSize({ width, height: 1000 });
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll("input,select,button")].some((e) => {
        const r = e.getBoundingClientRect();
        return r.left < 0 || r.right > innerWidth;
      }),
    );
    if (bad) throw Error("Editor clipped at " + width);
    editorWidths.push(width);
  }
  await page.setViewportSize({ width: 375, height: 900 });
  for (const [label, value] of [
    ["Application number", "Period application"],
    ["Period start", "2026-01-01"],
    ["Period end / billing date", "2026-01-31"],
    ["Prior application cutoff", "2025-12-31"],
    ["Progress/application source", "Reviewed progress source"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll("input,select,button")]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.left < 0 || r.right > innerWidth;
      })
      .map((e) => e.getAttribute("aria-label") || e.textContent),
  );
  if (clipped.length) throw Error("Editor controls clipped: " + JSON.stringify(clipped));
  await page.screenshot({ path: root + "/editor-375.png", fullPage: true });
  await page.getByRole("button", { name: "Review application", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).waitFor();
  const calls = await page.evaluate(() => window.__pa_calls);
  if (calls.some((c) => c._action === "payment_application_save"))
    throw Error("Saved before explicit confirmation");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.waitForURL(/application_id=.*version=1/);
  await page.getByRole("button", { name: "Download saved PDF" }).waitFor();
  if (!(await page.getByText("Incomplete draft · Needed inputs", { exact: true }).isVisible()))
    throw Error("Missing values were not preserved");
  await page.screenshot({ path: root + "/saved-ui-375.png", fullPage: true });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download saved PDF" }).click();
  const file = await download;
  await file.saveAs(root + "/browser-download.pdf");
  if (!file.suggestedFilename().includes("-v1.pdf")) throw Error("Wrong version document");
  await page.setViewportSize({ width: 600, height: 1000 });
  await page.getByRole("button", { name: "Revise this application" }).click();
  await page
    .getByLabel("Revision reason", { exact: true })
    .fill("More source information recorded");
  await page.getByRole("button", { name: "Review application", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).waitFor();
  await page.screenshot({ path: root + "/review-600.png", fullPage: true });
  if (errors.length) throw Error("Browser errors: " + errors.join("; "));
  return {
    editorWidths,
    mobileEditorFits: true,
    explicitConfirmation: true,
    savedVersion: 1,
    unknownInputsPreserved: true,
    download: file.suggestedFilename(),
    revisionReview: true,
    browserErrors: errors,
  };
}
