async (page) => {
  await page
    .context()
    .route("**/*", (route) =>
      ["127.0.0.1", "fonts.googleapis.com", "fonts.gstatic.com"].includes(
        new URL(route.request().url()).hostname,
      )
        ? route.continue()
        : route.abort(),
    );
  const cases = await (await page.request.get("http://127.0.0.1:4181/cases.json")).json();
  const widths = [320, 375, 430, 500, 600, 700, 1110, 1365];
  const results = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const measure = async (frame) =>
    frame.evaluate(() => {
      const failures = [],
        width = innerWidth;
      if (document.documentElement.scrollWidth > width + 1)
        failures.push({
          kind: "whole-page-overflow",
          contentWidth: document.documentElement.scrollWidth,
        });
      const visible = (el) => {
        if (el.closest('[aria-hidden="true"]') && !el.matches("button,input,select,a,summary"))
          return false;
        for (let p = el; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (
            (cs.clip !== "auto" &&
              cs.clip !== "rect(auto, auto, auto, auto)" &&
              p.getBoundingClientRect().width <= 1.5 &&
              p.getBoundingClientRect().height <= 1.5) ||
            (p.tagName === "DETAILS" && !p.open && !el.closest("summary"))
          )
            return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      };
      const scroller = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p),
            r = p.getBoundingClientRect();
          if (
            ["auto", "scroll"].includes(s.overflowX) &&
            p.scrollWidth > p.clientWidth + 1 &&
            r.left >= -1 &&
            r.right <= width + 1
          )
            return p;
        }
        return null;
      };
      for (const el of document.querySelectorAll(
        "h1,h2,h3,button,input,select,a,summary,th,td,dt,dd,p,strong,pre,textarea,label",
      )) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect(),
          scrolling = scroller(el),
          label = (el.textContent || el.getAttribute("aria-label") || el.tagName)
            .trim()
            .slice(0, 75);
        if (!scrolling && (r.left < -1 || r.right > width + 1))
          failures.push({ kind: "outside-viewport", label, left: r.left, right: r.right });
        if (!scrolling && !["INPUT", "SELECT"].includes(el.tagName)) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            if (!node.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(node);
            for (const textRect of range.getClientRects()) {
              if (textRect.right > width + 1 || textRect.left < -1)
                failures.push({ kind: "text-outside-viewport", label });
              for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
                const s = getComputedStyle(p);
                if (!["hidden", "clip"].includes(s.overflowX)) continue;
                const box = p.getBoundingClientRect();
                if (textRect.right > box.right + 1 || textRect.left < box.left - 1) {
                  failures.push({ kind: "clipped-text", label });
                  break;
                }
              }
            }
          }
        }
      }
      for (const th of document.querySelectorAll("thead th")) {
        if (!visible(th)) continue;
        const walker = document.createTreeWalker(th, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()))
          for (const match of node.textContent.matchAll(/[A-Za-z]{4,}/g)) {
            const r = document.createRange();
            r.setStart(node, match.index);
            r.setEnd(node, match.index + match[0].length);
            if (r.getClientRects().length > 1)
              failures.push({ kind: "fragmented-header", label: match[0] });
          }
      }
      const scrolls = [];
      for (const el of document.querySelectorAll(
        ".ath-report-table-scroll,.ath-cpm-scroll,.table-scroll,.preview,.viewport",
      )) {
        if (!visible(el) || el.scrollWidth <= el.clientWidth + 1) continue;
        el.scrollLeft = el.scrollWidth;
        const moved = el.scrollLeft > 0;
        const last = el.querySelector("tr:last-child > :last-child");
        const lastReachable =
          !last || last.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1;
        if (!lastReachable)
          failures.push({ kind: "last-column-unreachable", label: el.getAttribute("aria-label") });
        el.focus();
        const keyboard = document.activeElement === el;
        scrolls.push({ width: el.clientWidth, content: el.scrollWidth, moved, keyboard });
        if (!moved || !keyboard)
          failures.push({ kind: "unreachable-table-scroll", label: el.getAttribute("aria-label") });
        el.scrollLeft = 0;
      }
      for (const el of document.querySelectorAll(
        ".num,.ath-report-tile-value,.ath-report-amount",
      )) {
        if (!visible(el)) continue;
        const r = document.createRange();
        r.selectNodeContents(el);
        const ys = [...r.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top));
        if (new Set(ys).size > 1)
          failures.push({ kind: "fragmented-number", label: el.textContent.trim() });
      }
      return {
        width,
        documentWidth: document.documentElement.scrollWidth,
        failures: [...new Map(failures.map((f) => [JSON.stringify(f), f])).values()],
        scrolls,
      };
    });
  const checkKeyboard = async (frame) => {
    const checks = [];
    const regions = frame.locator(".ath-report-table-scroll,.ath-cpm-scroll,.table-scroll");
    for (let i = 0; i < (await regions.count()); i++) {
      const region = regions.nth(i);
      if (!(await region.isVisible())) continue;
      const maximum = await region.evaluate((el) => el.scrollWidth - el.clientWidth);
      if (maximum <= 1) continue;
      await region.evaluate((el) => (el.scrollLeft = 0));
      await region.focus();
      let reached = false;
      for (let key = 0; key < 80; key++) {
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(20);
        reached = await region.evaluate(
          (el) => el.scrollLeft >= el.scrollWidth - el.clientWidth - 1,
        );
        if (reached) break;
      }
      const end = await region.evaluate((el) => ({
        left: el.scrollLeft,
        maximum: el.scrollWidth - el.clientWidth,
        lastColumnRight: el.querySelector("tr:last-child > :last-child")?.getBoundingClientRect()
          .right,
        regionRight: el.getBoundingClientRect().right,
      }));
      checks.push({ ...end, reached });
      await region.evaluate((el) => (el.scrollLeft = 0));
    }
    return checks;
  };
  for (const name of cases)
    for (const width of name === "schedule" ? [...widths, 521, 601, 701, 768, 951, 1201] : widths) {
      await page.setViewportSize({ width, height: 900 });
      errors.length = 0;
      await page.goto(`http://127.0.0.1:4181/${name}.html`);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.locator("details").evaluateAll((nodes) => nodes.forEach((n) => (n.open = true)));
      if (["drawing-card", "takeoff-sheet"].includes(name)) {
        const zoom = page.getByRole("button", { name: "Zoom in", exact: true });
        if ((await zoom.count()) !== 1)
          throw Error("Expected initialized drawing preview controls");
        if (await zoom.count()) {
          await zoom.click();
          await zoom.click();
        }
      }
      if (["drawing-card", "takeoff-sheet"].includes(name)) {
        const image = page.locator(".preview img,.viewport img");
        await image.waitFor({ state: "visible" });
        await page.waitForFunction(() =>
          [...document.querySelectorAll(".preview img,.viewport img")].some(
            (img) => img.naturalWidth > 0,
          ),
        );
      }
      if (name === "file-upload-card")
        await page.getByLabel("File for this job").waitFor({ state: "visible" });
      const result = { name, ...(await measure(page)) };
      if (errors.length) result.failures.push({ kind: "script-error", errors: errors.slice() });
      if (result.width === 375 || result.iframe) {
        result.keyboardChecks = await checkKeyboard(page);
        if (result.keyboardChecks.some((c) => !c.reached || c.lastColumnRight > c.regionRight + 1))
          result.failures.push({ kind: "keyboard-last-column-unreachable" });
      }
      results.push(result);
      if ([375, 1110].includes(width))
        await page.screenshot({
          path: `output/playwright/reports-responsive/${name}-${width}.png`,
          fullPage: true,
        });
    }
  for (const name of ["ior", "schedule", "payapp", "native-card"]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.setContent(
      `<html><head><meta charset="utf-8"><style>body{margin:0;display:flex}aside{width:700px}iframe{border:0;width:600px;height:950px}</style></head><body><aside>Synthetic chat pane</aside><iframe src="http://127.0.0.1:4181/${name}.html"></iframe></body></html>`,
    );
    await page.waitForTimeout(100);
    const frame = page
      .mainFrame()
      .childFrames()
      .find((f) => f.url() === `http://127.0.0.1:4181/${name}.html`);
    if (!frame || frame.parentFrame() !== page.mainFrame())
      throw Error("Expected report child frame");
    await frame.waitForLoadState();
    await frame.evaluate(() => document.fonts.ready);
    const result = { name, iframe: true, ...(await measure(frame)) };
    if (result.width !== 600) throw Error("Expected 600px child viewport");
    if (result.width === 375 || result.iframe) {
      result.keyboardChecks = await checkKeyboard(result.iframe ? frame : page);
      if (result.keyboardChecks.some((c) => !c.reached || c.lastColumnRight > c.regionRight + 1))
        result.failures.push({ kind: "keyboard-last-column-unreachable" });
    }
    results.push(result);
    await page.screenshot({
      path: `output/playwright/reports-responsive/${name}-split.png`,
      fullPage: true,
    });
  }
  return {
    cases: results.length,
    failed: results
      .filter((r) => !r.baseline && r.failures.length)
      .map((r) => ({
        name: r.name,
        width: r.width,
        iframe: r.iframe,
        failures: r.failures.slice(0, 12),
      })),
    results,
  };
}
