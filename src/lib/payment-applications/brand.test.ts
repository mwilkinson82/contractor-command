import { describe, expect, it, vi } from "vitest";
import { imageFormat, isCompanyLogoUrl, MAX_COMPANY_LOGO_BYTES, resolvePaymentBrand } from "./brand";
const backend="https://backend.example", url=`${backend}/storage/v1/object/public/company-logos/owner/logo.png`;
const png=Uint8Array.from([137,80,78,71,13,10,26,10,1]);
describe("shared payment branding",()=>{
  it("accepts only public project logo assets without credential-bearing or external links",()=>{
    expect(isCompanyLogoUrl(url,backend)).toBe(true);
    for(const bad of ["https://other.example/storage/v1/object/public/company-logos/x.png",`${backend}/storage/v1/object/private/company-logos/x.png`,`${url}?token=secret`,`${backend}/storage/v1/object/public/other/x.png`,`${backend}/storage/v1/object/public/company-logos/x.svg`]) expect(isCompanyLogoUrl(bad,backend)).toBe(false);
  });
  it("returns validated exact bytes without credentials and falls back for missing or invalid images",async()=>{
    const get=vi.fn(async()=>new Response(png,{headers:{"content-length":String(png.length)}})) as unknown as typeof fetch;
    const result=await resolvePaymentBrand({companyName:"Example",logoUrl:url,backendUrl:backend},get);
    expect(result).toEqual({companyName:"Example",logo:png,logoFormat:"PNG"});
    expect(vi.mocked(get).mock.calls[0][1]).toMatchObject({credentials:"omit",redirect:"error"});
    const invalid=vi.fn(async()=>new Response("not an image",{headers:{"content-length":"12"}})) as unknown as typeof fetch;
    expect(await resolvePaymentBrand({companyName:"Example",logoUrl:url,backendUrl:backend},invalid)).toEqual({companyName:"Example"});
    const oversize=vi.fn(async()=>new Response(png,{headers:{"content-length":String(MAX_COMPANY_LOGO_BYTES+1)}})) as unknown as typeof fetch;
    expect(await resolvePaymentBrand({companyName:"Example",logoUrl:url,backendUrl:backend},oversize)).toEqual({companyName:"Example"});
    expect(imageFormat(Uint8Array.from([255,216,255]))).toBe("JPEG");
    expect(imageFormat(Uint8Array.from([0,1,2]))).toBeNull();
  });
});
