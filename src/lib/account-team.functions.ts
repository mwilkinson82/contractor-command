import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { billingConfig } from "@/lib/athena-billing";

// v0.8.22: tells /account whether seat checkout is switched on. Read-only: it never creates a payment session.
export const getSeatPurchaseStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ checkoutEnabled: boolean }> => ({
    checkoutEnabled: billingConfig().checkoutEnabled,
  }));
