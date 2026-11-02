import { describe, expect, it } from "vitest";
import { applicationFixture } from "../payment-applications/fixtures";
import { calculateApplication } from "../payment-applications/model";
import type { ApplicationContext } from "../payment-applications/workflow";
import { paymentApplicationArtifact } from "./document-email-artifact";
import { gmailMimeRequest, hostReviewHash, type HostMailbox } from "./document-email-host";
const id="00000000-0000-4000-8000-000000000002";
function context(): ApplicationContext {
  const body=applicationFixture();
  return {job:{number:"SYN-01",name:"Fictional project"},currency:"USD",snapshot:body.snapshot,evidence:[],applications:[],selected:{application_id:id,version:2,latest_version:2,body,calculation:calculateApplication(body),billing_version:null,recorded_at:"2026-02-01T12:00:00Z",history:[]}};
}
const args=()=>({companyId:"company-a",jobId:"job-a",applicationId:id,version:2,allowHistorical:false,context:context()});
describe("payment application private attachment",()=>{
  it("exports deterministic real PDF bytes bound to job, application, version and hash",async()=>{
    const a=await paymentApplicationArtifact(args()),b=await paymentApplicationArtifact(args());
    expect(a).toEqual(b);expect(a.company_id).toBe("company-a");expect(a.job_id).toBe("job-a");expect(a.document_id).toBe(id);expect(a.version).toBe(2);
    expect(a.filename).toBe("Payment-application-Application-1-v2.pdf");
    const bytes=Buffer.from(a.content_base64,"base64");expect(bytes.subarray(0,5).toString()).toBe("%PDF-");expect(bytes.length).toBe(a.size_bytes);
    const hash=Buffer.from(await crypto.subtle.digest("SHA-256",bytes)).toString("hex");expect(a.sha256).toBe(hash);
  });
  it("binds the corrected em-dash PDF bytes to the reviewed Gmail attachment",async()=>{
    const input=args();input.context.job.name="Synthetic Project — North";
    const artifact=await paymentApplicationArtifact(input);
    const bytes=Buffer.from(artifact.content_base64,"base64");
    expect(bytes.toString("latin1")).toContain("Synthetic Project \x97 North");
    const {content_base64:_content,latest_version:_latest,...attachment}=artifact;
    const email={company_id:"company-a",job_id:"job-a",from:"owner@example.test",to:"recipient@example.test",cc:[],subject:"Pay app",body:"Please review.",attachment};
    const mailbox:HostMailbox={mode:"assistant_current_gmail",provider:"gmail",profileAddress:email.from,observedAt:1000000,canSendMime:true};
    const confirmedHash=await hostReviewHash(email,artifact,mailbox,1000000);
    const mime=await gmailMimeRequest({email,artifact,mailbox,confirmedHash,confirmed:true,now:1000000});
    const attached=Buffer.from(mime.payload.parts[1].body.base64_url_content,"base64url");
    expect(attached).toEqual(bytes);expect(Buffer.from(await crypto.subtle.digest("SHA-256",attached)).toString("hex")).toBe(artifact.sha256);
  });
  it("fails closed for another version, missing or working applications",async()=>{
    const wrong=args();wrong.version=1;await expect(paymentApplicationArtifact(wrong)).rejects.toThrow(/exact/);
    const missing=args();missing.context.selected=null;await expect(paymentApplicationArtifact(missing)).rejects.toThrow(/exact/);
    const work=args();work.context.selected!.working_state="open";await expect(paymentApplicationArtifact(work)).rejects.toThrow(/Save/);
  });
  it("requires an explicit historical selection if a newer version exists",async()=>{
    const old=args();old.context.selected!.latest_version=3;
    await expect(paymentApplicationArtifact(old)).rejects.toThrow(/newer/);
    old.allowHistorical=true;expect((await paymentApplicationArtifact(old)).latest_version).toBe(3);
  });
});
