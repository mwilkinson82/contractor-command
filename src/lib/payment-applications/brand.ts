/** Shared PDF/attachment branding policy. The caller resolves company identity through job access. */
export const MAX_COMPANY_LOGO_BYTES = 1024 * 1024;
export type PaymentBrand = { companyName?: string; logo?: Uint8Array; logoFormat?: "PNG" | "JPEG" };
export function imageFormat(bytes: Uint8Array): "PNG" | "JPEG" | null {
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return "PNG";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "JPEG";
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
    const res = await fetcher(input.logoUrl, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(10000) });
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
    const format = imageFormat(bytes);
    if (bytes.length <= MAX_COMPANY_LOGO_BYTES && bytes.length === len && format) return { ...brand, logo: bytes, logoFormat: format };
  } catch { /* Name-only fallback if the configured public asset cannot be read. */ }
  return brand;
}
