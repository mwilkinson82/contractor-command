import { describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({scope:'full',row:null as any,version:1,brand:'Example Company'}));
vi.mock('./guard',()=>({run:async(_n:any,_c:any,_o:any,fn:any)=>fn({rpc:async(name:string,args:any)=>{
 if(name==='mcp_billing_evidence_record'){
  const {applicationFixture}=await import('../payment-applications/fixtures');const {calculateApplication}=await import('../payment-applications/model');const body=applicationFixture();
  return {data:{job:{number:'2701',name:'Synthetic'},selected:{application_id:args._p.id,version:args._p.version,latest_version:state.version,body,calculation:calculateApplication(body),recorded_at:'2026-02-01T12:00:00Z',history:[]}},error:null};
 }
 const p=args._p;if(args._action==='review'){state.row={id:p.delivery_id,state:'reviewed',application_id:p.application_id,version:p.version,review_hash:p.review_hash,payload:p.payload};return {data:state.row,error:null};}
 if(args._action==='status')return state.row?{data:state.row,error:null}:{data:null,error:{message:'MCP_BAD:Email review is unavailable.'}};
 if(args._action==='handoff'){if(state.row.state!=='reviewed')return {data:{state:state.row.state,handoff:false},error:null};state.row.state='handoff_pending';return {data:{state:'handoff_pending',handoff:true},error:null};}
 if(args._action==='claim'){if(state.row.state!=='handoff_pending')return {data:{state:state.row.state,claimed:false},error:null};state.row.state='claimed';return {data:{state:'claimed',claimed:true},error:null};}
 if(args._action==='uncertain'){state.row.state='uncertain';return {data:state.row,error:null};}
 if(args._action==='receipt'){state.row.state='host_reported_provider_acceptance';state.row.receipt=p.receipt;return {data:state.row,error:null};}
 throw Error('Unexpected RPC');
}}),text:(s:string)=>({content:[{type:'text',text:s}]}),dbError:(e:any)=>{throw Error(e.message)}}));
vi.mock('./document-email-brand',()=>({documentEmailBrand:async()=>({companyName:state.brand})}));
vi.mock('./jobs',()=>({resolveJob:async(_sb:any,job:string,company:string,scope:string)=>{if(state.scope!=='full'||job!=='2701'||company!=='company-a'||scope!=='full')throw Error('Job unavailable');return {job_id:'job-a',company_id:'company-a'}}}));
vi.mock('./visible',()=>({guide:(r:any)=>r}));
import { documentEmailDelivery } from './tools/document-email-delivery';
const id='66666666-6666-4666-8666-666666666666',app='55555555-5555-4555-8555-555555555555';
const mailbox=()=>({provider:'gmail',connectionId:'one',profileAddress:'owner@example.test',observedAt:Date.now(),canSendMime:true});
const draft={from:'owner@example.test',to:'contact@example.test',cc:[],subject:'Pay app',body:'Please review.'};
const call=(v:any)=>(documentEmailDelivery as any).handler({job_number:'2701',company_id:'company-a',delivery_id:id,review_hash:state.row?.review_hash,...v},{});
describe('document email MCP handoff',()=>{
 it('reviews, issues one MIME claim, and records only a reported receipt',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;
  const review=await call({action:'review',document_id:app,version:1,draft,mailbox:mailbox()});expect(review.structuredContent.document_email.state).toBe('reviewed');expect(review.structuredContent.sent).toBe(false);
  await call({action:'handoff',confirmed:true});const claim=await call({action:'claim',confirmed:true,mailbox:mailbox()});expect(claim.structuredContent.claimed).toBe(true);expect(claim.structuredContent.mime.payload.parts[1].mime_type).toBe('application/pdf');expect(claim.structuredContent.connection_id).toBe('one');expect(claim.structuredContent.review_hash).toBe(state.row.review_hash);expect(claim.structuredContent.attachment_sha256).toBe(state.row.payload.email.attachment.sha256);expect(JSON.stringify(claim.structuredContent.assistant_guidance)).not.toContain('email_confirm_send');
  const replay=await call({action:'claim',confirmed:true,mailbox:mailbox()});expect(replay.structuredContent.send_allowed).toBe(false);
  const sent=await call({action:'receipt',receipt:{provider:'gmail',connection_id:'one',from:'owner@example.test',review_hash:state.row.review_hash,attachment_sha256:state.row.payload.email.attachment.sha256,message_id:'synthetic',sent_at:'2026-01-01T00:00:00Z'}});expect(sent.structuredContent.state).toBe('host_reported_provider_acceptance');expect(sent.content[0].text).toContain('reported by the assistant');
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
 it('stops before claim when the sender, access or version changes',async()=>{
  state.scope='full';state.version=1;state.brand='Example Company';state.row=null;await call({action:'review',document_id:app,version:1,draft,mailbox:mailbox()});
  await expect(call({action:'claim',confirmed:true,mailbox:{...mailbox(),connectionId:'two'}})).rejects.toThrow(/changed/);expect(state.row.state).toBe('reviewed');
  state.brand='Changed Company';await expect(call({action:'claim',confirmed:true,mailbox:mailbox()})).rejects.toThrow(/bytes|changed|does not match/);expect(state.row.state).toBe('reviewed');state.brand='Example Company';
  state.version=2;await expect(call({action:'claim',confirmed:true,mailbox:mailbox()})).rejects.toThrow(/newer/);expect(state.row.state).toBe('reviewed');
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
