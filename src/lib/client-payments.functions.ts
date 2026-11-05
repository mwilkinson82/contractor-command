// Account page server functions for client payments. Only a company owner connects Stripe or changes the mode,
// checked with the owner's own database rights first; the service functions check the owner again. Nothing here
// returns a Stripe key or an account id.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ClientPaymentsNotConfigured, feeConfig, type PayMode } from "@/lib/client-payments/stripe";

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

const mode = z.enum(["test", "live"]);
const company = z.object({ companyId: z.string().uuid() });
type Env = Record<string, string | undefined>;
const env = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

export type ClientPaymentsSetup = {
  configured: Record<PayMode, boolean>;
  fee: { bps: number; capCents: number };
};

export type ClientPaymentsAction =
  | { status: "ok"; url?: string }
  | { status: "not_owner" | "not_configured" | "failed"; message?: string };

/** Which modes Athena can take payments in, and Athena's fee, for the account page to explain. */
export const getClientPaymentsSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ClientPaymentsSetup> => {
    const { paymentsConfigured } = await import("@/lib/client-payments/deps.server");
    return {
      configured: { test: paymentsConfigured("test"), live: paymentsConfigured("live") },
      fee: feeConfig(env()),
    };
  });

async function isOwner(sb: { rpc: Rpc }, companyId: string): Promise<boolean> {
  const r = await sb.rpc("mcp_client_payments_get", { _company: companyId });
  return !r.error && (r.data as { can_manage?: boolean } | null)?.can_manage === true;
}

const plain = (e: unknown): string | undefined => {
  const m = e instanceof Error ? e.message : "";
  return m.startsWith("MCP_BAD:") ? m.slice(8) : undefined;
};

/** Starts or continues Stripe's setup in one mode and returns Stripe's page for the owner to finish it. */
export const connectClientPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(company.extend({ mode }).parse)
  .handler(async ({ data, context }): Promise<ClientPaymentsAction> => {
    const sb = context.supabase as unknown as { rpc: Rpc };
    if (!(await isOwner(sb, data.companyId))) return { status: "not_owner" };
    const [{ startConnect }, { connectDeps }] = await Promise.all([
      import("@/lib/client-payments/connect"),
      import("@/lib/client-payments/deps.server"),
    ]);
    try {
      const r = await startConnect(connectDeps(), {
        companyId: data.companyId,
        mode: data.mode,
        userId: context.userId,
        email: null,
      });
      return { status: "ok", url: r.url };
    } catch (e) {
      if (e instanceof ClientPaymentsNotConfigured) return { status: "not_configured" };
      return { status: "failed", message: plain(e) };
    }
  });

/** Re-reads the company's Stripe accounts after the owner comes back from Stripe. */
export const refreshClientPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(company.parse)
  .handler(async ({ data, context }): Promise<ClientPaymentsAction> => {
    const sb = context.supabase as unknown as { rpc: Rpc };
    if (!(await isOwner(sb, data.companyId))) return { status: "not_owner" };
    const [{ refreshConnect }, { connectDeps, paymentsConfigured }] = await Promise.all([
      import("@/lib/client-payments/connect"),
      import("@/lib/client-payments/deps.server"),
    ]);
    try {
      await refreshConnect(connectDeps(), {
        companyId: data.companyId,
        userId: context.userId,
        configured: paymentsConfigured,
      });
      return { status: "ok" };
    } catch (e) {
      return { status: "failed", message: plain(e) };
    }
  });

/** Turns live payments on, or back to test. */
export const setClientPaymentMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(company.extend({ mode }).parse)
  .handler(async ({ data, context }): Promise<ClientPaymentsAction> => {
    const sb = context.supabase as unknown as { rpc: Rpc };
    if (!(await isOwner(sb, data.companyId))) return { status: "not_owner" };
    const [{ setPaymentMode }, { connectDeps }] = await Promise.all([
      import("@/lib/client-payments/connect"),
      import("@/lib/client-payments/deps.server"),
    ]);
    try {
      await setPaymentMode(connectDeps(), {
        companyId: data.companyId,
        mode: data.mode,
        userId: context.userId,
      });
      return { status: "ok" };
    } catch (e) {
      return { status: "failed", message: plain(e) };
    }
  });
