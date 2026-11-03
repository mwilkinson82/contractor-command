import { describe, expect, it, vi } from "vitest";
import { applicationFixture } from "../payment-applications/fixtures";
import { calculateApplication } from "../payment-applications/model";
import { paymentApplicationArtifact } from "./document-email-artifact";
import { reviewEmail, sendReviewedEmail, type Delivery, type DeliveryRepository } from "./document-email-delivery";
async function fixture() {
  const id="00000000-0000-4000-8000-000000000002",body=applicationFixture();
  const artifact=await paymentApplicationArtifact({companyId:"company-a",jobId:"job-a",applicationId:id,version:1,allowHistorical:false,context:{job:{number:"1",name:"Fictional"},currency:"USD",snapshot:body.snapshot,evidence:[],applications:[],selected:{application_id:id,version:1,latest_version:1,body,calculation:calculateApplication(body),billing_version:null,recorded_at:"2026-02-01T12:00:00Z",history:[]}}});
  const {content_base64:_content,latest_version:_latest,...attachment}=artifact;
  const email={company_id:"company-a",job_id:"job-a",from:"owner@example.test",to:"contact@example.test",cc:["pm@example.test"],subject:"Payment application",body:"Please review.",attachment};
  const hash=await reviewEmail(email,artifact);
  const row:Delivery={id:"request-a",actor_id:"actor-a",email,review_hash:hash,state:"reviewed",receipt:null};
  const repository:DeliveryRepository={
    async claim(i,a,h){if(i!==row.id||a!==row.actor_id||h!==row.review_hash)return "mismatch";if(row.state==="sent")return "sent";if(row.state!=="reviewed")return "pending";row.state="sending";return "claimed"},
    async get(i,a){return i===row.id&&a===row.actor_id?row:null},
    async finish(_i,_a,_h,receipt){row.state="sent";row.receipt=receipt},
    async uncertain(){row.state="uncertain"},
  };
  const provider=vi.fn(async()=>({provider:"fixture",message_id:"msg-1",sent_at:"2026-02-01T12:01:00Z"}));
  const input={repository,deliveryId:row.id,actorId:row.actor_id,email,artifact,confirmedHash:hash,confirmed:true as const,ensureCurrentAccessVersionAndSender:async()=>{},provider};
  return {input,row,provider,email,artifact,hash};
}
describe("review-bound document email protocol",()=>{
  it("binds sender, recipients, body, exact document metadata and actual bytes",async()=>{
    const f=await fixture();
    for (const modified of [{...f.email,from:"other@example.test"},{...f.email,to:"other@example.test"},{...f.email,cc:[]},{...f.email,body:"changed"}])
      await expect(sendReviewedEmail({...f.input,email:modified})).rejects.toThrow(/changed/);
    await expect(reviewEmail(f.email,{...f.artifact,content_base64:btoa("different")})).rejects.toThrow(/bytes/);
    await expect(reviewEmail({...f.email,job_id:"another"},f.artifact)).rejects.toThrow(/match/);
    expect(f.provider).not.toHaveBeenCalled();
  });
  it("records a provider receipt before declaring sent and replays without another send",async()=>{
    const f=await fixture();expect((await sendReviewedEmail(f.input)).status).toBe("sent");expect(f.row.receipt?.message_id).toBe("msg-1");
    expect((await sendReviewedEmail(f.input)).status).toBe("already_sent");expect(f.provider).toHaveBeenCalledTimes(1);
  });
  it("does not retry after an ambiguous provider outcome",async()=>{
    const f=await fixture();f.provider.mockRejectedValueOnce(new Error("connection lost"));
    expect((await sendReviewedEmail(f.input)).status).toBe("uncertain");expect(f.row.state).toBe("uncertain");
    expect((await sendReviewedEmail(f.input)).status).toBe("uncertain");expect(f.provider).toHaveBeenCalledTimes(1);
  });
  it("uses the atomic claim to avoid concurrent duplicate provider calls",async()=>{
    const f=await fixture();const results=await Promise.all([sendReviewedEmail(f.input),sendReviewedEmail(f.input)]);
    expect(f.provider).toHaveBeenCalledTimes(1);expect(results.map(x=>x.status)).toContain("sent");
  });
  it("refuses revoked access or changed version before claim",async()=>{
    const f=await fixture();await expect(sendReviewedEmail({...f.input,ensureCurrentAccessVersionAndSender:async()=>{throw new Error("access revoked")}})).rejects.toThrow("access revoked");expect(f.row.state).toBe("reviewed");expect(f.provider).not.toHaveBeenCalled();
  });
  it("does not allow another actor or an incomplete provider receipt to be marked sent",async()=>{
    const f=await fixture();await expect(sendReviewedEmail({...f.input,actorId:"actor-b"})).rejects.toThrow(/unavailable/);
    f.provider.mockResolvedValueOnce({provider:"fixture",message_id:"",sent_at:"2026-02-01T12:01:00Z"});
    expect((await sendReviewedEmail(f.input)).status).toBe("uncertain");expect(f.row.receipt).toBeNull();
  });
});
