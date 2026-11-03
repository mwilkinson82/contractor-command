import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let db:PGlite;
const actor='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', job='33333333-3333-4333-8333-333333333333', co='44444444-4444-4444-8444-444444444444', app='55555555-5555-4555-8555-555555555555', id='66666666-6666-4666-8666-666666666666', hash='a'.repeat(64);
async function call(action:string,p:object={}) { return (await db.query<{r:any}>('select public.mcp_document_email_delivery($1,$2,$3::jsonb) r',[job,action,JSON.stringify({delivery_id:id,...p})])).rows[0].r; }
beforeEach(async()=>{
 db=new PGlite();
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
 CREATE FUNCTION public.mcp_assert_active() RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF current_setting('test.active',true)='off' THEN RAISE EXCEPTION 'inactive'; END IF; END $$;
 CREATE FUNCTION public.mcp_job_scope(uuid) RETURNS text LANGUAGE sql AS $$ SELECT current_setting('test.scope',true) $$;
 CREATE TABLE public.mcp_jobs(id uuid PRIMARY KEY,company_id uuid);
 CREATE TABLE public.mcp_payment_applications(id uuid PRIMARY KEY,job_id uuid);
 CREATE TABLE public.mcp_payment_application_versions(application_id uuid,job_id uuid,version integer,working_state text);
 SELECT set_config('test.actor','${actor}',false),set_config('test.active','on',false),set_config('test.scope','full',false);
 INSERT INTO public.mcp_jobs VALUES('${job}','${co}');INSERT INTO public.mcp_payment_applications VALUES('${app}','${job}');
 INSERT INTO public.mcp_payment_application_versions VALUES('${app}','${job}',1,NULL);`);
 const migration=readFileSync('drizzle/migrations/0060_document_email_delivery.sql','utf8');
 expect(createHash('sha256').update(migration).digest('hex')).toBe('3fab16c309fdf3bbab3ba33e6941ab37d1f52e8e6c4b8ac5a85944ea59f101c2');
 await db.exec(migration);
});
afterEach(async()=>{await db.close()});
const review=()=>call('review',{application_id:app,version:1,review_hash:hash,payload:{email:{from:'a@example.test',attachment:{sha256:'b'.repeat(64)}},mailbox:{provider:'gmail',connectionId:'one'}}});
describe('durable email claim proposal',()=>{
 it('records an observed Gmail receipt without fabricating a connection ID',async()=>{
  const payload={email:{from:'a@example.test',attachment:{sha256:'b'.repeat(64)}},mailbox:{provider:'gmail',mode:'assistant_current_gmail',profileAddress:'a@example.test',canSendMime:true}};
  await call('review',{application_id:app,version:1,review_hash:hash,payload});await call('handoff',{review_hash:hash,confirmed:true});
  expect((await call('claim',{review_hash:hash,confirmed:true})).claimed).toBe(true);
  const receipt={provider:'gmail',from:'a@example.test',review_hash:hash,attachment_sha256:'b'.repeat(64),message_id:'fixture',sent_at:'2026-01-01T00:00:00Z'};
  await expect(call('receipt',{review_hash:hash,receipt:{...receipt,from:'other@example.test'}})).rejects.toThrow(/does not match/);
  await expect(call('receipt',{review_hash:hash,receipt:{...receipt,connection_id:'invented'}})).rejects.toThrow(/does not match/);
  expect((await call('receipt',{review_hash:hash,receipt})).state).toBe('host_reported_provider_acceptance');
  expect((await call('receipt',{review_hash:hash,receipt})).already_recorded).toBe(true);
  expect((await call('claim',{review_hash:hash,confirmed:true})).claimed).toBe(false);
 });
 it('cancels a pending observed review and never reclaims its old identity',async()=>{
  const payload={email:{from:'a@example.test',attachment:{sha256:'b'.repeat(64)}},mailbox:{provider:'gmail',mode:'assistant_current_gmail',profileAddress:'a@example.test',canSendMime:true}};
  await call('review',{application_id:app,version:1,review_hash:hash,payload});await call('handoff',{review_hash:hash,confirmed:true});
  await expect(call('cancel',{review_hash:'c'.repeat(64),confirmed:true})).rejects.toThrow(/changed/);
  expect((await call('cancel',{review_hash:hash,confirmed:true})).state).toBe('cancelled');
  expect((await call('claim',{review_hash:hash,confirmed:true})).claimed).toBe(false);
  expect((await call('review',{application_id:app,version:1,review_hash:hash,payload})).state).toBe('cancelled');
  const fresh='77777777-7777-4777-8777-777777777777';
  expect((await call('review',{delivery_id:fresh,application_id:app,version:1,review_hash:hash,payload})).state).toBe('reviewed');
 });
 it('claims once and records a provider receipt idempotently',async()=>{
  expect((await review()).state).toBe('reviewed');expect((await review()).already_exists).toBe(true);
  expect((await call('handoff',{review_hash:hash,confirmed:true})).handoff).toBe(true);
  expect((await call('claim',{review_hash:hash,confirmed:true})).claimed).toBe(true);
  expect((await call('claim',{review_hash:hash,confirmed:true})).claimed).toBe(false);
  const receipt={provider:'gmail',connection_id:'one',from:'a@example.test',review_hash:hash,attachment_sha256:'b'.repeat(64),message_id:'fixture',sent_at:'2026-01-01T00:00:00Z'};
  expect((await call('receipt',{review_hash:hash,receipt})).state).toBe('host_reported_provider_acceptance');
  expect((await call('receipt',{review_hash:hash,receipt})).already_recorded).toBe(true);
  await expect(call('receipt',{review_hash:hash,receipt:{...receipt,message_id:'other'}})).rejects.toThrow();
 });
 it('does not reissue after uncertainty or accept a receipt before a claim',async()=>{
  await review();await expect(call('receipt',{review_hash:hash,receipt:{provider:'gmail',message_id:'x',sent_at:'today'}})).rejects.toThrow();
  await call('handoff',{review_hash:hash,confirmed:true});await call('claim',{review_hash:hash,confirmed:true});await call('uncertain',{review_hash:hash});
  expect((await call('claim',{review_hash:hash,confirmed:true})).claimed).toBe(false);
 });
 it('rejects changed review, other actor, revoked access and stale version',async()=>{
  await review(); await call('handoff',{review_hash:hash,confirmed:true}); await expect(call('review',{application_id:app,version:1,review_hash:hash,payload:{changed:true}})).rejects.toThrow();
  await db.exec(`SELECT set_config('test.actor','${other}',false)`);await expect(call('status')).rejects.toThrow();
  await db.exec(`SELECT set_config('test.actor','${actor}',false),set_config('test.scope','none',false)`);await expect(call('claim',{review_hash:hash,confirmed:true})).rejects.toThrow();
  await db.exec(`SELECT set_config('test.scope','full',false); INSERT INTO public.mcp_payment_application_versions VALUES('${app}','${job}',2,NULL)`);
  await expect(call('claim',{review_hash:hash,confirmed:true})).rejects.toThrow(/changed/);
 });
 it('denies direct table reads to authenticated users while allowing the scoped function',async()=>{
  await db.exec('SET ROLE authenticated');
  await expect(db.query('select * from public.mcp_document_email_deliveries')).rejects.toThrow(/permission denied/);
  expect((await review()).state).toBe('reviewed');
  await db.exec('RESET ROLE');
 });
 it('blocks a second operation for the same application while a handoff is unresolved',async()=>{
  await review(); await call('handoff',{review_hash:hash,confirmed:true});
  const second='77777777-7777-4777-8777-777777777777';
  await expect(call('review',{delivery_id:second,application_id:app,version:1,review_hash:hash,payload:{changed:true}})).rejects.toThrow();
  expect((await call('handoff',{review_hash:hash,confirmed:true})).handoff).toBe(false);
 });
 it('checks expiry against wall clock even within an older transaction',async()=>{
  await review();await call('handoff',{review_hash:hash,confirmed:true});
  await db.exec(`UPDATE public.mcp_document_email_deliveries SET expires_at=clock_timestamp()+interval '0.02 seconds' WHERE id='${id}'; BEGIN; SELECT pg_sleep(0.04)`);
  await expect(call('claim',{review_hash:hash,confirmed:true})).rejects.toThrow(/expired/);await db.exec('ROLLBACK');
 });
 it('does not treat a mismatched provider account or attachment as a receipt',async()=>{
  await review();await call('handoff',{review_hash:hash,confirmed:true});await call('claim',{review_hash:hash,confirmed:true});
  const receipt={provider:'gmail',connection_id:'other',from:'a@example.test',review_hash:hash,attachment_sha256:'b'.repeat(64),message_id:'x',sent_at:'2026-01-01T00:00:00Z'};
  await expect(call('receipt',{review_hash:hash,receipt})).rejects.toThrow(/does not match/);
  expect((await call('status')).state).toBe('claimed');
 });
 it('keeps the same logical review identity for edits before handoff and rejects edits afterward',async()=>{
  await review();const changed={email:{from:'a@example.test',attachment:{sha256:'b'.repeat(64)},body:'new'},mailbox:{provider:'gmail',connectionId:'one'}};
  expect((await call('review',{application_id:app,version:1,review_hash:'c'.repeat(64),expected_review_hash:hash,payload:changed})).state).toBe('reviewed');
  await expect(call('handoff',{review_hash:hash,confirmed:true})).rejects.toThrow(/changed/);
  await call('handoff',{review_hash:'c'.repeat(64),confirmed:true});
  await expect(call('review',{application_id:app,version:1,review_hash:'d'.repeat(64),expected_review_hash:'c'.repeat(64),payload:changed})).rejects.toThrow(/pending/);
 });
 it('refuses an old review revision after an intervening edit',async()=>{
  await review();const changed={email:{from:'a@example.test',attachment:{sha256:'b'.repeat(64)},cc:['new@example.test']},mailbox:{provider:'gmail',connectionId:'one'}};
  await call('review',{application_id:app,version:1,review_hash:'c'.repeat(64),expected_review_hash:hash,payload:changed});
  await expect(call('review',{application_id:app,version:1,review_hash:'d'.repeat(64),expected_review_hash:hash,payload:changed})).rejects.toThrow(/changed/);
  await expect(call('handoff',{review_hash:hash,confirmed:true})).rejects.toThrow(/changed/);
  expect((await call('handoff',{review_hash:'c'.repeat(64),confirmed:true})).handoff).toBe(true);
 });
 it('refuses moved company, missing actor, wrong job and anonymous RPC access',async()=>{
  await review();
  await expect(db.query('select public.mcp_document_email_delivery($1,$2,$3::jsonb)',[other,'status',JSON.stringify({delivery_id:id})])).rejects.toThrow();
  await db.exec(`UPDATE public.mcp_jobs SET company_id='${other}'`);await expect(call('status')).rejects.toThrow(/unavailable/);
  await db.exec(`UPDATE public.mcp_jobs SET company_id='${co}'; SELECT set_config('test.actor','',false)`);await expect(call('status')).rejects.toThrow(/access/);
  await db.exec('SET ROLE anon');await expect(call('status')).rejects.toThrow(/permission denied/);await db.exec('RESET ROLE');
 });
 it('replays the same normalized review without creating a second operation',async()=>{
  await review();const again=await review();expect(again.already_exists).toBe(true);expect(again.id).toBe(id);
 });
 it('ignores refreshed observation time but rejects changed content under the old hash',async()=>{
  const payload={email:{from:'a@example.test',attachment:{sha256:'b'.repeat(64)}},mailbox:{provider:'gmail',connectionId:'one',observedAt:10}};
  await call('review',{application_id:app,version:1,review_hash:hash,payload});
  expect((await call('review',{application_id:app,version:1,review_hash:hash,payload:{...payload,mailbox:{...payload.mailbox,observedAt:20}}})).already_exists).toBe(true);
  await expect(call('review',{application_id:app,version:1,review_hash:hash,payload:{...payload,email:{...payload.email,from:'other@example.test'}}})).rejects.toThrow(/different content/);
 });
 it('allows a new review after an unsent review expires, while preserving history',async()=>{
  await review();await db.exec(`UPDATE public.mcp_document_email_deliveries SET expires_at=clock_timestamp()-interval '1 second' WHERE id='${id}'`);
  const second='77777777-7777-4777-8777-777777777777';expect((await call('review',{delivery_id:second,application_id:app,version:1,review_hash:hash,payload:{email:{from:'a@example.test'}}})).state).toBe('reviewed');
  expect((await call('status')).state).toBe('cancelled');
 });
 it('allows explicit cancellation before claim and blocks a late host claim',async()=>{
  await review();await call('handoff',{review_hash:hash,confirmed:true});
  await expect(call('cancel',{review_hash:hash})).rejects.toThrow(/Confirm/);
  expect((await call('cancel',{review_hash:hash,confirmed:true})).state).toBe('cancelled');
  expect((await call('claim',{review_hash:hash,confirmed:true})).claimed).toBe(false);
 });
});
