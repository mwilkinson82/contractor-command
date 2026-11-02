async (page) => {
 const root='output/playwright/payment-applications';
 const html=await(await page.request.get('http://127.0.0.1:4182/interactive.html')).text();
 await page.context().route('**/r/job/**',r=>r.fulfill({body:html,contentType:'text/html'}));
 await page.goto('http://127.0.0.1:4182/interactive.html');await page.evaluate(()=>sessionStorage.clear());
 await page.goto('http://127.0.0.1:4182/r/job/00000000-0000-4000-8000-000000000001/payment-applications?application_id=00000000-0000-4000-8000-000000000002&version=1&certificate_fixture=1');
 await page.getByRole('button',{name:'Record actual certificate',exact:true}).click();
 if(await page.getByLabel('Cumulative installed (USD)',{exact:true}).count())throw Error('Issued amounts are editable in certificate mode');
 if(await page.getByLabel('Amount certified for this application (USD)',{exact:true}).inputValue()!=='')throw Error('Actual certificate amount was invented');
 for(const width of [375,600]){await page.setViewportSize({width,height:1000});const clipped=await page.evaluate(()=>[...document.querySelectorAll('input,button')].some(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth;}));if(clipped)throw Error('Certificate controls clipped');await page.screenshot({path:`${root}/certificate-${width}.png`,fullPage:true});}
 await page.getByLabel('Revision reason',{exact:true}).fill('Actual certificate received');
 await page.getByLabel('Amount certified for this application (USD)',{exact:true}).fill('13500.00');await page.getByLabel('Certificate date',{exact:true}).fill('2026-02-02');await page.getByLabel('Certificate source',{exact:true}).fill('Actual certificate for original issued period');
 await page.getByRole('button',{name:'Review certificate',exact:true}).click();await page.getByRole('button',{name:'Confirm actual certificate',exact:true}).waitFor();
 const calls=await page.evaluate(()=>window.__pa_calls);const r=calls.findLast(c=>c._action==='payment_application_review');if(r._p.application.snapshot.contract_cents!==10000000||r._p.application.lines[0].work_cents!==1000000)throw Error('Issued financial snapshot was rebased');if(calls.some(c=>c._action==='payment_application_save'))throw Error('Saved before confirmation');
 await page.getByRole('button',{name:'Confirm actual certificate',exact:true}).click();await page.waitForURL(/version=2/);await page.getByText('Actual certificate $13,500.00, dated 2026-02-02.',{exact:false}).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download saved PDF'}).click();const file=await download;await file.saveAs(root+'/certificate-browser-download.pdf');
 return {frozenIssuedContract:10000000,currentSovContract:11000000,amountInitiallyUnknown:true,financialInputsReadOnly:true,reviewConfirmed:true,savedCertificateVersion:2,widths:[375,600]};
}
