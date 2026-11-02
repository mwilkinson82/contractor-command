import React, { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({slots:[] as any[],cursor:0,owner:true,upload:vi.fn(),download:vi.fn(),rpc:vi.fn(),refetch:vi.fn(),getUser:vi.fn()}));
vi.mock("react",async original=>({...(await original<typeof import("react")>()),useState:(initial:any)=>{const i=m.cursor++;if(!(i in m.slots))m.slots[i]=initial;return [m.slots[i],(v:any)=>{m.slots[i]=v;}];},useRef:(initial:any)=>{const i=m.cursor++;return m.slots[i]??=( {current:initial} );},useEffect:()=>{m.cursor++;}}));
vi.mock("@tanstack/react-query",()=>({useQuery:()=>({data:{id:"company-a",name:"Example",owner:m.owner,logo_url:null,logoAvailable:false},isPending:false,refetch:m.refetch})}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{auth:{getUser:m.getUser},rpc:m.rpc,storage:{from:()=>({upload:m.upload,download:m.download,getPublicUrl:(path:string)=>({data:{publicUrl:`https://backend.example/storage/v1/object/public/company-logos/${path}`}})})}}}));
import { PaymentCompanyBrand } from "./PaymentCompanyBrand";
function nodes(tree:ReactNode): any[]{if(Array.isArray(tree))return tree.flatMap(nodes);if(!React.isValidElement(tree))return [];return [tree,...nodes((tree.props as any).children)];}
function render(){m.cursor=0;return PaymentCompanyBrand({jobId:"job-a",actorId:"user-a"});}
const bytes=Uint8Array.from([137,80,78,71,13,10,26,10,1]);
const file={type:"image/png",size:bytes.length,arrayBuffer:async()=>bytes.buffer} as File;
describe("company branding actions",()=>{
  beforeEach(()=>{m.slots=[];m.owner=true;vi.clearAllMocks();m.getUser.mockResolvedValue({data:{user:{id:"user-a"}},error:null});m.rpc.mockResolvedValue({error:null});});
  it("uploads once after explicit selection and confirms the exact selected company",async()=>{
    m.upload.mockResolvedValue({error:null});
    m.refetch.mockImplementation(async()=>{const p=m.rpc.mock.calls[0][1]._p.logo_url;return {data:{logo_url:p,logoAvailable:true}};});
    let tree=render();nodes(tree).find(n=>n.type==="input"&&n.props.type==="file").props.onChange({target:{files:[file]}});
    tree=render();const save=nodes(tree).find(n=>n.type==="button"&&n.props.children==="Save company logo");
    const one=save.props.onClick();save.props.onClick();await one;await new Promise(r=>setTimeout(r,0));
    expect(m.upload).toHaveBeenCalledTimes(1);expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc.mock.calls[0][1]._company).toBe("company-a");
    expect(m.rpc.mock.calls[0][1]._p.logo_url).toContain("/user-a/athena-company-a-");
  });
  it("does not re-upload when the result is uncertain and checks the same path",async()=>{
    m.upload.mockResolvedValue({error:{message:"unknown"}});m.download.mockResolvedValue({data:null,error:{message:"unknown"}});
    let tree=render();nodes(tree).find(n=>n.type==="input"&&n.props.type==="file").props.onChange({target:{files:[file]}});
    tree=render();nodes(tree).find(n=>n.type==="button"&&n.props.children==="Save company logo").props.onClick();await new Promise(r=>setTimeout(r,0));
    tree=render();nodes(tree).find(n=>n.type==="button"&&n.props.children==="Check same logo upload").props.onClick();await new Promise(r=>setTimeout(r,0));
    expect(m.upload).toHaveBeenCalledTimes(1);expect(m.download).toHaveBeenCalledWith(m.upload.mock.calls[0][0]);expect(m.rpc).not.toHaveBeenCalled();
  });
});
