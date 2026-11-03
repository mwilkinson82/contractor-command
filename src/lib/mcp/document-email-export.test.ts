import { describe, it, expect, vi } from "vitest";
import { applicationFixture } from "../payment-applications/fixtures";
import { calculateApplication } from "../payment-applications/model";
const state=vi.hoisted(()=>({scope:"full",args:null as unknown}));
vi.mock("./guard",()=>({run:async (_name:any,_ctx:any,_opts:any,fn:any)=>fn({rpc:async (_name:string,args:any)=>{state.args=args;const {applicationFixture}=await import("../payment-applications/fixtures");const {calculateApplication}=await import("../payment-applications/model");const body=applicationFixture();return {data:{job:{number:"SYN-01",name:"Fixture"},selected:{application_id:args._p.id,version:args._p.version,latest_version:args._p.version,body,calculation:calculateApplication(body),recorded_at:"2026-02-01T12:00:00Z",history:[]}},error:null}}}),text:(s:string)=>({content:[{type:"text",text:s}]}),dbError:(e:any)=>{throw Error(e.message)}}));
vi.mock("./document-email-brand",()=>({documentEmailBrand:async()=>({companyName:"Example Company"})}));
vi.mock("./jobs",()=>({resolveJob:async (_sb:any,job:string,company:string,scope:string)=>{if(job!=="SYN-01"||company!=="company-a"||scope!=="full"||state.scope!=="full")throw Error("Job unavailable");return {job_id:"job-a",company_id:"company-a"}}}));
vi.mock("./visible",()=>({guide:(r:any)=>r}));
import { documentEmailExport } from "./tools/document-email-export";
const id="00000000-0000-4000-8000-000000000002";
const call=(a:any)=>(documentEmailExport as any).handler(a,{});
describe("private export tool scope",()=>{
 it("uses the exact company, job, application and version, with no send",async()=>{state.scope="full";const r=await call({job_number:"SYN-01",company_id:"company-a",document_id:id,version:2});expect(state.args).toMatchObject({_job:"job-a",_action:"payment_application_read",_p:{id,version:2}});expect(r.structuredContent.artifact.company_id).toBe("company-a");expect(r.structuredContent.sent).toBe(false);expect(r.structuredContent.attached).toBe(false)});
 it("does not substitute a different company or lesser role",async()=>{await expect(call({job_number:"SYN-01",company_id:"company-b",document_id:id,version:2})).rejects.toThrow(/unavailable/);state.scope="super";await expect(call({job_number:"SYN-01",company_id:"company-a",document_id:id,version:2})).rejects.toThrow(/unavailable/);state.scope="full"});
});
