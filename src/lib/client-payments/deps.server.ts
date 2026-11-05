// Live wiring for client payments: the service-role rpc and notices the client page already uses, and Athena's
// Connect platform account keys from the server's environment. Server-only.
import { liveDeps } from "@/lib/customer-portal/deps.server";
import { athenaAppOrigin } from "@/lib/athena-host";
import { connectStripe } from "./stripe.server";
import { connectConfigured, feeConfig, type PayMode } from "./stripe";
import type { CheckoutDeps } from "./checkout";
import type { ConnectDeps } from "./connect";
import type { WebhookDeps } from "./webhook";

type Env = Record<string, string | undefined>;
const env = (): Env => (globalThis as { process?: { env?: Env } }).process?.env ?? {};

export const paymentsConfigured = (mode: PayMode) => connectConfigured(mode, env());

export function connectDeps(): ConnectDeps {
  return { rpc: liveDeps.rpc, stripe: (m) => connectStripe(m, env()), origin: athenaAppOrigin() };
}

export function checkoutDeps(origin: string): CheckoutDeps {
  return {
    rpc: liveDeps.rpc,
    stripe: (m) => connectStripe(m, env()),
    fee: () => feeConfig(env()),
    origin,
  };
}

export function webhookDeps(): WebhookDeps {
  return {
    rpc: liveDeps.rpc,
    stripe: (m) => connectStripe(m, env()),
    configured: paymentsConfigured,
    notice: liveDeps.notice,
    log: (m) => console.error(m),
  };
}
