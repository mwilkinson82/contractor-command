// Disposable GitHub Actions service only. No URLs, production secrets or external databases.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import postgres from 'postgres';

assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only a GitHub Actions disposable service is allowed');
assert.equal(process.env.ATHENA_EMAIL_NATIVE_TEST, '1', 'Explicit disposable-test opt-in required');
assert.match(process.env.ATHENA_EMAIL_NATIVE_PASSWORD??'',/^synthetic-\d+-\d+$/,'Only the run-scoped synthetic service password is allowed');
const pool=postgres({host:'127.0.0.1',port:55439,database:'athena_document_email_ci',username:'synthetic',password:process.env.ATHENA_EMAIL_NATIVE_PASSWORD,max:5,prepare:false,onnotice:()=>{}});
const [admin,a,b]=await Promise.all([pool.reserve(),pool.reserve(),pool.reserve()]);
const read=p=>readFileSync(p,'utf8');
const q=(c,s,p=[])=>c.unsafe(s,p);
const uid='00000000-0000-4000-8000-000000000101', outsider='00000000-0000-4000-8000-000000000102', co='00000000-0000-4000-8000-000000000201', job='00000000-0000-4000-8000-000000000301';
const hash='a'.repeat(64), attachment='b'.repeat(64);
const payload={email:{from:'owner@example.test',attachment:{sha256:attachment}},mailbox:{provider:'gmail',connectionId:'synthetic'}};
const receipt={provider:'gmail',connection_id:'synthetic',from:'owner@example.test',review_hash:hash,attachment_sha256:attachment,message_id:'synthetic-provider-claim',sent_at:'2026-11-02T12:00:00Z'};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cases=[];
const begin=async(c,actor=uid)=>{await q(c,'begin');await q(c,'set local role authenticated');await q(c,"select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,role:'authenticated'})]);};
const rpc=async(c,delivery,action,args={})=>(await q(c,'select public.mcp_document_email_delivery($1,$2,$3::jsonb) r',[job,action,JSON.stringify({delivery_id:delivery,...args})]))[0].r;
const execute=async(c,delivery,action,args={})=>{await begin(c);try{const r=await rpc(c,delivery,action,args);await q(c,'commit');return r;}catch(e){await q(c,'rollback');throw e;}};
const make=async(n)=>{
 const app=id(400+n),delivery=id(500+n);
 await q(admin,'insert into public.mcp_payment_applications(id,job_id,company_id,number,created_by) values($1,$2,$3,$4,$5)',[app,job,co,`APP-${n}`,uid]);
 await q(admin,"insert into public.mcp_payment_application_versions(application_id,version,job_id,body,calculation,recorded_by) values($1,1,$2,'{}','{}',$3)",[app,job,uid]);
 await execute(a,delivery,'review',{application_id:app,version:1,review_hash:hash,payload});
 await execute(a,delivery,'handoff',{review_hash:hash,confirmed:true});return {app,delivery};
};
const blockJob=async()=>{await q(a,'begin');await q(a,'select id from public.mcp_jobs where id=$1 for update',[job]);};
// Capture backend IDs before a query is pending; a reserved connection cannot answer two queries at once.
const pidA=Number((await q(a,'select pg_backend_pid() p'))[0].p),pidB=Number((await q(b,'select pg_backend_pid() p'))[0].p);
const waitForB=async()=>{for(let i=0;i<100;i++){const [r]=await q(admin,'select wait_event_type,$2::int=any(pg_blocking_pids($1::int)) blocked from pg_stat_activity where pid=$1',[pidB,pidA]);if(r?.wait_event_type==='Lock'&&r.blocked)return;await sleep(50);}throw Error('Session B did not wait on session A');};
const finishB=async(p,expectError=false)=>{let v,error;try{v=await p;}catch(e){error=e;}if(error){await q(b,'rollback');if(!expectError)throw error;return error;}await q(b,'commit');assert.equal(expectError,false,'Expected rejection did not occur');return v;};
try {
 const [env]=await q(admin,"select current_database() db,current_user username,current_setting('server_version_num')::int version,current_setting('data_directory') directory");
 assert.equal(env.db,'athena_document_email_ci');assert.equal(env.username,'synthetic');assert(env.version>=170000&&env.version<180000);assert.equal(env.directory,'/var/lib/postgresql/data');
 const sql=read('drizzle/migrations/0060_document_email_delivery.sql');assert.equal(Buffer.byteLength(sql),9992);assert.equal(createHash('sha256').update(sql).digest('hex'),'3fab16c309fdf3bbab3ba33e6941ab37d1f52e8e6c4b8ac5a85944ea59f101c2');
 const boot=read('tests/mcp-roles/db.ts').match(/const BOOT = `([\s\S]*?)`;/)?.[1];assert(boot);await q(admin,boot);
 for(const f of readdirSync('drizzle/migrations').filter(f=>f.endsWith('.sql')&&f<='0024_athena_reopen_open_item.sql').sort())await q(admin,read(`drizzle/migrations/${f}`).replace(/--> statement-breakpoint/g,''));
 await q(admin,`alter table auth.users add column email_confirmed_at timestamptz;
 create type app_tier as enum ('aos_only','book_buyer','power_hour','sm_school','contractor_school','intensive','circle','hardcore');
 create table profiles(id uuid primary key,email text,full_name text);create table user_roles(user_id uuid,role text);
 create table subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid,email text not null,stripe_customer_id text,stripe_subscription_id text unique,price_id text,product_id text,status text not null,current_period_end timestamptz,cancel_at_period_end boolean default false,is_founding boolean default false,is_comped boolean not null default false,metadata jsonb not null default '{}',tier app_tier default 'circle',updated_at timestamptz default now());
 create table aos_addons(user_id uuid,email text,kind text,quantity int,status text);create table aos_links(user_id uuid,aos_email text);
 create table stripe_webhook_events(event_id text primary key,event_type text,object_id text,status text,attempts int default 1,processing_started_at timestamptz,processed_at timestamptz,last_error text,updated_at timestamptz default now());
 create function has_role(uid uuid,r text) returns boolean language sql as $$select exists(select 1 from user_roles where user_id=uid and role=r)$$;
 create function tier_rank(t app_tier) returns integer language sql as $$select case t when 'hardcore' then 5 when 'circle' then 4 else 1 end$$;
 drop function get_circle_entitlement(uuid,text);
 insert into auth.users values('${uid}','owner@example.test',now()),('${outsider}','other@example.test',now());
 insert into profiles values('${uid}','owner@example.test','Synthetic'),('${outsider}','other@example.test','Synthetic');`);
 const ident=read('supabase/migrations/20260527182404_9674d14f-9cbd-46bd-8a50-4e651788d04d.sql');await q(admin,ident.slice(0,ident.indexOf('CREATE OR REPLACE FUNCTION public.has_active_access')));
 for(const f of ['20261004190813_circle_entitlement_reconciliation.sql','20261004201435_circle_source_aliases.sql','20261021190000_athena_team_invites.sql','20261024104817_athena_circle_company_provisioning.sql','20261024110422_athena_circle_verified_payment_claim.sql'])await q(admin,read(`supabase/migrations/${f}`));
 const pay=read('drizzle/migrations/0057_sov_payment_applications.sql');await q(admin,pay.slice(0,pay.indexOf('-- Strict nullable integer parser.')));await q(admin,'alter table public.mcp_payment_application_versions add column working_state text');
 await q(admin,sql);
 await q(admin,`insert into public.circle_owner_grants(user_id,email,granted_by,reason) values('${uid}','owner@example.test','${uid}','Synthetic CI fixture');
 insert into public.mcp_companies(id,name,created_by) values('${co}','Synthetic','${uid}');
 insert into public.mcp_company_members(company_id,user_id,role,display_name) values('${co}','${uid}','owner','Synthetic');
 insert into public.mcp_jobs(id,company_id,user_id,job_number,name,restricted) values('${job}','${co}','${uid}','TEST-A','Synthetic',true);`);

 // Revocation while B waits on A's job lock must be rechecked after the lock.
 {const {delivery}=await make(1);await blockJob();await begin(b);const p=rpc(b,delivery,'claim',{review_hash:hash,confirmed:true});p.catch(()=>{});await waitForB();await q(a,'delete from public.mcp_company_members where company_id=$1 and user_id=$2',[co,uid]);await q(a,'commit');const e=await finishB(p,true);assert.match(String(e),/access|MCP_BAD/i);await q(admin,"insert into public.mcp_company_members(company_id,user_id,role,display_name) values($1,$2,'owner','Synthetic')",[co,uid]);cases.push('post-lock membership revocation rejected');}
 // A newly saved version while B waits must invalidate the reviewed version.
 {const {app,delivery}=await make(8);await blockJob();await begin(b);const p=rpc(b,delivery,'claim',{review_hash:hash,confirmed:true});p.catch(()=>{});await waitForB();await q(a,"insert into public.mcp_payment_application_versions(application_id,version,job_id,body,calculation,recorded_by) values($1,2,$2,'{}','{}',$3)",[app,job,uid]);await q(a,'commit');const e=await finishB(p,true);assert.match(String(e),/changed/i);cases.push('post-lock saved-version drift rejected');}
 // Expiry is measured after the actual lock wait, not at transaction start.
 {const {delivery}=await make(2);await q(admin,"update public.mcp_document_email_deliveries set expires_at=clock_timestamp()+interval '2 seconds' where id=$1",[delivery]);await blockJob();await begin(b);const p=rpc(b,delivery,'claim',{review_hash:hash,confirmed:true});p.catch(()=>{});await waitForB();await sleep(2200);await q(a,'commit');const e=await finishB(p,true);assert.match(String(e),/expired/i);cases.push('expiry while waiting rejected');}
 // Both claim/cancel orderings must preserve the first result.
 {const {delivery}=await make(3);await begin(a);assert.equal((await rpc(a,delivery,'cancel',{review_hash:hash,confirmed:true})).state,'cancelled');await begin(b);const p=rpc(b,delivery,'claim',{review_hash:hash,confirmed:true});p.catch(()=>{});await waitForB();await q(a,'commit');assert.equal((await finishB(p)).claimed,false);cases.push('cancel first prevents claim');}
 {const {delivery}=await make(4);await begin(a);assert.equal((await rpc(a,delivery,'claim',{review_hash:hash,confirmed:true})).claimed,true);await begin(b);const p=rpc(b,delivery,'cancel',{review_hash:hash,confirmed:true});p.catch(()=>{});await waitForB();await q(a,'commit');const e=await finishB(p,true);assert.match(String(e),/already|reconcile/i);cases.push('claim first rejects cancellation');}
 // Two claimers: exactly one receives a claim, even across lock waits.
 {const {delivery}=await make(5);await begin(a);assert.equal((await rpc(a,delivery,'claim',{review_hash:hash,confirmed:true})).claimed,true);await begin(b);const p=rpc(b,delivery,'claim',{review_hash:hash,confirmed:true});p.catch(()=>{});await waitForB();await q(a,'commit');assert.equal((await finishB(p)).claimed,false);cases.push('competing claims produce one claim');}
 // Uncertain/receipt races in both orders and exact receipt replay.
 {const {delivery}=await make(6);await execute(a,delivery,'claim',{review_hash:hash,confirmed:true});await begin(a);assert.equal((await rpc(a,delivery,'uncertain',{review_hash:hash})).state,'uncertain');await begin(b);const p=rpc(b,delivery,'receipt',{review_hash:hash,receipt});p.catch(()=>{});await waitForB();await q(a,'commit');assert.equal((await finishB(p)).state,'host_reported_provider_acceptance');assert.equal((await execute(a,delivery,'receipt',{review_hash:hash,receipt})).already_recorded,true);await assert.rejects(execute(a,delivery,'receipt',{review_hash:hash,receipt:{...receipt,message_id:'different'}}));cases.push('uncertain first accepts only matching receipt and exact replay');}
 {const {delivery}=await make(7);await execute(a,delivery,'claim',{review_hash:hash,confirmed:true});await begin(a);assert.equal((await rpc(a,delivery,'receipt',{review_hash:hash,receipt})).state,'host_reported_provider_acceptance');await begin(b);const p=rpc(b,delivery,'uncertain',{review_hash:hash});p.catch(()=>{});await waitForB();await q(a,'commit');const e=await finishB(p,true);assert.match(String(e),/unresolved/i);cases.push('receipt first preserves reported acceptance');}
 // Anonymous and direct-table access remain denied; scope uses real gate functions.
 await q(a,'begin');await q(a,'set local role anon');await assert.rejects(q(a,'select public.mcp_document_email_delivery($1,$2,$3::jsonb)',[job,'status',JSON.stringify({delivery_id:id(501)})]));await q(a,'rollback');
 await begin(a);await assert.rejects(q(a,'select * from public.mcp_document_email_deliveries'));await q(a,'rollback');cases.push('anonymous execute and authenticated table read denied');
 console.log(JSON.stringify({environment:'disposable PostgreSQL 17 CI service',auth:'repository gate, entitlement, provisioning and scope functions; synthetic JWT auth adapter',migration:'0060',cases},null,2));
} finally {a.release();b.release();admin.release();await pool.end({timeout:5});}
