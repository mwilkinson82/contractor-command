import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({ result: null as any, query: null as any, rows: {} as Record<string,any>, calls: [] as any[] }));
vi.mock("@tanstack/react-query",()=>({useQuery:(options:any)=>{m.query=options.queryFn;return {data:m.result,isPending:false,refetch:vi.fn()};}}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{from:(table:string)=>{
  const filter:Record<string,string>={};
  const q:any={select:()=>q,eq:(key:string,value:string)=>{filter[key]=value;return q;},single:async()=>{m.calls.push({table,filter});return m.rows[table];},maybeSingle:async()=>{m.calls.push({table,filter});return m.rows[table];}};
  return q;
}}}));
import { PaymentCompanyBrand } from "./PaymentCompanyBrand";
describe("job company branding control",()=>{
  beforeEach(()=>{m.calls=[];m.rows={};m.result=null;});
  it("shows editing only to the owner and identifies the exact job company",()=>{
    m.result={id:"company-a",name:"Example",owner:true,logo_url:null,logoAvailable:false};
    const owner=renderToStaticMarkup(React.createElement(PaymentCompanyBrand,{jobId:"job-a",actorId:"user-a"}));
    expect(owner).toContain("company-a"); expect(owner).toContain("Save company logo"); expect(owner).toContain("Save company name");
    m.result={...m.result,owner:false};
    const member=renderToStaticMarkup(React.createElement(PaymentCompanyBrand,{jobId:"job-a",actorId:"user-a"}));
    expect(member).toContain("Only a company owner"); expect(member).not.toContain("Save company logo");
  });
  it("binds the lookup to the job company and actor and rejects mismatched company or member",async()=>{
    renderToStaticMarkup(React.createElement(PaymentCompanyBrand,{jobId:"job-a",actorId:"user-a"}));
    m.rows={mcp_jobs:{data:{id:"job-a",company_id:"company-a"}},mcp_companies:{data:{id:"company-a",name:"Example",logo_url:null}},mcp_company_members:{data:{company_id:"company-a",user_id:"user-a",role:"owner"}}};
    expect((await m.query()).owner).toBe(true);
    expect(m.calls).toContainEqual({table:"mcp_companies",filter:{id:"company-a"}});
    expect(m.calls).toContainEqual({table:"mcp_company_members",filter:{company_id:"company-a",user_id:"user-a"}});
    m.rows.mcp_companies.data.id="company-b";
    await expect(m.query()).rejects.toThrow("unavailable");
    m.rows.mcp_companies.data.id="company-a";m.rows.mcp_company_members.data.user_id="user-b";
    await expect(m.query()).rejects.toThrow("unavailable");
  });
});
