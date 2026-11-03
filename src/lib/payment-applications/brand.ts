/** Shared PDF/attachment branding policy. The caller resolves company identity through job access. */
export const MAX_COMPANY_LOGO_BYTES = 1024 * 1024;
export const MAX_COMPANY_LOGO_DIMENSION = 2048;
export type PaymentBrand = { companyName?: string; logo?: Uint8Array; logoFormat?: "PNG" | "JPEG" };
export function imageFormat(bytes: Uint8Array): "PNG" | "JPEG" | null {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return "PNG";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "JPEG";
  return null;
}
/** Validate dimensions before decoding, then decode using the same supported image families as the PDF. */
export async function validatePaymentLogo(bytes: Uint8Array): Promise<"PNG" | "JPEG" | null> {
  if (!bytes.length || bytes.length > MAX_COMPANY_LOGO_BYTES) return null;
  const format=imageFormat(bytes), view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const safe=(w:number,h:number)=>w>0 && h>0 && w<=MAX_COMPANY_LOGO_DIMENSION && h<=MAX_COMPANY_LOGO_DIMENSION && w*h<=MAX_COMPANY_LOGO_DIMENSION**2;
  try {
    if (format === "PNG") {
      if(bytes.length<45 || view.getUint32(8)!==13 || String.fromCharCode(...bytes.subarray(12,16))!=="IHDR") return null;
      const w=view.getUint32(16), h=view.getUint32(20); if(!safe(w,h)) return null;
      // Restrict decoding to non-interlaced, 8-bit PNGs with known row sizes.
      const depth=bytes[24], color=bytes[25];
      const channels:Record<number,number>={0:1,2:3,3:1,4:2,6:4};
      if(depth!==8 || !channels[color] || bytes[26]!==0 || bytes[27]!==0 || bytes[28]!==0) return null;
      let at=8, ended=false, sawData=false, dataEnded=false, palette=false, transparency=false;
      let paletteEntries=0; const chunks:Uint8Array[]=[];
      while(at+12<=bytes.length){
        const n=view.getUint32(at), end=at+12+n;
        if(end>bytes.length) return null;
        const type=String.fromCharCode(...bytes.subarray(at+4,at+8));
        if(!/^[A-Za-z]{4}$/.test(type)) return null;
        if(type==="IHDR"){if(at!==8 || n!==13) return null;}
        else if(at===8) return null;
        // Compressed ancillary data and animation are not needed for static logos.
        if(["iCCP","zTXt","iTXt","acTL","fdAT","fcTL"].includes(type)) return null;
        if(type==="PLTE"){
          if(palette || sawData || transparency || color===0 || color===4 || n<3 || n>768 || n%3!==0) return null;
          palette=true;paletteEntries=n/3;
        } else if(type==="tRNS"){
          if(transparency || sawData || (color===3 && (!palette || n<1 || n>paletteEntries)) ||
             (color===0 && n!==2) || (color===2 && n!==6) || color===4 || color===6) return null;
          transparency=true;
        } else if(type==="IDAT"){
          if(dataEnded || (color===3 && !palette)) return null;
          sawData=true;chunks.push(bytes.subarray(at+8,at+8+n));
        } else if(type==="IEND"){
          if(!sawData || n!==0 || end!==bytes.length) return null;
          ended=true;break;
        } else if(type!=="IHDR" && type.charCodeAt(0)>=65 && type.charCodeAt(0)<=90) return null;
        if(sawData && type!=="IDAT") dataEnded=true;
        at=end;
      }
      if(!ended || !sawData) return null;
      // Use the same inflater as the PDF decoder; it can consume concatenated streams
      // that the browser DecompressionStream silently ignores after the first one.
      const {Inflate}=await import("pako");
      let inflated=0; const rowLength=1+w*channels[color], expected=rowLength*h;
      const inflater=new Inflate({chunkSize:16384});
      let finished=false;
      const onEnd=inflater.onEnd.bind(inflater);
      inflater.onEnd=(status:number)=>{finished=status===0;onEnd(status);};
      inflater.onData=(part:Uint8Array)=>{
        if(inflated+part.length>expected) throw new Error("PNG data exceeds its dimensions");
        for(let i=(rowLength-inflated%rowLength)%rowLength;i<part.length;i+=rowLength){
          if(part[i]>4) throw new Error("Invalid PNG filter");
        }
        inflated+=part.length;
      };
      // Match fast-png's IDAT boundaries, including a stream ending before a later chunk.
      for(const chunk of chunks) if(!inflater.push(chunk)) return null;
      if(!finished || inflater.err || inflated!==expected) return null;
      const {decode}=await import("fast-png");
      const decoded=decode(bytes,{checkCrc:true});
      if(color===3 && decoded.data.some(index=>index>=paletteEntries)) return null;
      return decoded.width===w && decoded.height===h && decoded.data.length===w*h*channels[color] ? "PNG" : null;
    }
    if (format === "JPEG") {
      if(bytes.length<12 || bytes[bytes.length-2]!==255 || bytes[bytes.length-1]!==217) return null;
      let p=2, width=0, height=0;
      while(p+3<bytes.length){
        if(bytes[p++]!==255) return null;
        while(bytes[p]===255)p++;
        const marker=bytes[p++];
        if(marker===0xda) break;
        if(marker===0xd9 || marker===0xd8 || marker===0x01 || (marker>=0xd0 && marker<=0xd7)) return null;
        if(p+2>bytes.length) return null;
        const n=view.getUint16(p);if(n<2 || p+n>bytes.length) return null;
        if([0xc0,0xc1,0xc2].includes(marker)){
          if(n<8 || width) return null; height=view.getUint16(p+3);width=view.getUint16(p+5);if(!safe(width,height))return null;
        }
        p+=n;
      }
      if(!width || !height) return null;
      const {decode}=await import("jpeg-js");
      const image=decode(bytes,{useTArray:true,formatAsRGBA:true,tolerantDecoding:false,maxResolutionInMP:4.194304,maxMemoryUsageInMB:64});
      return image.width===width && image.height===height && image.data.length===width*height*4 ? "JPEG" : null;
    }
  } catch { return null; }
  return null;
}
export function isCompanyLogoUrl(raw: string, backend: string): boolean {
  try {
    const u = new URL(raw), b = new URL(backend);
    return u.protocol === "https:" && u.origin === b.origin && !u.username && !u.password && !u.search && !u.hash &&
      u.pathname.startsWith("/storage/v1/object/public/company-logos/") && /\.(png|jpe?g)$/i.test(u.pathname);
  } catch { return false; }
}
export async function resolvePaymentBrand(input: { companyName?: string; logoUrl?: string | null; backendUrl?: string }, fetcher: typeof fetch = fetch): Promise<PaymentBrand> {
  const brand: PaymentBrand = { companyName: input.companyName };
  if (!input.logoUrl || !input.backendUrl || !isCompanyLogoUrl(input.logoUrl, input.backendUrl)) return brand;
  try {
    // Workers reject redirect:"error" before fetching. Manual mode never follows
    // redirects; the non-2xx check below rejects them in browsers and Workers.
    const res = await fetcher(input.logoUrl, { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(10000) });
    const len = Number(res.headers.get("content-length"));
    if (!res.ok || !Number.isSafeInteger(len) || len <= 0 || len > MAX_COMPANY_LOGO_BYTES) return brand;
    if (!res.body) return brand;
    const reader = res.body.getReader(), chunks: Uint8Array[] = [];
    let count = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.length;
      if (count > MAX_COMPANY_LOGO_BYTES) { await reader.cancel(); return brand; }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(count);
    let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const format = await validatePaymentLogo(bytes);
    if (bytes.length <= MAX_COMPANY_LOGO_BYTES && bytes.length === len && format) return { ...brand, logo: bytes, logoFormat: format };
  } catch { /* Name-only fallback if the configured public asset cannot be read. */ }
  return brand;
}
