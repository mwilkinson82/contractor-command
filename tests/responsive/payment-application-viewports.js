async (page) => {
  const result = { checks: [], failed: [] };
  const base = "http://127.0.0.1:4182";
  for (const name of ["saved", "incomplete"])
    for (const width of [320, 375, 430, 500, 600, 700, 1110, 1365]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/${name}.html`);
      await page.evaluate(() => document.fonts.ready);
      const check = await page.evaluate(() => {
        const clipped = [];
        for (const e of document.querySelectorAll("a,button,input,select,h1,h2,dt,dd,p")) {
          if (e.closest(".pa-scroll")) continue;
          const r = e.getBoundingClientRect();
          if (r.width && r.height && (r.left < -0.5 || r.right > innerWidth + 0.5))
            clipped.push(e.textContent.slice(0, 90));
        }
        const scroll = document.querySelector(".pa-scroll");
        const table = scroll.querySelector("table");
        return {
          width: innerWidth,
          pageWidth: document.documentElement.scrollWidth,
          clipped,
          scrollWidth: scroll.scrollWidth,
          clientWidth: scroll.clientWidth,
          tableWidth: table.getBoundingClientRect().width,
        };
      });
      const scroll = page.locator(".pa-scroll");
      await scroll.focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(200);
      const moved = await scroll.evaluate((e) => e.scrollLeft);
      await scroll.evaluate((e) => (e.scrollLeft = e.scrollWidth));
      const lastVisible = await scroll.evaluate((e) => {
        const a = e.getBoundingClientRect(),
          b = e.querySelector("tbody tr td:last-child").getBoundingClientRect();
        return b.right <= a.right + 1 && b.left >= a.left - 1;
      });
      const entry = { name, width, ...check, keyboardScroll: moved, lastVisible };
      result.checks.push(entry);
      if (
        check.clipped.length ||
        check.pageWidth > width + 1 ||
        (check.scrollWidth > check.clientWidth && moved <= 0) ||
        !lastVisible
      )
        result.failed.push(entry);
      if ([375, 600, 1365].includes(width))
        await page.screenshot({
          path: `output/playwright/payment-applications/${name}-${width}.png`,
          fullPage: true,
        });
    }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/embedded.html`);
  const child = page.frames().find((f) => f.parentFrame() === page.mainFrame());
  if (!child) throw Error("Missing child frame");
  const width = await child.evaluate(() => innerWidth);
  const clipped=await child.evaluate(()=>[...document.querySelectorAll('a,button,h1,h2,dt,dd,p')].filter(e=>!e.closest('.pa-scroll')).some(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth;}));
  const scroller=child.locator('.pa-scroll');await scroller.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(200);const keyboardScroll=await scroller.evaluate(e=>e.scrollLeft);await scroller.evaluate(e=>e.scrollLeft=e.scrollWidth);const lastVisible=await scroller.evaluate(e=>{const a=e.getBoundingClientRect(),b=e.querySelector('tbody tr td:last-child').getBoundingClientRect();return b.right<=a.right+1&&b.left>=a.left-1;});
  const embedded={name:'embedded',width,clipped,keyboardScroll,lastVisible};result.checks.push(embedded);
  if(width!==600||clipped||keyboardScroll<=0||!lastVisible)result.failed.push(embedded);
  await page.screenshot({
    path: "output/playwright/payment-applications/embedded-600.png",
    fullPage: true,
  });
  console.log(JSON.stringify(result));
  if (result.failed.length) throw Error("Responsive checks failed");
  return result;
}
