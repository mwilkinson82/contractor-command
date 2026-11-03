import { describe, expect, it, vi } from 'vitest';
const jobId='10000000-0000-4000-8000-000000000001', appId='20000000-0000-4000-8000-000000000002';
const link=`https://app.meetathena.io/r/job/${jobId}/payment-applications?application_id=${appId}&version=3`;
const state=vi.hoisted(()=>({job:'10000000-0000-4000-8000-000000000001',rpcs:[] as string[]}));
vi.mock('./guard', () => ({
  run: async (_t: unknown, _c: unknown, _o: unknown, f: (sb: unknown) => unknown) => f({
    rpc: async (name: string) => { state.rpcs.push(name); return { data: null, error: null }; },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  }),
  text: (text: string) => ({ content: [{ type: 'text', text }] }), dbError: () => {},
}));
vi.mock('./jobs',()=>({resolveJob:async()=>({job_id:state.job,company_id:'synthetic-company',scope:'full'})}));
vi.mock('./people',()=>({whoForJob:async()=>()=> 'unknown'}));
vi.mock('./visible',()=>({guide:(r:Record<string,unknown>,...guidance:string[])=>({...r,guidance})}));
import { paymentEmailRoute, explicitPaymentLinkFallback, EMAIL_CONFIRMATION_SURFACE_RULE } from './payment-email-route';
import { emailDraft, emailConfirmSend } from './tools/email-tools';
const call=(tool:any,args:Record<string,unknown>)=>tool.handler(args,{authInfo:{token:'synthetic'}});
const args={job_number:'SYN-03',to:'owner@example.invalid',subject:'November pay app',body:`Review the PDF:\n${link}&download=pdf`,link};
describe('saved payment application email routing',()=>{
 it('deduplicates view and download references for the exact saved version',()=>{expect(paymentEmailRoute(link,args.body)).toEqual({kind:'saved',reference:{job_id:jobId,application_id:appId,version:3}})});
 it('clarifies missing versions and conflicting references',()=>{expect(paymentEmailRoute(link.replace('&version=3',''))).toEqual({kind:'clarify'});expect(paymentEmailRoute(link,link.replace('version=3','version=4'))).toEqual({kind:'clarify'})});
 it('keeps other files on their existing general email path',()=>{expect(paymentEmailRoute('https://app.meetathena.io/f/synthetic')).toEqual({kind:'none'});expect(explicitPaymentLinkFallback({delivery_mode:'link'})).toBe(false)});
 it('redirects the actual legacy draft call without approving or invoking a backend mutation',async()=>{state.rpcs=[];const r=await call(emailDraft,args);expect(r.structuredContent).toMatchObject({attachment_review_required:true,next_tool:'payment_application_read',then_tool:'document_email_delivery',sent:false,send_allowed:false,application_reference:{application_id:appId,version:3}});expect(r.structuredContent.draft).toBeUndefined();expect(state.rpcs).toEqual([])});
 it('refuses a mismatched job even for link-only fallback',async()=>{state.job='30000000-0000-4000-8000-000000000003';try{await expect(call(emailDraft,{...args,delivery_mode:'link',fallback_reason:'member_requested_link'})).rejects.toThrow('different job')}finally{state.job=jobId}});
 it('refuses the old approval path for a saved PDF without deliberate fallback',async()=>{await expect(call(emailConfirmSend,{...args,confirmed:true,draft_key:'DAAAA0001'})).rejects.toThrow('document_email_delivery')});
 it('retains an explicit disclosed link fallback and exact-draft confirmation',async()=>{state.rpcs=[];const fallback={...args,delivery_mode:'link',fallback_reason:'member_requested_link'};const r=await call(emailDraft,fallback);expect(r.structuredContent).toMatchObject({delivery_kind:'link_only',link_fallback:{reason:'member_requested_link'},sent:false,requires_confirm:true});expect(r.structuredContent.draft.attachment).toBeNull();const approved=await call(emailConfirmSend,{...fallback,draft_key:r.structuredContent.draft_key,confirmed:true});expect(approved.structuredContent.send_confirmed).toBe(true);expect(approved.structuredContent.sent_by_athena).toBe(false);await expect(call(emailConfirmSend,{...fallback,draft_key:'DAAAA0001',confirmed:true})).rejects.toThrow('changed');expect(state.rpcs).toEqual([])});
 it('preserves required provider permissions and chooses one Athena surface',()=>{expect(EMAIL_CONFIRMATION_SURFACE_RULE).toContain('do not add another yes/no');expect(EMAIL_CONFIRMATION_SURFACE_RULE).toContain('required connected-provider permission');expect(explicitPaymentLinkFallback({delivery_mode:'link',fallback_reason:'member_requested_link'})).toBe(true)});
});
