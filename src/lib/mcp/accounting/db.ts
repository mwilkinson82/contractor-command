// Shared database helpers for the accounting tools.
import { dbError, type Sb } from "../guard";

type RpcFn = (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;

/** Call an mcp_* function; database errors become member-facing messages. */
export async function rpc<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (sb.rpc as unknown as RpcFn)(fn, args);
  if (error) dbError(error);
  return data as T;
}

/** Same, but null instead of an error (missing schema before the migration is applied, or no access). */
export async function rpcSoft<T>(sb: Sb, fn: string, args: Record<string, unknown>): Promise<T | null> {
  try {
    const { data, error } = await (sb.rpc as unknown as RpcFn)(fn, args);
    return error ? null : (data as T);
  } catch {
    return null;
  }
}

/** Display name and role of the caller in the job's company. */
export async function caller(sb: Sb, companyId: string, userId: string | undefined): Promise<{ name: string | null; role: string | null }> {
  if (!userId) return { name: null, role: null };
  const { data } = await sb.from("mcp_company_members").select("display_name, role").eq("company_id", companyId).eq("user_id", userId).maybeSingle();
  return { name: (data as { display_name?: string } | null)?.display_name ?? null, role: (data as { role?: string } | null)?.role ?? null };
}
