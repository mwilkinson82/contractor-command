import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { imageFormat, isCompanyLogoUrl, MAX_COMPANY_LOGO_BYTES, resolvePaymentBrand, validatePaymentLogo } from "./brand";
const backend="https://backend.example", url=`${backend}/storage/v1/object/public/company-logos/owner/logo.png`;
const png=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==","base64"));
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
  it("rejects truncated images and oversized dimensions before declaring a logo ready",async()=>{
    expect(await validatePaymentLogo(png)).toBe("PNG");
    expect(await validatePaymentLogo(Uint8Array.from([137,80,78,71,13,10,26,10,1]))).toBeNull();
    expect(await validatePaymentLogo(png.slice(0,png.length-8))).toBeNull();
    expect(await validatePaymentLogo(Uint8Array.from([255,216,255,217]))).toBeNull();
    const oversized=png.slice();new DataView(oversized.buffer).setUint32(16,100000);
    expect(await validatePaymentLogo(oversized)).toBeNull();
    const corrupt=png.slice();corrupt[corrupt.length-1]^=1;
    expect(await validatePaymentLogo(corrupt)).toBeNull();
  });
  it("fully decodes JPEGs and rejects a missing end marker or oversized frame",async()=>{
    const jpg=new Uint8Array(readFileSync("tests/fixtures/payment-brand/logo.jpg"));
    expect(await validatePaymentLogo(jpg)).toBe("JPEG");
    expect(await validatePaymentLogo(jpg.slice(0,jpg.length-2))).toBeNull();
    const sos=jpg.findIndex((b,i)=>b===255 && jpg[i+1]===0xda);
    expect(sos).toBeGreaterThan(0);
    const truncated=new Uint8Array([...jpg.slice(0,sos+20),255,217]);
    expect(await validatePaymentLogo(truncated)).toBeNull();
    const oversized=jpg.slice();
    const frame=oversized.findIndex((b,i)=>b===255 && [0xc0,0xc1,0xc2].includes(oversized[i+1]));
    expect(frame).toBeGreaterThan(0);new DataView(oversized.buffer).setUint16(frame+7,5000);
    expect(await validatePaymentLogo(oversized)).toBeNull();
  });
});
