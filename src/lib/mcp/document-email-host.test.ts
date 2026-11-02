import { describe, expect, it } from "vitest";
import { applicationFixture } from "../payment-applications/fixtures";
import { calculateApplication } from "../payment-applications/model";
import { paymentApplicationArtifact } from "./document-email-artifact";
import { gmailMimeRequest, hostReviewHash, mailboxReadiness, type HostMailbox } from "./document-email-host";

async function fixture() {
  const body=applicationFixture(), id="00000000-0000-4000-8000-000000000002";
  const artifact=await paymentApplicationArtifact({companyId:"company-a",jobId:"job-a",applicationId:id,version:1,allowHistorical:false,context:{job:{number:"1",name:"Fictional"},currency:"USD",snapshot:body.snapshot,evidence:[],applications:[],selected:{application_id:id,version:1,latest_version:1,body,calculation:calculateApplication(body),billing_version:null,recorded_at:"2026-02-01T12:00:00Z",history:[]}}});
  const {content_base64:_content,latest_version:_latest,...attachment}=artifact;
  const email={company_id:"company-a",job_id:"job-a",from:"owner@example.test",to:"contact@example.test",cc:["pm@example.test"],subject:"Payment application",body:"Please review.",attachment};
  const mailbox={provider:"gmail",connectionId:"connection-one",profileAddress:"owner@example.test",observedAt:1000000,canSendMime:true};
  const confirmedHash=await hostReviewHash(email,artifact,mailbox,1000000);
  return {email,artifact,mailbox,confirmedHash,confirmed:true,now:1000000};
}

describe("connected email host handoff",()=>{
  it("makes a MIME payload containing the exact real PDF bytes, reviewed sender and recipients",async()=>{
    const f=await fixture(), p=await gmailMimeRequest(f);
    expect(p).toMatchObject({from_address:f.email.from,to:f.email.to,cc:f.email.cc[0],subject:f.email.subject});
    expect(p.payload.parts[0].body.content).toBe(f.email.body);
    const attachment=p.payload.parts[1];
    expect(attachment.filename).toBe(f.artifact.filename);
    expect(attachment.content_disposition).toBe("attachment");
    const bytes=Buffer.from(attachment.body.base64_url_content,"base64url");
    expect(bytes.subarray(0,5).toString()).toBe("%PDF-");
    expect(Buffer.from(await crypto.subtle.digest("SHA-256",bytes)).toString("hex")).toBe(f.artifact.sha256);
  });
  it("requires confirmation and fails closed for absent, stale or incapable account",async()=>{
    const f=await fixture();
    expect(mailboxReadiness(null).status).toBe("connect_email");
    expect(mailboxReadiness({...f.mailbox,canSendMime:false},f.now).status).toBe("unsupported_attachment");
    expect(mailboxReadiness(f.mailbox,f.now+300001).status).toBe("connect_email");
    await expect(gmailMimeRequest({...f,confirmed:false})).rejects.toThrow(/Confirm/);
  });
  it("refuses a switched account, changed content, altered bytes or unverified sender",async()=>{
    const f=await fixture();
    await expect(gmailMimeRequest({...f,mailbox:{...f.mailbox,connectionId:"connection-two"}})).rejects.toThrow(/changed/);
    await expect(gmailMimeRequest({...f,mailbox:{...f.mailbox,profileAddress:"other@example.test"}})).rejects.toThrow(/sender changed/);
    await expect(gmailMimeRequest({...f,email:{...f.email,to:"else@example.test"}})).rejects.toThrow(/changed/);
    await expect(gmailMimeRequest({...f,artifact:{...f.artifact,content_base64:btoa("tampered")}})).rejects.toThrow(/bytes/);
  });
  it("does not pretend other providers are Gmail",async()=>{
    const f=await fixture();
    await expect(gmailMimeRequest({...f,mailbox:{...f.mailbox,provider:"other"}})).rejects.toThrow(/Gmail/);
  });
  it("supports a fresh observed Gmail profile without inventing a connection ID",async()=>{
    const f=await fixture();
    const observed:HostMailbox={mode:"assistant_current_gmail",provider:"gmail",profileAddress:f.email.from,observedAt:f.now,canSendMime:true};
    const confirmedHash=await hostReviewHash(f.email,f.artifact,observed,f.now);
    expect(confirmedHash).not.toBe(f.confirmedHash);
    const mime=await gmailMimeRequest({...f,mailbox:observed,confirmedHash});
    expect(mime.from_address).toBe(f.email.from);
    expect(Buffer.from(mime.payload.parts[1].body.base64_url_content,"base64url")).toEqual(Buffer.from(f.artifact.content_base64,"base64"));
    expect(mailboxReadiness(observed,f.now+30001).status).toBe("connect_email");
    expect(mailboxReadiness({...observed,canSendMime:false},f.now).status).toBe("unsupported_attachment");
    await expect(gmailMimeRequest({...f,mailbox:{...observed,profileAddress:"other@example.test"},confirmedHash})).rejects.toThrow(/sender changed/);
    await expect(gmailMimeRequest({...f,mailbox:f.mailbox,confirmedHash})).rejects.toThrow(/changed/);
    await expect(gmailMimeRequest({...f,mailbox:observed,confirmedHash,email:{...f.email,to:"other@example.test"}})).rejects.toThrow(/changed/);
    await expect(gmailMimeRequest({...f,mailbox:observed,confirmedHash,email:{...f.email,cc:["other@example.test"]}})).rejects.toThrow(/changed/);
    await expect(gmailMimeRequest({...f,mailbox:observed,confirmedHash,email:{...f.email,subject:"changed"}})).rejects.toThrow(/changed/);
    await expect(gmailMimeRequest({...f,mailbox:observed,confirmedHash,email:{...f.email,body:"changed"}})).rejects.toThrow(/changed/);
    await expect(gmailMimeRequest({...f,mailbox:observed,confirmedHash,artifact:{...f.artifact,content_base64:btoa("tampered")}})).rejects.toThrow(/bytes/);
    expect(mailboxReadiness({...observed,connectionId:"invented"} as unknown as HostMailbox,f.now).status).toBe("connect_email");
  });
});
