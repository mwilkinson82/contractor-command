async (page) => {
  const assert = (condition, msg) => {
    if (!condition) throw Error(msg);
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:4399/viewer.html");
  const frame = page.frameLocator('iframe[title="Athena measured takeoff"]');
  await frame.getByRole("button", { name: "Open drawing workspace" }).click();
  await frame.getByRole("button", { name: "Count", exact: true }).click();
  await frame.getByText("L3 · 1", { exact: true }).click();
  assert(
    /L1 · Fictional light fixtures/.test(await frame.locator(".selbar").innerText()),
    "first overlapping selection",
  );
  await frame.getByText("L3 · 1", { exact: true }).click();
  assert(
    /L3 · Fictional overlapping fixture/.test(await frame.locator(".selbar").innerText()),
    "second overlapping selection",
  );
  assert(
    (await frame.getByText(/Click a pin or mark to see what it is/).count()) === 1,
    "inspect mode after selection",
  );
  await frame.getByRole("button", { name: "Count", exact: true }).click();
  const svg = frame.getByLabel("Measured geometry on the stored sheet");
  const box = await svg.boundingBox();
  await page.mouse.click(box.x + box.width * 0.32, box.y + box.height * 0.67);
  assert(
    (await frame.getByText(/Not saved yet: 1 count\./).count()) === 1,
    "deliberate count adds one unsaved point",
  );
  await frame.getByText("L3 · 1", { exact: true }).click();
  assert(
    (await frame.getByText(/Not saved yet: 1 count\./).count()) === 1,
    "saved marker did not add or erase pending point",
  );
  assert(
    (await frame.getByText(/Save or drop the points you're placing/).count()) === 1,
    "pending-point warning",
  );
  await frame.getByRole("button", { name: "Select and pan" }).click();
  await frame.getByRole("button", { name: "Drop them and switch" }).click();
  await frame.getByRole("button", { name: "Hide marks" }).click();
  assert((await frame.getByText("L3 · 1", { exact: true }).count()) === 0, "marks hidden");
  await frame.getByRole("button", { name: "Count", exact: true }).click();
  assert(
    (await frame.getByText(/Show marks before drawing/).count()) >= 1,
    "cannot add with marks hidden",
  );
  await frame.getByRole("button", { name: "Show marks" }).click();
  assert((await frame.getByText("L3 · 1", { exact: true }).count()) === 1, "marks restored");
  await frame.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(1000);
  const calls = await page.locator("#calls").innerText();
  assert(calls.includes("viewer_tile_only"), "zoom requested high-resolution detail");
  // Click and drag on the zoomed sheet pans it and never adds a point.
  const viewport = frame.locator(".viewport");
  const panBox = await svg.boundingBox();
  const startScroll = await viewport.evaluate((v) => v.scrollLeft);
  await page.mouse.move(panBox.x + 200, panBox.y + 120);
  await page.mouse.down();
  await page.mouse.move(panBox.x + 120, panBox.y + 120, { steps: 6 });
  await page.mouse.up();
  assert(
    (await viewport.evaluate((v) => v.scrollLeft)) > startScroll,
    "mouse drag pans the zoomed sheet",
  );
  assert(
    (await frame.getByText(/Not saved yet/).count()) === 0,
    "drag added no point",
  );
  assert(!calls.includes('"operation":"save"'), "no geometry save");
  await frame.getByRole("button", { name: "Back to chat" }).click();
  await frame.getByRole("button", { name: "Open drawing workspace" }).waitFor();
  assert(
    (await frame.getByRole("button", { name: "Open drawing workspace" }).count()) === 1,
    "back to compact",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await frame.getByRole("button", { name: "Open drawing workspace" }).waitFor();
  assert(
    (await frame.getByRole("button", { name: "Open drawing workspace" }).count()) === 1,
    "mobile compact",
  );
  await frame.getByRole("button", { name: "Open drawing workspace" }).click();
  assert(
    (await frame.getByText("L3 · 1", { exact: true }).count()) === 1,
    "mobile marker available",
  );
  await frame.getByText("L3 · 1", { exact: true }).click();
  assert(
    /L1 · Fictional light fixtures/.test(await frame.locator(".selbar").innerText()),
    "mobile selection",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:4399/viewer.html?no-sheet");
  await frame.getByRole("button", { name: "Open drawing workspace" }).click();
  await frame.getByRole("button", { name: "Open stored sheet" }).click();
  assert(
    (await frame.getByText("Choose a drawing set and sheet first.").count()) === 1,
    "no silent first sheet",
  );
  assert(
    (await frame.getByRole("button", { name: "Open E-100" }).count()) === 1,
    "shortcut to the sheet that holds saved marks",
  );
  await frame
    .getByLabel("Stored drawing set")
    .selectOption({ label: "Fictional reference drawing.pdf · revision 1" });
  await frame.getByLabel("Sheet to measure").selectOption({ label: "E-100" });
  await frame.getByRole("button", { name: "Open stored sheet" }).click();
  await frame.getByText("Saved result loaded.").waitFor();
  assert(
    (await page.locator("#calls").innerText()).includes('"sheet":"E-100"'),
    "requested sheet passed through",
  );
  assert(
    (await page.locator("#calls").innerText()).includes('"viewer_only":true'),
    "viewer open skips the model-only annotated image",
  );
  return "PASS: compact/open/back, overlap cycling, deliberate count, protected pending draft, detailed zoom request, mobile selection, explicit sheet choice, saved-mark shortcut, viewer-only open; no save requested";
}
