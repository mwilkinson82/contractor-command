import { resolvePaymentBrand } from '../payment-applications/brand';
import type { Sb } from './guard';

/** The caller must already resolve the job with full access. Never substitute the account profile. */
export async function documentEmailBrand(sb: Sb, companyId: string) {
  const { data, error } = await sb.from('mcp_companies').select('id,name,logo_url').eq('id',companyId).single();
  if (error || !data || data.id !== companyId || !data.name)
    throw new Error('The project company branding could not be verified. Try again.');
  return resolvePaymentBrand({companyName:data.name,logoUrl:data.logo_url,backendUrl:import.meta.env.VITE_SUPABASE_URL});
}
