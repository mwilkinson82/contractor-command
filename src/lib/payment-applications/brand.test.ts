import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { imageFormat, isCompanyLogoUrl, MAX_COMPANY_LOGO_BYTES, resolvePaymentBrand, validatePaymentLogo } from "./brand";
const backend="https://backend.example", url=`${backend}/storage/v1/object/public/company-logos/owner/logo.png`;
const png=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADUlEQVR4nGP4zwAE/wEHAAH/4iOeWQAAAABJRU5ErkJggg==","base64"));
function pngChunk(type:string, data:Uint8Array):Buffer {
  const name=Buffer.from(type), content=Buffer.concat([name,data]);
  let crc=0xffffffff;
  for(const byte of content){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^(0xedb88320&-(crc&1));}
  const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);content.copy(result,4);result.writeUInt32BE((crc^0xffffffff)>>>0,data.length+8);return result;
}
function pngWithRows(rows:number[], extraStream?:Uint8Array):Uint8Array {
  const header=png.slice(16,29); // 2x1 RGB, 8 bit, non-interlaced
  const compressed=deflateSync(Uint8Array.from(rows));
  const payload=extraStream ? Buffer.concat([compressed,deflateSync(extraStream)]) : compressed;
  return new Uint8Array(Buffer.concat([Buffer.from(png.slice(0,8)),pngChunk("IHDR",header),pngChunk("IDAT",payload),pngChunk("IEND",new Uint8Array())]));
}
describe("shared payment branding",()=>{
  it("accepts only public project logo assets without credential-bearing or external links",()=>{
    expect(isCompanyLogoUrl(url,backend)).toBe(true);
    for(const bad of ["https://other.example/storage/v1/object/public/company-logos/x.png",`${backend}/storage/v1/object/private/company-logos/x.png`,`${url}?token=secret`,`${backend}/storage/v1/object/public/other/x.png`,`${backend}/storage/v1/object/public/company-logos/x.svg`]) expect(isCompanyLogoUrl(bad,backend)).toBe(false);
  });
  it("returns validated exact bytes without credentials and falls back for missing or invalid images",async()=>{
    const get=vi.fn(async()=>new Response(png,{headers:{"content-length":String(png.length)}})) as unknown as typeof fetch;
    const result=await resolvePaymentBrand({companyName:"Example",logoUrl:url,backendUrl:backend},get);
    expect(result).toEqual({companyName:"Example",logo:png,logoFormat:"PNG"});
    expect(vi.mocked(get).mock.calls[0][1]).toMatchObject({credentials:"omit",redirect:"manual"});
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
  it("never follows redirects or fetches unsafe logo URLs",async()=>{
    const redirected=vi.fn(async()=>new Response(null,{status:302,headers:{location:"https://unsafe.example/logo.png"}})) as unknown as typeof fetch;
    expect(await resolvePaymentBrand({companyName:"Example",logoUrl:url,backendUrl:backend},redirected)).toEqual({companyName:"Example"});
    expect(vi.mocked(redirected)).toHaveBeenCalledTimes(1);
    const blocked=vi.fn() as unknown as typeof fetch;
    for(const logoUrl of [`${url}?token=secret`,`${url}#fragment`,"http://backend.example/storage/v1/object/public/company-logos/x.png","https://user:password@backend.example/storage/v1/object/public/company-logos/x.png","https://other.example/storage/v1/object/public/company-logos/x.png",`${backend}/storage/v1/object/public/other/x.png`]) {
      expect(await resolvePaymentBrand({companyName:"Example",logoUrl,backendUrl:backend},blocked)).toEqual({companyName:"Example"});
    }
    expect(blocked).not.toHaveBeenCalled();
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
  it("rejects duplicate headers, incomplete rows, invalid filters and inflated overruns before decoding",async()=>{
    for(const name of ["duplicate-large.png","duplicate-small.png","short-scanline.png","inflation-overrun.png","profile.png"]){
      expect(await validatePaymentLogo(new Uint8Array(readFileSync(`tests/fixtures/payment-brand/${name}`))),name).toBeNull();
    }
    expect(await validatePaymentLogo(new Uint8Array(readFileSync("tests/fixtures/payment-brand/plain-2048x1.png")))).toBe("PNG");
    expect(await validatePaymentLogo(new Uint8Array(readFileSync("tests/fixtures/payment-brand/plain-2048x2048.png")))).toBe("PNG");
    expect(await validatePaymentLogo(pngWithRows([0,255,0,0,0,255,0]))).toBe("PNG");
    expect(await validatePaymentLogo(pngWithRows([5,255,0,0,0,255,0]))).toBeNull();
    expect(await validatePaymentLogo(pngWithRows([0,255,0,0,0,255]))).toBeNull();
    expect(await validatePaymentLogo(pngWithRows([0,255,0,0,0,255,0,0]))).toBeNull();
    expect(await validatePaymentLogo(pngWithRows([0,255,0,0,0,255,0],new Uint8Array(250000)))).toBeNull();
    const splitStreams=Buffer.concat([Buffer.from(png.slice(0,8)),pngChunk("IHDR",png.slice(16,29)),pngChunk("IDAT",deflateSync(Uint8Array.from([0,255,0]))),pngChunk("IDAT",deflateSync(Uint8Array.from([0,0,255,0]))),pngChunk("IEND",new Uint8Array())]);
    expect(await validatePaymentLogo(splitStreams)).toBeNull();
  });
  it("rejects a duplicate oversized header without attempting a large allocation",async()=>{
    const input=new Uint8Array(readFileSync("tests/fixtures/payment-brand/duplicate-large.png"));
    const Original=globalThis.Uint8Array;let largeAllocations=0;
    globalThis.Uint8Array=new Proxy(Original,{construct(target,args,newTarget){
      if(typeof args[0]==="number" && args[0]>4*1024*1024){largeAllocations++;throw new Error("oversized allocation");}
      return Reflect.construct(target,args,newTarget);
    }}) as typeof Uint8Array;
    try{expect(await validatePaymentLogo(input)).toBeNull();expect(largeAllocations).toBe(0);}
    finally{globalThis.Uint8Array=Original;}
  });
});
