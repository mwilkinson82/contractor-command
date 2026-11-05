// Athena account page: Client payments (Nov 2026). A placeholder until online payments open. Nothing here connects,
// charges or stores anything; the button is disabled. Kept apart from Plan & billing, which is what the contractor pays.
import { Lock } from "lucide-react";

export function ClientPaymentsSection() {
  return (
    <>
      <section className="aa-card aa-connect" aria-labelledby="aa-pay-title">
        <div className="aa-connect-l">
          <div className="aa-row" style={{ justifyContent: "flex-start" }}>
            <span className="aa-pill aa-pill-violet">Coming soon</span>
          </div>
          <div>
            <h2 id="aa-pay-title">Get paid from the client page</h2>
            <p className="aa-lede">
              Your clients already approve invoices and pay apps on their client page. Soon they'll
              pay them there too, by card or bank, with the money going straight to your bank
              account.
            </p>
          </div>
          <ol className="aa-how">
            <li>
              <span>
                <strong>Connect your bank once</strong>
                <small>A secure page checks the owner's identity and your business details.</small>
              </span>
            </li>
            <li>
              <span>
                <strong>Clients see a Pay button</strong>
                <small>Only on invoices and pay apps they've approved.</small>
              </span>
            </li>
            <li>
              <span>
                <strong>Payments show up on the job</strong>
                <small>Marked paid on the pay app, with the date and amount.</small>
              </span>
            </li>
          </ol>
          <div className="aa-row" style={{ justifyContent: "flex-start" }}>
            <button type="button" className="aa-btn aa-btn-violet" disabled>
              <Lock size={14} aria-hidden="true" /> Connect payments
            </button>
            <span className="aa-hint">We'll let you know here when it opens.</span>
          </div>
        </div>
        <div className="aa-connect-r" aria-hidden="true">
          <div className="aa-payslip">
            <span className="aa-hint">Pay app #4 · approved</span>
            <span className="aa-amt aa-num">$48,250.00</span>
            <span className="aa-btn aa-btn-violet aa-btn-sm" style={{ justifySelf: "start" }}>
              Pay now
            </span>
            <span className="aa-hint">What your client will see</span>
          </div>
        </div>
      </section>
      <p className="aa-hint">
        This is separate from Plan & billing, which is what you pay for Athena. Your bank details
        are never stored in Athena.
      </p>
    </>
  );
}
