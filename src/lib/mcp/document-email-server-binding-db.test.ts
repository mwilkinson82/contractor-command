import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

let db:PGlite;
const actor='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', job='33333333-3333-4333-8333-333333333333', company='44444444-4444-4444-8444-444444444444', app='55555555-5555-4555-8555-555555555555', id='66666666-6666-4666-8666-666666666666';
const clientHash='a'.repeat(64), fileHash='b'.repeat(64);
const mailbox=(mode:'pinned'|'assistant_current_gmail'='pinned')=>({mode,provider:'gmail',profileAddress:'owner@example.test',canSendMime:true,...(mode==='pinned'?{connectionId:'connection-one'}:{})});
const payload=(mode:'pinned'|'assistant_current_gmail'='pinned')=>({email:{company_id:company,job_id:job,from:'owner@example.test',to:'recipient@example.test',cc:[],subject:'Application',body:'Please review.',attachment:{kind:'payment_application',company_id:company,job_id:job,document_id:app,version:1,filename:'application.pdf',mime_type:'application/pdf',size_bytes:100,sha256:fileHash}},mailbox:mailbox(mode)});
const call=async(action:string,p:Record<string,unknown>={})=>(await db.query<{r:any}>('select public.mcp_document_email_delivery($1,$2,$3::jsonb) r',[job,action,JSON.stringify({delivery_id:id,...p})])).rows[0].r;
const review=async(mode:'pinned'|'assistant_current_gmail'='pinned')=>call('review',{application_id:app,version:1,client_hash:clientHash,payload:payload(mode)});
const observation=(mode:'pinned'|'assistant_current_gmail'='pinned')=>({...mailbox(mode),observedAt:Date.now()});
const status=()=>call('status');
const receipt=(mode:'pinned'|'assistant_current_gmail',hash:string)=>({binding_mode:mode,provider:'gmail',...(mode==='pinned'?{connection_id:'connection-one'}:{}),from:'owner@example.test',review_hash:hash,attachment_sha256:fileHash,message_id:'synthetic',sent_at:'2026-01-01T00:00:00Z'});
const reviewedClaim=async(mode:'pinned'|'assistant_current_gmail'='pinned')=>{const r=await review(mode);await call('handoff',{review_hash:r.review_hash,confirmed:true});return r.review_hash as string;};

beforeEach(async()=>{
 db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
 CREATE FUNCTION public.mcp_assert_active() RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF current_setting('test.active',true)='off' THEN RAISE EXCEPTION 'inactive'; END IF; END $$;
 CREATE FUNCTION public.mcp_job_scope(uuid) RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.scope',true) $$;
 CREATE TABLE public.mcp_jobs(id uuid PRIMARY KEY,company_id uuid);
 CREATE TABLE public.mcp_payment_applications(id uuid PRIMARY KEY,job_id uuid);
 CREATE TABLE public.mcp_payment_application_versions(application_id uuid,job_id uuid,version integer,working_state text);
 SELECT set_config('test.actor','${actor}',false),set_config('test.active','on',false),set_config('test.scope','full',false);
 INSERT INTO public.mcp_jobs VALUES('${job}','${company}'); INSERT INTO public.mcp_payment_applications VALUES('${app}','${job}');
 INSERT INTO public.mcp_payment_application_versions VALUES('${app}','${job}',1,NULL);`);
 const installed=readFileSync('drizzle/migrations/0060_document_email_delivery.sql','utf8');
 expect(createHash('sha256').update(installed).digest('hex')).toBe('3fab16c309fdf3bbab3ba33e6941ab37d1f52e8e6c4b8ac5a85944ea59f101c2');
 await db.exec(installed);
});
afterEach(async()=>{await db.close()});
const install=()=>db.exec(readFileSync('release-proposals/document-email-server-binding.sql','utf8'));
const metadata=async()=>(await db.query(`select p.proacl::text acl,p.prosecdef definer,p.provolatile volatility,p.proconfig::text config,p.proowner::regrole::text owner from pg_proc p where p.oid='public.mcp_document_email_delivery(uuid,text,jsonb)'::regprocedure`)).rows[0];

describe('server-bound document email proposal',()=>{
 it('guards the installed body and preserves function ownership, configuration and grants',async()=>{
  const before=await metadata();await install();expect(await metadata()).toEqual(before);
  await expect(install()).rejects.toThrow(/drift/i);
  expect((await db.query<{allowed:boolean}>("select has_function_privilege('anon','public.mcp_document_email_delivery(uuid,text,jsonb)','execute') allowed")).rows[0].allowed).toBe(false);
  expect((await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','public.mcp_document_email_delivery(uuid,text,jsonb)','execute') allowed")).rows[0].allowed).toBe(true);
  await db.exec('set role authenticated');await expect(db.query('select * from public.mcp_document_email_deliveries')).rejects.toThrow(/permission denied/i);await db.exec('reset role');
 });
 it('derives a digest from mode, sender and all reviewed content instead of accepting a caller-selected review hash',async()=>{
  await install();const first=await review();expect(first.review_hash).toMatch(/^[a-f0-9]{64}$/);expect(first.review_hash).not.toBe(clientHash);
  const changed=payload();changed.email.to='other@example.test';
  await expect(call('review',{application_id:app,version:1,client_hash:clientHash,payload:changed})).rejects.toThrow(/changed/i);
  const second=await call('review',{application_id:app,version:1,client_hash:clientHash,expected_review_hash:first.review_hash,payload:changed});
  expect(second.review_hash).not.toBe(first.review_hash);
  await expect(call('handoff',{review_hash:first.review_hash,confirmed:true})).rejects.toThrow(/changed/i);
 });
 it('rejects missing or unsupported modes, sender mismatch, wrong project and a fabricated observed connection',async()=>{
  await install();
  for(const mutate of [
   (p:any)=>delete p.mailbox.mode,
   (p:any)=>p.mailbox.mode='unsupported',
   (p:any)=>p.mailbox.profileAddress='other@example.test',
   (p:any)=>p.email.company_id=other,
   (p:any)=>p.email.attachment.job_id=other,
   (p:any)=>{p.mailbox.mode='assistant_current_gmail';p.mailbox.connectionId='invented';},
  ]){const p=payload();mutate(p);await expect(call('review',{application_id:app,version:1,client_hash:clientHash,payload:p})).rejects.toThrow();}
 });
 it.each(['pinned','assistant_current_gmail'] as const)('requires a fresh matching %s observation at claim',async(mode)=>{
  await install();const hash=await reviewedClaim(mode);
  await expect(call('claim',{review_hash:hash,confirmed:true})).rejects.toThrow(/observation/i);
  await expect(call('claim',{review_hash:hash,confirmed:true,mailbox:{...observation(mode),mode:undefined}})).rejects.toThrow(/observation/i);
  await expect(call('claim',{review_hash:hash,confirmed:true,mailbox:{...observation(mode),observedAt:Date.now()-400000}})).rejects.toThrow(/refresh/i);
  expect((await status()).state).toBe('handoff_pending');
  expect((await call('claim',{review_hash:hash,confirmed:true,mailbox:observation(mode)})).claimed).toBe(true);
  expect((await call('claim',{review_hash:hash,confirmed:true,mailbox:observation(mode)})).claimed).toBe(false);
 });
 it.each(['pinned','assistant_current_gmail'] as const)('cancels a %s review atomically when the reported account changes',async(mode)=>{
  await install();const hash=await reviewedClaim(mode);const changed={...observation(mode),profileAddress:'other@example.test'};
  expect(await call('claim',{review_hash:hash,confirmed:true,mailbox:changed})).toMatchObject({state:'cancelled',claimed:false,reason:'account_mismatch'});
  expect((await status()).state).toBe('cancelled');expect((await call('claim',{review_hash:hash,confirmed:true,mailbox:observation(mode)})).claimed).toBe(false);
 });
 it('rejects changed pinned connection, changed mode and missing or mismatched receipt mode',async()=>{
  await install();const hash=await reviewedClaim();
  expect((await call('claim',{review_hash:hash,confirmed:true,mailbox:{...observation(),connectionId:'other'}})).state).toBe('cancelled');
  expect((await status()).state).toBe('cancelled');
 });
 it.each(['pinned','assistant_current_gmail'] as const)('enforces explicit %s mode on a receipt and preserves idempotent replay',async(mode)=>{
  await install();const hash=await reviewedClaim(mode);await call('claim',{review_hash:hash,confirmed:true,mailbox:observation(mode)});
  const good=receipt(mode,hash);const {binding_mode:_ignored,...missing}=good;
  await expect(call('receipt',{review_hash:hash,receipt:missing})).rejects.toThrow(/does not match/i);
  await expect(call('receipt',{review_hash:hash,receipt:{...good,binding_mode:mode==='pinned'?'assistant_current_gmail':'pinned'}})).rejects.toThrow(/does not match/i);
  await expect(call('receipt',{review_hash:hash,receipt:{...good,from:'other@example.test'}})).rejects.toThrow(/does not match/i);
  if(mode==='assistant_current_gmail')await expect(call('receipt',{review_hash:hash,receipt:{...good,connection_id:'invented'}})).rejects.toThrow(/does not match/i);
  else await expect(call('receipt',{review_hash:hash,receipt:{...good,connection_id:'wrong'}})).rejects.toThrow(/does not match/i);
  expect((await call('receipt',{review_hash:hash,receipt:good})).state).toBe('host_reported_provider_acceptance');
  expect((await call('receipt',{review_hash:hash,receipt:good})).already_recorded).toBe(true);
 });
 it('leaves legacy records readable and cancellable but refuses to hand off or claim them silently',async()=>{
  const legacyPayload={email:{from:'owner@example.test',attachment:{sha256:fileHash}},mailbox:{provider:'gmail',connectionId:'one'}};
  await call('review',{application_id:app,version:1,review_hash:clientHash,payload:legacyPayload});await install();
  expect((await status()).state).toBe('reviewed');await expect(call('handoff',{review_hash:clientHash,confirmed:true})).rejects.toThrow(/legacy review/i);
  expect((await call('cancel',{review_hash:clientHash,confirmed:true})).state).toBe('cancelled');
 });
 it('documents that a matching caller-supplied profile is not provider verification',async()=>{
  await install();
  const fabricated=payload('assistant_current_gmail');
  fabricated.email.from='fabricated@example.test';
  fabricated.mailbox.profileAddress='fabricated@example.test';
  const reviewed=await call('review',{application_id:app,version:1,client_hash:clientHash,payload:fabricated});
  await call('handoff',{review_hash:reviewed.review_hash,confirmed:true});
  const claim=await call('claim',{review_hash:reviewed.review_hash,confirmed:true,mailbox:{...observation('assistant_current_gmail'),profileAddress:'fabricated@example.test'}});
  expect(claim.claimed).toBe(true);
 });
 it('retains actor, active membership, job scope and application version checks',async()=>{
  await install();const hash=await reviewedClaim();await db.exec(`select set_config('test.actor','${other}',false)`);await expect(call('status')).rejects.toThrow(/unavailable/i);
  await db.exec(`select set_config('test.actor','${actor}',false),set_config('test.active','off',false)`);await expect(call('claim',{review_hash:hash,confirmed:true,mailbox:observation()})).rejects.toThrow(/inactive/i);
  await db.exec(`select set_config('test.active','on',false),set_config('test.scope','none',false)`);await expect(call('claim',{review_hash:hash,confirmed:true,mailbox:observation()})).rejects.toThrow(/access/i);
  await db.exec(`select set_config('test.scope','full',false);insert into public.mcp_payment_application_versions values('${app}','${job}',2,null)`);await expect(call('claim',{review_hash:hash,confirmed:true,mailbox:observation()})).rejects.toThrow(/changed/i);
 });
});
