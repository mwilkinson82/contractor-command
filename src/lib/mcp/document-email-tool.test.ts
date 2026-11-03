import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const state=vi.hoisted(()=>({scope:'full',row:null as any,version:1,brand:'Example Company'}));
vi.mock('./guard',()=>({run:async(_n:any,_c:any,_o:any,fn:any)=>fn({rpc:async(name:string,args:any)=>{
 if(name==='mcp_billing_evidence_record'){
  const {applicationFixture}=await import('../payment-applications/fixtures');const {calculateApplication}=await import('../payment-applications/model');const body=applicationFixture();
  return {data:{job:{number:'2701',name:'Synthetic'},selected:{application_id:args._p.id,version:args._p.version,latest_version:state.version,body,calculation:calculateApplication(body),recorded_at:'2026-02-01T12:00:00Z',history:[]}},error:null};
 }
 const p=args._p;if(args._action==='review'){state.row={id:p.delivery_id,state:'reviewed',application_id:p.application_id,version:p.version,review_hash:'f'.repeat(64),payload:{...p.payload,client_hash:p.client_hash}};return {data:state.row,error:null};}
 if(args._action==='status')return state.row?{data:state.row,error:null}:{data:null,error:{message:'MCP_BAD:Email review is unavailable.'}};
 if(args._action==='handoff'){if(state.row.state!=='reviewed')return {data:{state:state.row.state,handoff:false},error:null};state.row.state='handoff_pending';return {data:{state:'handoff_pending',handoff:true},error:null};}
 if(args._action==='claim'){if(state.row.state!=='handoff_pending')return {data:{state:state.row.state,claimed:false},error:null};const m=state.row.payload.mailbox,o=p.mailbox;if(!o||!o.mode)return {data:null,error:{message:'MCP_BAD:Refresh the explicit Gmail account observation.'}};if(m.mode!==o.mode||m.provider!==o.provider||m.profileAddress.toLowerCase()!==o.profileAddress.toLowerCase()||(m.mode==='pinned'&&m.connectionId!==o.connectionId)){state.row.state='cancelled';return {data:{state:'cancelled',claimed:false,reason:'account_mismatch'},error:null};}state.row.state='claimed';return {data:{state:'claimed',claimed:true},error:null};}
 if(args._action==='cancel'){if(state.row.state!=='reviewed'&&state.row.state!=='handoff_pending')return {data:null,error:{message:'MCP_BAD:This send may already have started; reconcile it first.'}};state.row.state='cancelled';return {data:state.row,error:null};}
 if(args._action==='uncertain'){state.row.state='uncertain';return {data:state.row,error:null};}
 if(args._action==='receipt'){state.row.state='host_reported_provider_acceptance';state.row.receipt=p.receipt;return {data:state.row,error:null};}
 throw Error('Unexpected RPC');
}}),text:(s:string)=>({content:[{type:'text',text:s}]}),dbError:(e:any)=>{throw Error(e.message)}}));
vi.mock('./document-email-brand',()=>({documentEmailBrand:async()=>({companyName:state.brand})}));
vi.mock('./jobs',()=>({resolveJob:async(_sb:any,job:string,company:string,scope:string)=>{if(state.scope!=='full'||job!=='2701'||company!=='company-a'||scope!=='full')throw Error('Job unavailable');return {job_id:'job-a',company_id:'company-a'}}}));
vi.mock('./visible',()=>({guide:(r:any)=>r}));
import { documentEmailDelivery, documentEmailMailboxSchema } from './tools/document-email-delivery';
const id='66666666-6666-4666-8666-666666666666',app='55555555-5555-4555-8555-555555555555';
const mailbox=()=>({mode:'pinned' as const,provider:'gmail',connectionId:'one',profileAddress:'owner@example.test',observedAt:Date.now(),canSendMime:true});
const draft={from:'owner@example.test',to:'contact@example.test',cc:[],subject:'Pay app',body:'Please review.'};
const call=(v:any)=>(documentEmailDelivery as any).handler({job_number:'2701',company_id:'company-a',delivery_id:id,review_hash:state.row?.review_hash,...v},{});
describe('document email MCP handoff',()=>{
 it('accepts only explicit observed Gmail or an existing pinned connection shape',()=>{
  const observed={mode:'assistant_current_gmail',provider:'gmail',profileAddress:'owner@example.test',observedAt:Date.now(),canSendMime:true};
  expect(documentEmailMailboxSchema.safeParse(observed).success).toBe(true);
  expect(documentEmailMailboxSchema.safeParse(mailbox()).success).toBe(true);
  expect(documentEmailMailboxSchema.safeParse({...mailbox(),mode:'pinned'}).success).toBe(true);
  expect(documentEmailMailboxSchema.safeParse({...observed,connectionId:'invented'}).success).toBe(false);
  expect(documentEmailMailboxSchema.safeParse({...observed,provider:'outlook'}).success).toBe(false);
  const {mode:_mode,...missingId}=observed;expect(documentEmailMailboxSchema.safeParse(missingId).success).toBe(false);
  const {mode:_pinnedMode,...implicitPinned}=mailbox();expect(documentEmailMailboxSchema.safeParse(implicitPinned).success).toBe(false);
  expect(JSON.stringify(z.toJSONSchema(documentEmailMailboxSchema))).toContain('assistant_current_gmail');
 });
 it('reviews, issues one MIME claim, and records only a reported receipt',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;
  const review=await call({action:'review',document_id:app,version:1,draft,mailbox:mailbox()});expect(review.structuredContent.document_email.state).toBe('reviewed');expect(review.structuredContent.sent).toBe(false);
  await call({action:'handoff',confirmed:true});const claim=await call({action:'claim',confirmed:true,mailbox:mailbox()});expect(claim.structuredContent.claimed).toBe(true);expect(claim.structuredContent.mime.payload.parts[1].mime_type).toBe('application/pdf');expect(claim.structuredContent.connection_id).toBe('one');expect(claim.structuredContent.review_hash).toBe(state.row.review_hash);expect(claim.structuredContent.attachment_sha256).toBe(state.row.payload.email.attachment.sha256);expect(JSON.stringify(claim.structuredContent.assistant_guidance)).not.toContain('email_confirm_send');
  const replay=await call({action:'claim',confirmed:true,mailbox:mailbox()});expect(replay.structuredContent.send_allowed).toBe(false);
  const sent=await call({action:'receipt',receipt:{binding_mode:'pinned',provider:'gmail',connection_id:'one',from:'owner@example.test',review_hash:state.row.review_hash,attachment_sha256:state.row.payload.email.attachment.sha256,message_id:'synthetic',sent_at:'2026-01-01T00:00:00Z'}});expect(sent.structuredContent.state).toBe('host_reported_provider_acceptance');expect(sent.content[0].text).toContain('reported by the assistant');
 });
 it('makes clear that an uncertain provider outcome may already have sent the email',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;
  await call({action:'review',document_id:app,version:1,draft,mailbox:mailbox()});
  await call({action:'handoff',confirmed:true});await call({action:'claim',confirmed:true,mailbox:mailbox()});
  const uncertain=await call({action:'uncertain'});
  expect(uncertain.structuredContent.state).toBe('uncertain');
  expect(uncertain.content[0].text).toMatch(/may have been sent.*check the connected account/i);
  expect(uncertain.content[0].text).not.toMatch(/no new email was sent/i);
 });
 it('binds an observed Gmail sender without a fabricated connection ID and requires a fresh recheck',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;
  const observed=()=>({mode:'assistant_current_gmail',provider:'gmail',profileAddress:'owner@example.test',observedAt:Date.now(),canSendMime:true});
  const review=await call({action:'review',document_id:app,version:1,draft,mailbox:observed()});
  expect(review.structuredContent.document_email.mailbox).not.toHaveProperty('connectionId');
  expect(state.row.payload.mailbox).toMatchObject({mode:'assistant_current_gmail',provider:'gmail'});
  expect(state.row.payload.mailbox).not.toHaveProperty('connectionId');
  await call({action:'handoff',confirmed:true});
  await expect(call({action:'claim',confirmed:true,mailbox:{...observed(),observedAt:Date.now()-31000}})).rejects.toThrow(/refresh/);
  expect(state.row.state).toBe('handoff_pending');
  const claimed=await call({action:'claim',confirmed:true,mailbox:observed()});
  expect(claimed.structuredContent.binding_mode).toBe('assistant_current_gmail');
  expect(claimed.structuredContent).not.toHaveProperty('connection_id');
  expect(claimed.structuredContent.mime.from_address).toBe('owner@example.test');
  expect(JSON.stringify(claimed.structuredContent.assistant_guidance)).toMatch(/Immediately before the single send.*not atomically pinned/i);
  expect(JSON.stringify(claimed.structuredContent.assistant_guidance)).toMatch(/read the sent message by that ID.*attachment hash/i);
  expect((await call({action:'claim',confirmed:true,mailbox:observed()})).structuredContent.send_allowed).toBe(false);
  const receipt={binding_mode:'assistant_current_gmail',provider:'gmail',from:'owner@example.test',review_hash:state.row.review_hash,attachment_sha256:state.row.payload.email.attachment.sha256,message_id:'synthetic',sent_at:'2026-01-01T00:00:00Z'};
  await expect(call({action:'receipt',receipt:{...receipt,connection_id:'invented'}})).rejects.toThrow(/account mode/);
  const result=await call({action:'receipt',receipt});expect(result.structuredContent.state).toBe('host_reported_provider_acceptance');
  expect(result.content[0].text).toMatch(/reported by the assistant.*not verified/i);
 });
 it.each([
  ['a different observed sender',()=>({mode:'assistant_current_gmail',provider:'gmail',profileAddress:'other@example.test',observedAt:Date.now(),canSendMime:true})],
  ['a different account-binding mode',()=>mailbox()],
 ])('invalidates an observed approval when the refreshed account is %s',async(_label,changed)=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;
  const observed={mode:'assistant_current_gmail',provider:'gmail',profileAddress:'owner@example.test',observedAt:Date.now(),canSendMime:true};
  await call({action:'review',document_id:app,version:1,draft,mailbox:observed});await call({action:'handoff',confirmed:true});
  await expect(call({action:'claim',confirmed:true,mailbox:changed()})).rejects.toThrow(/prior approval was cancelled/i);
  expect(state.row.state).toBe('cancelled');
  expect((await call({action:'claim',confirmed:true,mailbox:{...observed,observedAt:Date.now()}})).structuredContent.send_allowed).toBe(false);
 });
 it('keeps a connection ID mandatory for pinned-mode receipts',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;
  await call({action:'review',document_id:app,version:1,draft,mailbox:mailbox()});await call({action:'handoff',confirmed:true});await call({action:'claim',confirmed:true,mailbox:mailbox()});
  const receipt={binding_mode:'pinned',provider:'gmail',from:'owner@example.test',review_hash:state.row.review_hash,attachment_sha256:state.row.payload.email.attachment.sha256,message_id:'synthetic',sent_at:'2026-01-01T00:00:00Z'};
  await expect(call({action:'receipt',receipt})).rejects.toThrow(/reviewed connection/);
 });
 it('reports an already accepted outcome before checking sender freshness or the kill switch',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;
  const observed={mode:'assistant_current_gmail',provider:'gmail',profileAddress:'owner@example.test',observedAt:Date.now(),canSendMime:true};
  await call({action:'review',document_id:app,version:1,draft,mailbox:observed});await call({action:'handoff',confirmed:true});await call({action:'claim',confirmed:true,mailbox:observed});
  await call({action:'receipt',receipt:{binding_mode:'assistant_current_gmail',provider:'gmail',from:'owner@example.test',review_hash:state.row.review_hash,attachment_sha256:state.row.payload.email.attachment.sha256,message_id:'synthetic',sent_at:'2026-01-01T00:00:00Z'}});
  vi.stubEnv('ATHENA_OUTBOUND_EMAIL_DISABLED','true');
  try{
   const replay=await call({action:'claim',confirmed:true,mailbox:{...observed,profileAddress:'other@example.test',observedAt:0}});
   expect(replay.structuredContent.state).toBe('host_reported_provider_acceptance');expect(replay.structuredContent.send_allowed).toBe(false);
   expect(replay.content[0].text).toMatch(/reported by the assistant.*not verified/i);
   expect(replay.structuredContent).not.toHaveProperty('mime');
  }finally{vi.unstubAllEnvs()}
 });
 it('stops before claim when the sender, access or version changes',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;await call({action:'review',document_id:app,version:1,draft,mailbox:mailbox()});await call({action:'handoff',confirmed:true});
  await expect(call({action:'claim',confirmed:true,mailbox:{...mailbox(),connectionId:'two'}})).rejects.toThrow(/prior approval was cancelled/);expect(state.row.state).toBe('cancelled');
  state.row=null;await call({action:'review',document_id:app,version:1,draft,mailbox:mailbox()});await call({action:'handoff',confirmed:true});
  state.brand='Changed Company';await expect(call({action:'claim',confirmed:true,mailbox:mailbox()})).rejects.toThrow(/bytes|changed|does not match/);expect(state.row.state).toBe('handoff_pending');state.brand='Example Company';
  state.version=2;await expect(call({action:'claim',confirmed:true,mailbox:mailbox()})).rejects.toThrow(/newer/);expect(state.row.state).toBe('handoff_pending');
  state.scope='none';await expect(call({action:'status'})).rejects.toThrow(/unavailable/);state.scope='full';state.version=1;
 });
 it('honors the outbound kill switch for both review and claim',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;
  vi.stubEnv('ATHENA_OUTBOUND_EMAIL_DISABLED','true');
  try {
   const r=await call({action:'review',document_id:app,version:1,draft,mailbox:mailbox()});
   expect(r.structuredContent.send_allowed).toBe(false);expect(state.row).toBeNull();
   vi.stubEnv('ATHENA_OUTBOUND_EMAIL_DISABLED','false');await call({action:'review',document_id:app,version:1,draft,mailbox:mailbox()});await call({action:'handoff',confirmed:true});
   vi.stubEnv('ATHENA_OUTBOUND_EMAIL_DISABLED','true');await expect(call({action:'claim',confirmed:true,mailbox:mailbox()})).rejects.toThrow(/turned off/);expect(state.row.state).toBe('handoff_pending');
  } finally {vi.unstubAllEnvs()}
 });
 it('stores stable mailbox identity without a volatile observation timestamp',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;
  await call({action:'review',document_id:app,version:1,draft,mailbox:mailbox()});
  expect(state.row.payload.mailbox).toMatchObject({connectionId:'one',profileAddress:'owner@example.test'});expect(state.row.payload.mailbox).not.toHaveProperty('observedAt');
 });
 it('accepts a fresh account observation after a stale one without treating it as a new sender',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;
  await expect(call({action:'review',document_id:app,version:1,draft,mailbox:{...mailbox(),observedAt:Date.now()-360000}})).rejects.toThrow(/refresh/);
  const fresh=await call({action:'review',document_id:app,version:1,draft,mailbox:mailbox()});expect(fresh.structuredContent.document_email.state).toBe('reviewed');
 });
 it('offers draft only for an unsupported provider',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;
  const r=await call({action:'review',document_id:app,version:1,draft,mailbox:{...mailbox(),provider:'outlook'}});
  expect(r.structuredContent.send_allowed).toBe(false);expect(state.row).toBeNull();
 });
});
