async (page) => {
 const base='http://127.0.0.1:4186';
 const html=await(await page.request.get(base+'/interactive.html')).text();
 const db=await(await page.request.get(base+'/jsonb-context.json')).json();
 await page.context().route('**/r/job/**',r=>r.fulfill({body:html,contentType:'text/html'}));
 await page.setViewportSize({width:375,height:900});
 await page.goto(base+'/interactive.html');
 const id=db.selected.application_id;
 await page.evaluate(({db,id})=>{sessionStorage.clear();sessionStorage.setItem('fixture-current-sov',JSON.stringify(db.snapshot));sessionStorage.setItem(`fixture-saved:${id}`,JSON.stringify(db.selected));sessionStorage.setItem(`fixture-version:${id}:1`,JSON.stringify(db.selected));sessionStorage.setItem('fixture-list',JSON.stringify(db.applications));},{db,id});
 await page.goto(`${base}/r/job/00000000-0000-4000-8000-000000000001/payment-applications?application_id=${id}&version=1`);
 await page.getByRole('heading',{name:'Revise application'}).waitFor();
 await page.getByRole('button',{name:'Review application',exact:true}).click();
 await page.getByRole('button',{name:'Save draft',exact:true}).waitFor();
 const calls=await page.evaluate(()=>window.__pa_calls);
 if(!calls.some(c=>c._action==='payment_application_review'))throw Error('No review RPC');
 if(calls.some(c=>c._action==='payment_application_save'))throw Error('Saved before confirmation');
 await page.screenshot({path:'output/playwright/payment-applications/jsonb-review-375.png',fullPage:true});
 return {realDatabaseJsonb:true,legacyWhitespace:true,unchangedDraftReview:true,confirmedSaveNotInvoked:true};
}
