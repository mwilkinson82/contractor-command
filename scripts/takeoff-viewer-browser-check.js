async (page) => {
  const assert = (condition, msg) => {
    if (!condition) throw Error(msg);
  };
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:4399/viewer.html");
  const frame = page.frameLocator('iframe[title="Athena measured takeoff"]');
  await frame.getByRole("button", { name: "Open drawing workspace" }).click();
  await frame.getByRole("button", { name: "Count pins" }).click();
  await frame.getByText("L3 · 1", { exact: true }).click();
  assert(
    (await frame.getByRole("heading", { name: "L1 · Fictional light fixtures" }).count()) === 1,
    "first overlapping selection",
  );
  await frame.getByText("L3 · 1", { exact: true }).click();
  assert(
    (await frame.getByRole("heading", { name: "L3 · Fictional overlapping fixture" }).count()) ===
      1,
    "second overlapping selection",
  );
  assert(
    (await frame.getByText(/Inspect mode: select a mark/).count()) === 1,
    "inspect mode after selection",
  );
  await frame.getByRole("button", { name: "Count pins" }).click();
  const svg = frame.getByLabel("Measured geometry on the stored sheet");
  const box = await svg.boundingBox();
  await page.mouse.click(box.x + box.width * 0.32, box.y + box.height * 0.67);
  assert(
    (await frame.getByText(/Adding pins: 1 unsaved point/).count()) === 1,
    "deliberate count adds one unsaved point",
  );
  await frame.getByText("L3 · 1", { exact: true }).click();
  assert(
    (await frame.getByText(/Adding pins: 1 unsaved point/).count()) === 1,
    "saved marker did not add or erase pending point",
  );
  assert(
    (await frame.getByText(/Finish or discard the unsaved drawing/).count()) === 1,
    "pending-point warning",
  );
  await frame.getByRole("button", { name: "Inspect saved work" }).click();
  await frame.getByRole("button", { name: "Confirm", exact: true }).click();
  await frame.getByRole("button", { name: "Hide marks" }).click();
  assert((await frame.getByText("L3 · 1", { exact: true }).count()) === 0, "marks hidden");
  await frame.getByRole("button", { name: "Count pins" }).click();
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
    (await frame.getByRole("heading", { name: "L1 · Fictional light fixtures" }).count()) === 1,
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
  return "PASS: compact/open/back, overlap cycling, deliberate count, protected pending draft, detailed zoom request, mobile selection, explicit sheet choice; no save requested";
}
