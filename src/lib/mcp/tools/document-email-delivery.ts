import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { run, dbError, text, type Sb } from '../guard';
import { resolveJob } from '../jobs';
import { outboundEmailDisabled } from '../email-safety';
import { paymentApplicationArtifact } from '../document-email-artifact';
import { documentEmailBrand } from '../document-email-brand';
import { gmailMimeRequest, hostReviewHash, type HostMailbox } from '../document-email-host';
import type { ReviewedEmail } from '../document-email-delivery';
import type { ApplicationContext } from '../../payment-applications/workflow';

const mailboxBase=z.object({provider:z.string().min(1).max(80),profileAddress:z.string().email().max(320),observedAt:z.number().finite(),canSendMime:z.boolean()});
export const documentEmailMailboxSchema=z.union([
 mailboxBase.extend({mode:z.literal('pinned').optional(),connectionId:z.string().min(1).max(200)}).strict(),
 mailboxBase.extend({mode:z.literal('assistant_current_gmail'),provider:z.literal('gmail')}).strict(),
]);
const draftSchema=z.object({from:z.string().email().max(320),to:z.string().email().max(320),cc:z.array(z.string().email().max(320)).max(20),subject:z.string().trim().min(1).max(300),body:z.string().min(1).max(20000)}).strict();
const receiptSchema=z.object({provider:z.string().min(1).max(80),connection_id:z.string().min(1).max(200).optional(),from:z.string().email().max(320),review_hash:z.string().regex(/^[a-f0-9]{64}$/),attachment_sha256:z.string().regex(/^[a-f0-9]{64}$/),message_id:z.string().min(1).max(500),sent_at:z.string().datetime()}).strict();

export const documentEmailDelivery=defineTool({
 name:'document_email_delivery',title:'Review and send a saved document through your email',
 description:'Reviews a saved payment application email, issues one send claim after confirmation, and records a host-reported provider receipt. Uses the member’s connected email account; Athena does not send email. Gmail assistant_current_gmail mode requires fresh current-profile observations and has no atomic account pinning; never invent a connection ID.',
 inputSchema:{action:z.enum(['review','handoff','claim','status','receipt','uncertain','cancel']),job_number:z.string().trim().min(1).max(40),company_id:z.string().trim().min(1).max(200).optional(),delivery_id:z.string().uuid(),document_id:z.string().uuid().optional(),version:z.number().int().positive().optional(),draft:draftSchema.optional(),mailbox:documentEmailMailboxSchema.optional(),receipt:receiptSchema.optional(),review_hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),confirmed:z.literal(true).optional()},
 annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},
 handler:(a,ctx)=>run('document_email_delivery',ctx,{jobNumber:a.job_number,companyId:a.company_id},async(sb)=>{
  const job=await resolveJob(sb as Sb,a.job_number,a.company_id,'full');
  const call=async(action:string,p:Record<string,unknown>)=>{const r=await (sb as Sb).rpc('mcp_document_email_delivery',{_job:job.job_id,_action:action,_p:{delivery_id:a.delivery_id,...p}});if(r.error)dbError(r.error);return r.data as any};
  const artifact=async(id:string,version:number)=>{const r=await (sb as Sb).rpc('mcp_billing_evidence_record',{_job:job.job_id,_action:'payment_application_read',_p:{id,version}});if(r.error)dbError(r.error);const brand=await documentEmailBrand(sb as Sb,job.company_id);return paymentApplicationArtifact({companyId:job.company_id,jobId:job.job_id,applicationId:id,version,allowHistorical:false,context:r.data as ApplicationContext,brand});};
  const outcome=(r:any)=>({...text(r.state==='host_reported_provider_acceptance'?'Provider acceptance was reported by the assistant. Recipient delivery is not verified.':r.state==='cancelled'?'This operation was cancelled before sending.':r.state==='reviewed'?'This review awaits confirmation.':'This operation may have been sent. Check its status before another attempt.'),structuredContent:{id:r.id,state:r.state,receipt:r.receipt??null,send_allowed:false}});
  try {
   if(a.action==='review'){
    if(!a.document_id||!a.version||!a.draft||!a.mailbox)throw new ToolError('Choose the saved application, recipient and connected email account.');
    let prior:any=null;try{prior=await call('status',{})}catch(e){const message=e instanceof Error?e.message:'';if(message!=='Email review is unavailable.'&&message!=='MCP_BAD:Email review is unavailable.')throw e;}
    if(prior && prior.state!=='reviewed')return outcome(prior);
    const file=await artifact(a.document_id,a.version), {content_base64:_bytes,latest_version:_latest,...attachment}=file;
    const email:ReviewedEmail={...a.draft,company_id:job.company_id,job_id:job.job_id,attachment};
    const supported=a.mailbox.provider==='gmail' && a.mailbox.canSendMime;
    if(!supported || outboundEmailDisabled()){ return {...text('Sending is unavailable for this account or is turned off. Check the operation status before retrying.'),structuredContent:{draft:{...a.draft,attachment:file.filename,link:null},document_email:{id:a.delivery_id,version:file.version,from:a.mailbox.profileAddress,state:'draft',mailbox:a.mailbox,document_id:a.document_id},job_number:a.job_number,company_id:a.company_id??null,send_allowed:false}}; }
    const reviewHash=await hostReviewHash(email,file,a.mailbox as HostMailbox);
    const storedMailbox=a.mailbox.mode==='assistant_current_gmail'
     ?{provider:'gmail',mode:'assistant_current_gmail',profileAddress:a.mailbox.profileAddress,canSendMime:a.mailbox.canSendMime}
     :{provider:a.mailbox.provider,connectionId:a.mailbox.connectionId,profileAddress:a.mailbox.profileAddress,canSendMime:a.mailbox.canSendMime};
    const stored=await call('review',{application_id:a.document_id,version:a.version,review_hash:reviewHash,...(a.review_hash?{expected_review_hash:a.review_hash}:{}),payload:{email,mailbox:storedMailbox}});
    if(stored.state!=='reviewed')return outcome(stored);
    return {...text('Review the sender, recipient, message and saved attachment. Nothing has been sent.'),structuredContent:{draft:{...a.draft,attachment:file.filename,link:null},document_email:{id:a.delivery_id,review_hash:reviewHash,version:file.version,sha256:file.sha256,size_bytes:file.size_bytes,from:a.mailbox.profileAddress,state:stored.state,mailbox:a.mailbox,document_id:a.document_id},job_number:a.job_number,company_id:a.company_id??null,send_allowed:stored.state==='reviewed'&&!outboundEmailDisabled(),sent:false,assistant_guidance:['Show the editable review card. Refresh the connected account before claiming. Send only after explicit confirmation and a single document email claim.']}};
   }
   const existing=await call('status',{});
   if(a.action==='status')return outcome(existing);
   if(!a.review_hash)throw new ToolError('The displayed review is missing. Refresh and review the email again.');
   if(a.action==='handoff'){
    if(existing.state!=='reviewed')return outcome(existing);
    if(outboundEmailDisabled())throw new ToolError('Sending email is turned off. Check the operation status before retrying.');
    if(a.confirmed!==true)throw new ToolError('Confirm the reviewed email first.');
    const result=await call('handoff',{review_hash:a.review_hash,confirmed:true});
    return {...text(result.handoff?'Review confirmed; awaiting account and provider.':'This review is already pending. Check its status.'),structuredContent:result};
   }
   if(a.action==='claim'){
    if(existing.state!=='handoff_pending')return outcome(existing);
    if(outboundEmailDisabled())throw new ToolError('Sending email is turned off. Check the operation status before retrying.');
    if(a.confirmed!==true||!a.mailbox)throw new ToolError('Confirm the reviewed email and refresh the connected sender.');
    const file=await artifact(existing.application_id,existing.version), email=existing.payload.email as ReviewedEmail;
    if(existing.payload?.mailbox?.mode==='assistant_current_gmail' &&
      (a.mailbox.mode!=='assistant_current_gmail'||a.mailbox.profileAddress.toLowerCase()!==email.from.toLowerCase())){
     if(existing.state==='reviewed'||existing.state==='handoff_pending')
      await call('cancel',{review_hash:a.review_hash,confirmed:true});
     throw new ToolError('The Gmail account changed. The prior approval cannot be used; review the email again.');
    }
    const input={email,artifact:file,mailbox:a.mailbox as HostMailbox,confirmedHash:a.review_hash,confirmed:true};
    const mime=await gmailMimeRequest(input);
    if(outboundEmailDisabled())throw new ToolError('Sending email is turned off. Check the operation status before retrying.');
    const result=await call('claim',{review_hash:a.review_hash,confirmed:true});
    if(!result.claimed)return {...text('This email was already claimed or completed. Reconcile the provider before any retry.'),structuredContent:{...result,send_allowed:false}};
    const observed=a.mailbox.mode==='assistant_current_gmail';
    return {...text(observed?'The reviewed email is claimed once. The assistant must recheck the current Gmail profile before sending; the account is not pinned.':'The reviewed email is claimed once. Waiting for provider acceptance.'),structuredContent:{delivery_id:a.delivery_id,claimed:true,send_allowed:true,mime,review_hash:a.review_hash,attachment_sha256:email.attachment.sha256,...(a.mailbox.mode==='assistant_current_gmail'?{}:{connection_id:a.mailbox.connectionId}),binding_mode:observed?'assistant_current_gmail':'pinned',from:a.mailbox.profileAddress,provider:a.mailbox.provider,assistant_guidance:observed?['Immediately before the single send, read the current Gmail profile again and compare its email with the reviewed From address. If unavailable or different, do not send; reconcile this claim. The account is not atomically pinned. Use the exact MIME once only if the profile still matches. On uncertainty mark uncertain and reconcile before retry. Record only the actual provider response with its message ID and returned binding fields; omit connection_id. If the connected tool allows, read the sent message by that ID and verify sender, recipients and attachment hash. A missing readback does not prove the message was not sent; do not resend or claim recipient delivery.']:['Use the exact MIME arguments once with the selected connected account. On uncertainty mark uncertain and reconcile before retry. Record only an actual provider response with its message ID and the returned binding fields.']}};
   }
   if(a.action==='receipt'){
    if(!a.receipt)throw new ToolError('A provider receipt is required.');
    const storedMailbox=existing.payload?.mailbox;
    if(storedMailbox?.mode==='assistant_current_gmail'){
     if(storedMailbox.provider!=='gmail'||a.receipt.connection_id!==undefined)throw new ToolError('The receipt does not match the reviewed account mode.');
    }else if(!a.receipt.connection_id||a.receipt.connection_id!==storedMailbox?.connectionId){
     throw new ToolError('The receipt does not match the reviewed connection.');
    }
   }
   const result=await call(a.action,{review_hash:a.review_hash,...(a.confirmed?{confirmed:true}:{}),...(a.receipt?{receipt:a.receipt}:{})});
   const statusText=result.state==='host_reported_provider_acceptance'
    ?'Provider acceptance was reported by the assistant; recipient delivery is not verified.'
    :result.state==='uncertain'
     ?'The provider outcome is uncertain. This email may have been sent; check the connected account before another attempt.'
     :result.state==='cancelled'
      ?'This operation was cancelled before a send claim.'
      :'Athena updated the status and did not send email.';
   return {...text(`Email status: ${result.state}. ${statusText}`),structuredContent:result};
  }catch(e){if(e instanceof ToolError)throw e;throw new ToolError(e instanceof Error?e.message:'The document email is unavailable.');}
 })
});
