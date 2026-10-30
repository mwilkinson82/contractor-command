import { useState } from "react";
import { extendedCents } from "@/lib/accounting-report";
import {
  approvalFacts,
  orderTotal,
  orderVersions,
  poDate,
  poMoney,
  statusLabel,
  type PurchaseOrder,
  type PurchaseOrderLedger,
  type PurchaseOrderParty,
  type PurchaseOrderTerms,
  type PurchaseOrderVersion,
} from "@/lib/purchase-order-workspace";

export function OrderLines({
  version,
  caption,
}: {
  version: PurchaseOrderVersion;
  caption?: string;
}) {
  const total = orderTotal(version);
  return (
    <div
      className="po-table-scroll"
      role="region"
      aria-label={`Version ${version.version} line items`}
      tabIndex={0}
    >
      <table className="po-lines">
        <caption className="po-sr-only">
          {caption ?? `Version ${version.version} purchase-order line items`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Line item</th>
            <th scope="col">Quantity</th>
            <th scope="col">Rate</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {version.lines.map((line, i) => (
            <tr key={i}>
              <td data-label="Line item">{line.description}</td>
              <td data-label="Quantity">
                {new Intl.NumberFormat("en-US", { maximumFractionDigits: 12 }).format(
                  line.quantity,
                )}{" "}
                {line.unit}
              </td>
              <td data-label="Rate">
                {poMoney(line.unit_price_cents)} / {line.unit}
              </td>
              <td data-label="Amount">
                {poMoney(extendedCents(line.quantity, line.unit_price_cents))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={3}>
              Order total (USD)
            </th>
            <td>{poMoney(total)}</td>
          </tr>
        </tfoot>
      </table>
      {total === null && (
        <p className="po-warning">
          A line or total cannot be represented as whole cents at supported precision. No amount has
          been rounded.
        </p>
      )}
    </div>
  );
}
export function SupplierContext({
  party,
  version,
}: {
  party: PurchaseOrderParty | undefined;
  version: PurchaseOrderVersion | undefined;
}) {
  return (
    <section className="po-panel po-supplier">
      <h2>Supplier</h2>
      <div className="po-panel-body">
        <h3>{version?.party_snapshot.name ?? party?.name ?? "Supplier unavailable"}</h3>
        <p className="po-muted">{party?.trade ?? "Trade not recorded"}</p>
        {party && version?.party_snapshot.name !== party.name && (
          <p className="po-muted">Current directory name: {party.name}</p>
        )}
        <dl className="po-facts">
          <div>
            <dt>Current project contact</dt>
            <dd>
              {party?.contact_name ?? "Not recorded"}
              {party?.contact_email && <span>{party.contact_email}</span>}
              {party?.contact_phone && <span>{party.contact_phone}</span>}
            </dd>
          </div>
          <div>
            <dt>Contract reference</dt>
            <dd>{party?.contract_reference ?? "Not recorded"}</dd>
          </div>
          <div>
            <dt>Insurance reference</dt>
            <dd>{party?.insurance_reference ?? "Not recorded"}</dd>
          </div>
        </dl>
        <p className="po-small po-muted">
          Current directory references are separate from the saved supplier identity. A contact
          listing is not approval authority; an insurance reference is not coverage verification.
        </p>
      </div>
    </section>
  );
}
export function TermsEvidence({
  terms,
  parent,
  isDefault = false,
}: {
  terms: PurchaseOrderTerms | undefined;
  parent: PurchaseOrderTerms | undefined;
  isDefault?: boolean;
}) {
  if (!terms)
    return (
      <p className="po-muted">
        Terms are unavailable to this view. Ask the company owner to review the applicable version.
      </p>
    );
  return (
    <div className="po-terms">
      <p>
        <strong>{terms.title}</strong> · {terms.scope} · {terms.state}
        {isDefault ? " · company default" : ""}
      </p>
      <p className="po-small po-muted">Source: {terms.source}</p>
      {terms.change_note && <p>Changes: {terms.change_note}</p>}
      <pre>{terms.body}</pre>
      {terms.state === "proposed" && (
        <p className="po-warning">
          Proposed terms are not effective before separate owner approval.
        </p>
      )}
      {terms.parent_id && (
        <details>
          <summary>Base terms</summary>
          {parent ? (
            <>
              <p>
                {parent.title} · {parent.scope} · {parent.state}
              </p>
              <pre>{parent.body}</pre>
            </>
          ) : (
            <p className="po-muted">Base text is unavailable to this view.</p>
          )}
        </details>
      )}
    </div>
  );
}
function Comparison({
  versions,
  ledger,
  onClose,
}: {
  versions: PurchaseOrderVersion[];
  ledger: PurchaseOrderLedger;
  onClose: () => void;
}) {
  const [left, setLeft] = useState(versions[1]?.version ?? versions[0].version),
    [right, setRight] = useState(versions[0].version);
  return (
    <section className="po-panel po-comparison">
      <div className="po-panel-head">
        <h2>Compare saved versions</h2>
        <button type="button" className="po-button po-subtle" onClick={onClose}>
          Close comparison
        </button>
      </div>
      <p className="po-panel-body po-small po-muted">
        Compare the retained records below. Line items use their saved row order.
      </p>
      <div className="po-compare-grid">
        {[
          { value: left, set: setLeft, label: "Earlier version" },
          { value: right, set: setRight, label: "Later version" },
        ].map(({ value, set, label }) => {
          const v = versions.find((v) => v.version === value) ?? versions[0];
          const t = ledger.terms.find((t) => t.id === v.terms_id);
          return (
            <div key={label}>
              <label className="po-field">
                {label}
                <select value={value} onChange={(e) => set(Number(e.target.value))}>
                  {versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      Version {v.version} · {statusLabel(v.status)}
                    </option>
                  ))}
                </select>
              </label>
              <h3>
                Version {v.version} · {statusLabel(v.status)}
              </h3>
              <p>Supplier at this version: {v.party_snapshot.name}</p>
              <p>
                Order date {poDate(v.order_date)} · Needed by {poDate(v.needed_by)}
              </p>
              <p>Revision: {v.reason ?? "No reason recorded"}</p>
              <OrderLines version={v} />
              <TermsEvidence terms={t} parent={ledger.terms.find((p) => p.id === t?.parent_id)} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
export function PurchaseOrderDetails({
  order,
  ledger,
  onSelectVersion,
  initialVersion,
}: {
  order: PurchaseOrder;
  ledger: PurchaseOrderLedger;
  onSelectVersion?: (v: PurchaseOrderVersion) => void;
  initialVersion?: number;
}) {
  const versions = orderVersions(order),
    current = versions[0];
  const [view, setView] = useState<number | null>(initialVersion ?? null),
    [compare, setCompare] = useState(false);
  const selected = versions.find((v) => v.version === view) ?? current;
  if (!selected)
    return (
      <section className="po-panel">
        <h2>{order.number}</h2>
        <p className="po-panel-body">No saved revisions are available for this order.</p>
      </section>
    );
  const terms = ledger.terms.find((t) => t.id === selected.terms_id),
    facts = approvalFacts(selected);
  function selectVersion(version: number) {
    setView(version);
    onSelectVersion?.(versions.find((v) => v.version === version) ?? current);
  }
  return (
    <div className="po-detail-stack" id="po-selected-order">
      <section className="po-panel">
        <header className="po-panel-head">
          <h2>{order.number}</h2>
          <span className={`po-badge po-status-${selected.status}`}>
            {statusLabel(selected.status)} · version {selected.version}
          </span>
        </header>
        <div className="po-detail-summary">
          <div>
            <span className="po-label">Order total - USD</span>
            <strong>{poMoney(orderTotal(selected))}</strong>
          </div>
          <div>
            <span className="po-label">Needed by</span>
            <strong>{poDate(selected.needed_by)}</strong>
          </div>
        </div>
        {selected.version !== current.version && (
          <p className="po-history-notice">
            Viewing immutable version {selected.version}. Current revision is version{" "}
            {current.version}.{" "}
            <button className="po-inline-button" onClick={() => selectVersion(current.version)}>
              Return to current revision
            </button>
          </p>
        )}
        <OrderLines version={selected} />
      </section>
      <section className="po-panel">
        <h2>Terms & revision evidence</h2>
        <div className="po-panel-body">
          <span className="po-label">
            {selected.version === current.version ? "Current revision" : "Historical revision"}
          </span>
          <p>{selected.reason ?? "No revision reason recorded."}</p>
          <p className="po-muted">
            Order date: {poDate(selected.order_date)} · Supplier at this version:{" "}
            {selected.party_snapshot.name}
          </p>
          <span className="po-label">Selected terms</span>
          <TermsEvidence
            terms={terms}
            parent={ledger.terms.find((t) => t.id === terms?.parent_id)}
            isDefault={terms?.id === ledger.default_terms_id}
          />
        </div>
        <div className="po-version-bar">
          <label>
            View revision
            <select
              aria-label="View revision"
              value={selected.version}
              onChange={(e) => selectVersion(Number(e.target.value))}
            >
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  Version {v.version}
                  {v.version === current.version ? " - current" : ""} · {statusLabel(v.status)}
                </option>
              ))}
            </select>
          </label>
          {versions.length > 1 && (
            <button className="po-button po-subtle" onClick={() => setCompare((v) => !v)}>
              {compare ? "Hide comparison" : "Compare versions"}
            </button>
          )}
        </div>
      </section>
      {compare && (
        <Comparison
          key={order.id}
          versions={versions}
          ledger={ledger}
          onClose={() => setCompare(false)}
        />
      )}
      <section className="po-commercial">
        <h2 className="po-sr-only">Commercial status</h2>
        <dl>
          <div>
            <dt>Internal approval</dt>
            <dd>{facts.internal}</dd>
          </div>
          <div>
            <dt>Issuance</dt>
            <dd>{facts.issuance}</dd>
          </div>
          <div>
            <dt>Supplier acceptance</dt>
            <dd>{facts.acceptance}</dd>
          </div>
        </dl>
        <p>
          Commitments, not posted costs or payments. Owner approval does not establish supplier
          acceptance; proposed terms are not effective before owner approval.
        </p>
      </section>
      <details className="po-panel po-history">
        <summary>Immutable version history ({versions.length})</summary>
        {versions.map((v) => {
          const t = ledger.terms.find((t) => t.id === v.terms_id);
          return (
            <article key={v.version}>
              <h3>
                Version {v.version} · {statusLabel(v.status).toLowerCase()}
              </h3>
              <p>
                Order date {poDate(v.order_date)} · Needed by {poDate(v.needed_by)}
              </p>
              <p>Supplier at this version: {v.party_snapshot.name}</p>
              {v.reason && <p>Revision: {v.reason}</p>}
              <OrderLines version={v} />
              <TermsEvidence terms={t} parent={ledger.terms.find((t) => t.id === t?.parent_id)} />
            </article>
          );
        })}
      </details>
    </div>
  );
}
