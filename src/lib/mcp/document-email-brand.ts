import { isCompanyLogoUrl, resolvePaymentBrand, type PaymentBrand } from '../payment-applications/brand';
import type { Sb } from './guard';

/** The caller must already resolve the job with full access. Never substitute the account profile. */
export async function documentEmailBrand(sb: Sb, companyId: string) {
  const { data, error } = await sb.from('mcp_companies').select('id,name,logo_url').eq('id',companyId).single();
  if (error || !data || data.id !== companyId || !data.name)
    throw new Error('The project company branding could not be verified. Try again.');
  return resolvePaymentBrand({companyName:data.name,logoUrl:data.logo_url,backendUrl:import.meta.env.VITE_SUPABASE_URL});
}

/**
 * The contractor's saved logo address for a client email or page, or null. Only a PNG or JPEG in the public
 * company-logos bucket counts, the same rule pay apps use. A lookup that fails leaves the name in its place.
 */
export async function companyLogoUrl(sb: Sb, companyId: string): Promise<string | null> {
  try {
    const { data } = await sb.from('mcp_companies').select('logo_url').eq('id',companyId).single();
    const url = (data as { logo_url?: string | null } | null)?.logo_url;
    const backend = import.meta.env.VITE_SUPABASE_URL;
    return url && backend && isCompanyLogoUrl(url, backend) ? url : null;
  } catch { return null; }
}

/** The contractor's brand for the top of a client PDF. A lookup that fails leaves the corner blank; the file still builds. */
export async function pdfContractorBrand(sb: Sb, companyId: string): Promise<PaymentBrand> {
  try { return await documentEmailBrand(sb, companyId); } catch { return {}; }
}
