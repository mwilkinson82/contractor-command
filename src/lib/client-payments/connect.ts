// Connecting a contractor's Stripe account, for the account page. Only a company owner gets this far: the caller
// checks with the owner's own database rights first (mcp_client_payments_get says can_manage), and the database
// checks again when the account is saved.
import type { ConnectStripe } from "./client";
import {
  accountReadiness,
  CONNECT_WEBHOOK_EVENTS,
  CONNECT_WEBHOOK_PATH,
  CONNECT_WEBHOOK_TAG,
  type PayMode,
  type Readiness,
} from "./stripe";

export type ConnectDeps = {
  /** Service-role rpc for the server-only client payment functions. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
  stripe: (mode: PayMode) => ConnectStripe;
  /** The app's own origin, like https://app.meetathena.io. */
  origin: string;
};

type ServerRow = {
  company_id: string;
  company: string;
  mode: PayMode;
  account_test: string | null;
  account_live: string | null;
  status_test: Readiness;
  status_live: Readiness;
};

const row = async (deps: ConnectDeps, companyId: string): Promise<ServerRow> => {
  const r = (await deps.rpc("mcp_client_payments_server_get", {
    _company: companyId,
  })) as ServerRow | null;
  if (!r?.company_id) throw new Error("Unknown company.");
  return r;
};

/** Makes sure Stripe sends this mode's connected-account events to Athena. One endpoint, made once. */
export async function ensureWebhook(stripe: ConnectStripe, origin: string): Promise<string> {
  const url = `${origin}${CONNECT_WEBHOOK_PATH}`;
  const found = (await stripe.listWebhookEndpoints()).find(
    (w) => w.url === url && w.metadata?.athena === CONNECT_WEBHOOK_TAG,
  );
  if (found) return found.id;
  const made = await stripe.createWebhookEndpoint({
    url,
    enabled_events: [...CONNECT_WEBHOOK_EVENTS],
    connect: true,
    description: "Athena client payments (connected accounts)",
    metadata: { athena: CONNECT_WEBHOOK_TAG },
  });
  return made.id;
}

const accountPage = (origin: string, mode: PayMode, step: "return" | "refresh") =>
  `${origin}/account?payments=${step}&mode=${mode}#payments`;

/**
 * Starts or continues Stripe's setup for the company in one mode and returns Stripe's page to send the owner to.
 * The account is made once per company and mode; a fresh setup link is made each time (they expire in minutes).
 */
export async function startConnect(
  deps: ConnectDeps,
  p: { companyId: string; mode: PayMode; userId: string; email: string | null },
): Promise<{ url: string }> {
  const r = await row(deps, p.companyId);
  const stripe = deps.stripe(p.mode);
  let account = p.mode === "live" ? r.account_live : r.account_test;
  if (!account) {
    const made = await stripe.createAccount(
      {
        companyId: p.companyId,
        companyName: r.company,
        email: p.email,
        userId: p.userId,
        mode: p.mode,
      },
      `athena-connect:${p.companyId}:${p.mode}`,
    );
    account = made.id;
    await deps.rpc("mcp_client_payments_account_save", {
      _company: p.companyId,
      _mode: p.mode,
      _account: account,
      _status: accountReadiness(made),
      _by: p.userId,
    });
  }
  await ensureWebhook(stripe, deps.origin);
  return stripe.accountLink({
    account,
    refresh_url: accountPage(deps.origin, p.mode, "refresh"),
    return_url: accountPage(deps.origin, p.mode, "return"),
  });
}

/** Re-reads each connected account from Stripe and saves where its setup stands. */
export async function refreshConnect(
  deps: ConnectDeps,
  p: { companyId: string; userId: string; configured: (mode: PayMode) => boolean },
): Promise<void> {
  const r = await row(deps, p.companyId);
  for (const mode of ["test", "live"] as const) {
    const account = mode === "live" ? r.account_live : r.account_test;
    if (!account || !p.configured(mode)) continue;
    const a = await deps.stripe(mode).retrieveAccount(account);
    await deps.rpc("mcp_client_payments_account_save", {
      _company: p.companyId,
      _mode: mode,
      _account: account,
      _status: accountReadiness(a),
      _by: p.userId,
    });
  }
}

/** Turns live payments on, or back to test. The database refuses live until the live account is ready. */
export async function setPaymentMode(
  deps: ConnectDeps,
  p: { companyId: string; mode: PayMode; userId: string },
): Promise<unknown> {
  return deps.rpc("mcp_client_payments_set_mode", {
    _company: p.companyId,
    _mode: p.mode,
    _by: p.userId,
  });
}
