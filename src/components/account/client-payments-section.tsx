// Athena account page: Client payments. The company owner connects the company's own Stripe account, first in test
// mode, then live; clients then pay approved pay applications from their client page, and the money goes straight
// to that Stripe account. Kept apart from Plan & billing, which is what the contractor pays Athena.
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Loader2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  connectClientPayments,
  getClientPaymentsSetup,
  refreshClientPayments,
  setClientPaymentMode,
  type ClientPaymentsSetup,
} from "@/lib/client-payments.functions";
import {
  dollarsToCents,
  feeText,
  headline,
  modeAction,
  READINESS,
  type ClientPaymentsState,
} from "@/lib/client-payments/account-view";
import type { PayMode } from "@/lib/client-payments/stripe";

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc as unknown as Rpc;

const plainError = (m: string | undefined) =>
  m?.startsWith("MCP_BAD:") ? m.slice(8) : "That didn't save. Try again in a moment.";

function Explainer({ children }: { children?: React.ReactNode }) {
  return (
    <section className="aa-card aa-connect" aria-labelledby="aa-pay-title">
      <div className="aa-connect-l">
        <div>
          <h2 id="aa-pay-title">Get paid from the client page</h2>
          <p className="aa-lede">
            Your clients approve pay apps on their client page. Once you connect Stripe, they can
            pay them there too, by bank or card, and the money goes straight to your Stripe account.
          </p>
        </div>
        <ol className="aa-how">
          <li>
            <span>
              <strong>Connect your Stripe once</strong>
              <small>Stripe checks the owner's identity and your business and bank details.</small>
            </span>
          </li>
          <li>
            <span>
              <strong>Clients see Pay by bank and Pay by card</strong>
              <small>Only on pay apps they've approved, for the amount due.</small>
            </span>
          </li>
          <li>
            <span>
              <strong>Payments land on the job</strong>
              <small>Recorded as a receipt on the pay app, with a notice to your team.</small>
            </span>
          </li>
        </ol>
        {children}
      </div>
      <div className="aa-connect-r" aria-hidden="true">
        <div className="aa-payslip">
          <span className="aa-hint">Pay app #4 · approved</span>
          <span className="aa-amt aa-num">$48,250.00</span>
          <span className="aa-btn aa-btn-violet aa-btn-sm" style={{ justifySelf: "start" }}>
            Pay by bank
          </span>
          <span className="aa-hint">What your client will see</span>
        </div>
      </div>
    </section>
  );
}

export function ClientPaymentsSection({ companyId }: { companyId: string | null }) {
  const setupFn = useServerFn(getClientPaymentsSetup);
  const connectFn = useServerFn(connectClientPayments);
  const refreshFn = useServerFn(refreshClientPayments);
  const modeFn = useServerFn(setClientPaymentMode);
  const [state, setState] = useState<ClientPaymentsState | null>(null);
  const [setup, setSetup] = useState<ClientPaymentsSetup | null>(null);
  const [loading, setLoading] = useState(!!companyId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const returned = useRef(false);

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return null;
    }
    const [{ data, error: e }, s] = await Promise.all([
      rpc("mcp_client_payments_get", { _company: companyId }),
      setupFn().catch(() => null),
    ]);
    const st = e ? null : ((data as ClientPaymentsState | null) ?? null);
    setState(st);
    setSetup(s);
    setLoading(false);
    return st;
  }, [companyId, setupFn]);

  useEffect(() => {
    void load().then(async (st) => {
      // Back from Stripe: read where setup stands now. An expired setup link gets a fresh one.
      if (returned.current || !st?.can_manage || !companyId || typeof window === "undefined")
        return;
      const q = new URLSearchParams(window.location.search);
      const step = q.get("payments");
      const mode = q.get("mode") === "live" ? "live" : "test";
      if (!step) return;
      returned.current = true;
      window.history.replaceState(null, "", `${window.location.pathname}#payments`);
      if (step === "refresh") {
        const r = await connectFn({ data: { companyId, mode } }).catch(() => null);
        if (r?.status === "ok" && r.url) window.location.assign(r.url);
        return;
      }
      setBusy("refresh");
      await refreshFn({ data: { companyId } }).catch(() => null);
      await load();
      setBusy(null);
    });
  }, [load, companyId, connectFn, refreshFn]);

  const connect = async (mode: PayMode) => {
    if (!companyId) return;
    setBusy(`connect-${mode}`);
    setError(null);
    const r = await connectFn({ data: { companyId, mode } }).catch(() => null);
    if (r?.status === "ok" && r.url) {
      window.location.assign(r.url);
      return;
    }
    setBusy(null);
    setError(
      r?.status === "not_owner"
        ? "Only the company owner can set up payments."
        : r?.status === "not_configured"
          ? "Payments aren't open in this mode yet."
          : (r && "message" in r && r.message) || "Stripe didn't answer. Try again in a moment.",
    );
  };

  const check = async () => {
    if (!companyId) return;
    setBusy("refresh");
    setError(null);
    const r = await refreshFn({ data: { companyId } }).catch(() => null);
    if (r?.status !== "ok") setError("We couldn't reach Stripe. Try again in a moment.");
    await load();
    setBusy(null);
  };

  const switchMode = async (mode: PayMode) => {
    if (!companyId) return;
    setBusy(`mode-${mode}`);
    setError(null);
    const r = await modeFn({ data: { companyId, mode } }).catch(() => null);
    if (r?.status !== "ok")
      setError(r && "message" in r && r.message ? r.message : "That didn't save. Try again.");
    await load();
    setBusy(null);
  };

  if (loading)
    return (
      <section className="aa-card">
        <p className="aa-hint">
          <Loader2 size={14} className="aa-spin" aria-hidden="true" /> Loading client payments…
        </p>
      </section>
    );

  // Before the database part is in place, or with no company: the plain explainer, nothing to press.
  if (!state || !companyId)
    return (
      <Explainer>
        <div className="aa-row" style={{ justifyContent: "flex-start" }}>
          <button type="button" className="aa-btn aa-btn-violet" disabled>
            <Lock size={14} aria-hidden="true" /> Connect Stripe
          </button>
          <span className="aa-hint">Opens soon.</span>
        </div>
      </Explainer>
    );

  return (
    <ClientPaymentsPanel
      companyId={companyId}
      state={state}
      setup={setup}
      busy={busy}
      error={error}
      connect={connect}
      check={check}
      switchMode={switchMode}
      load={load}
    />
  );
}

/** The section once its state is read. Apart from the loading, so it renders on its own for tests and previews. */
export function ClientPaymentsPanel({
  companyId,
  state,
  setup,
  busy,
  error,
  connect,
  check,
  switchMode,
  load,
}: {
  companyId: string;
  state: ClientPaymentsState;
  setup: ClientPaymentsSetup | null;
  busy: string | null;
  error: string | null;
  connect: (mode: PayMode) => void | Promise<void>;
  check: () => void | Promise<void>;
  switchMode: (mode: PayMode) => void | Promise<void>;
  load: () => Promise<unknown>;
}) {
  const owner = state.can_manage;
  const configured = setup?.configured ?? { test: false, live: false };
  const head = headline(state);
  const anyConnected = state.test.connected || state.live.connected;
  const canGoLive = state.mode === "test" && state.live.status === "ready";

  const row = (mode: PayMode) => {
    const r = mode === "live" ? state.live : state.test;
    const tone = READINESS[r.status];
    const act = modeAction(r.status, configured[mode], mode);
    const id = `connect-${mode}`;
    return (
      <div className="aa-paymode" key={mode}>
        <div className="aa-paymode-l">
          <strong>{mode === "live" ? "Live payments" : "Test payments"}</strong>
          <small>
            {mode === "live"
              ? "Real money from your clients, paid out to your bank by Stripe."
              : "Try it end to end with Stripe's test bank and card. No real money moves."}
          </small>
        </div>
        <div className="aa-paymode-r">
          <span className={`aa-pill aa-pill-${tone.tone}`}>{tone.label}</span>
          {owner && act.kind === "closed" ? <span className="aa-hint">{act.label}</span> : null}
          {owner && (act.kind === "connect" || act.kind === "continue") ? (
            <button
              type="button"
              className={`aa-btn ${act.kind === "connect" && mode === "test" ? "aa-btn-primary" : ""} aa-btn-sm`}
              onClick={() => void connect(mode)}
              disabled={!!busy}
            >
              {busy === id ? <Loader2 size={14} className="aa-spin" aria-hidden="true" /> : null}
              {act.label}
            </button>
          ) : null}
          {owner && act.kind === "check" ? (
            <button
              type="button"
              className="aa-btn aa-btn-sm"
              onClick={() => void check()}
              disabled={!!busy}
            >
              {busy === "refresh" ? (
                <Loader2 size={14} className="aa-spin" aria-hidden="true" />
              ) : null}
              {act.label}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <>
      <Explainer>
        <div className="aa-row" style={{ justifyContent: "flex-start" }}>
          <span className={`aa-pill aa-pill-${head.tone}`}>{head.text}</span>
        </div>
      </Explainer>

      <section className="aa-card" aria-labelledby="aa-pay-setup">
        <div className="aa-row">
          <h2 id="aa-pay-setup">Your Stripe account</h2>
          {anyConnected ? (
            <a
              className="aa-btn aa-btn-ghost aa-btn-sm"
              href="https://dashboard.stripe.com/"
              target="_blank"
              rel="noreferrer noopener"
            >
              Open Stripe <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
        <p className="aa-lede">
          Payouts, receipts and refunds live in your own Stripe dashboard. A refund there comes off
          the job's billing in Athena on its own.
        </p>
        <div className="aa-paymodes">
          {row("test")}
          {row("live")}
        </div>
        {owner && canGoLive ? (
          <div className="aa-save-bar">
            <span className="aa-hint">
              Live setup is ready. Turning it on shows clients real Pay buttons.
            </span>
            <button
              type="button"
              className="aa-btn aa-btn-primary"
              onClick={() => void switchMode("live")}
              disabled={!!busy}
            >
              {busy === "mode-live" ? (
                <Loader2 size={14} className="aa-spin" aria-hidden="true" />
              ) : null}
              Turn on live payments
            </button>
          </div>
        ) : null}
        {owner && state.mode === "live" ? (
          <div className="aa-save-bar">
            <span className="aa-hint">Clients are paying for real.</span>
            <button
              type="button"
              className="aa-btn aa-btn-ghost"
              onClick={() => void switchMode("test")}
              disabled={!!busy}
            >
              Switch back to test
            </button>
          </div>
        ) : null}
        {!owner ? <p className="aa-hint">Only the company owner can set up payments.</p> : null}
        {error ? (
          <p className="aa-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {anyConnected ? (
        <WaysToPay
          key={`${state.card_enabled}-${state.bank_enabled}-${state.card_max_cents}`}
          companyId={companyId}
          state={state}
          onSaved={load}
        />
      ) : null}

      <p className="aa-hint">
        {setup ? feeText(setup.fee) : ""} This is separate from Plan & billing, which is what you
        pay for Athena. Your bank details stay with Stripe, never in Athena.
      </p>
    </>
  );
}

function WaysToPay({
  companyId,
  state,
  onSaved,
}: {
  companyId: string;
  state: ClientPaymentsState;
  onSaved: () => Promise<unknown>;
}) {
  const [bank, setBank] = useState(state.bank_enabled);
  const [card, setCard] = useState(state.card_enabled);
  const [max, setMax] = useState(String(state.card_max_cents / 100));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const owner = state.can_manage;
  const cents = dollarsToCents(max);
  const changed =
    bank !== state.bank_enabled || card !== state.card_enabled || cents !== state.card_max_cents;

  const save = async () => {
    if (!bank && !card) return setMsg({ ok: false, text: "Keep at least one way to pay." });
    if (cents === null)
      return setMsg({ ok: false, text: "Card limit must be between $1 and $1,000,000." });
    setSaving(true);
    setMsg(null);
    const { error } = await rpc("mcp_client_payments_settings", {
      _company: companyId,
      _card: card,
      _bank: bank,
      _card_max_cents: cents,
    });
    setSaving(false);
    if (error) return setMsg({ ok: false, text: plainError(error.message) });
    setMsg({ ok: true, text: "Saved." });
    await onSaved();
  };

  return (
    <section className="aa-card" aria-labelledby="aa-pay-ways">
      <h2 id="aa-pay-ways">Ways your clients can pay</h2>
      <p className="aa-lede">
        Bank payments cost you the least and suit large pay apps; they take a few business days to
        clear. Card is instant and costs more, so it has a limit.
      </p>
      <div className="aa-payways">
        <label className="aa-paycheck">
          <input
            type="checkbox"
            checked={bank}
            disabled={!owner}
            onChange={(e) => setBank(e.target.checked)}
          />
          <span>
            <strong>Bank (ACH)</strong>
            <small>Your client signs in to their bank on Stripe's page.</small>
          </span>
        </label>
        <label className="aa-paycheck">
          <input
            type="checkbox"
            checked={card}
            disabled={!owner}
            onChange={(e) => setCard(e.target.checked)}
          />
          <span>
            <strong>Card</strong>
            <small>Offered only when the amount due is at or under your card limit.</small>
          </span>
        </label>
        <label className="aa-field aa-paymax">
          <span className="aa-flabel">Card limit (dollars)</span>
          <input
            inputMode="decimal"
            value={max}
            disabled={!owner || !card}
            onChange={(e) => setMax(e.target.value)}
            aria-invalid={cents === null}
          />
        </label>
      </div>
      {owner ? (
        <div className="aa-save-bar">
          {msg ? (
            <span className={msg.ok ? "aa-saved" : "aa-error"} role={msg.ok ? "status" : "alert"}>
              {msg.text}
            </span>
          ) : (
            <span className="aa-hint">Clients see the change the next time they open billing.</span>
          )}
          <button
            type="button"
            className="aa-btn aa-btn-primary"
            onClick={() => void save()}
            disabled={saving || !changed}
          >
            {saving ? <Loader2 size={14} className="aa-spin" aria-hidden="true" /> : null}
            Save
          </button>
        </div>
      ) : null}
    </section>
  );
}
