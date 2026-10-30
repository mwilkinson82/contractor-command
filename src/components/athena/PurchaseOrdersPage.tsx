import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { BoardSignIn } from "./BoardSignIn";
import { PurchaseOrderDetails, SupplierContext, TermsEvidence } from "./PurchaseOrderDetails";
import { PurchaseOrderBuyout } from "./PurchaseOrderBuyout";
import { PurchaseOrderRevision } from "./PurchaseOrderRevision";
import {
  filterPurchaseOrders,
  orderTotal,
  orderVersions,
  poMoney,
  statusLabel,
  type PurchaseOrder,
  type PurchaseOrderParty,
  type PurchaseOrderTerms,
  type PurchaseOrderLedger,
  type PurchaseOrderContext,
  type PoRpc,
} from "@/lib/purchase-order-workspace";
import "./purchase-order-workspace.css";

const rpc = supabase.rpc.bind(supabase) as unknown as PoRpc;
type Tab = "orders" | "suppliers" | "terms";
type Revision = {
  order: PurchaseOrder;
  party: PurchaseOrderParty;
  terms: PurchaseOrderTerms;
  context: PurchaseOrderContext;
};
const navigation = [
  ["home", "Overview"],
  ["schedule", "Schedule & lookahead"],
  ["items", "Open items"],
  ["daily", "Daily reports"],
  ["production", "Production"],
  ["photos", "Photos"],
  ["accounting", "Accounting evidence"],
  ["purchase-orders", "Purchase orders"],
  ["billing-records", "Billing records"],
] as const;
function Shell({
  jobId,
  context,
  children,
}: {
  jobId: string;
  context?: PurchaseOrderContext;
  children: React.ReactNode;
}) {
  return (
    <main className="po-workspace">
      <header className="po-topbar">
        <a className="po-brand" href={`/r/job/${jobId}/home`} aria-label="Athena project home">
          ATHENA
        </a>
        <div className="po-project-context">
          {context ? (
            <>
              <span>{context.companyName}</span>
              <span aria-hidden="true">/</span>
              <strong>
                {context.jobNumber} - {context.jobName}
              </strong>
            </>
          ) : (
            <span>Project purchase orders</span>
          )}
        </div>
      </header>
      <div className="po-shell">
        <aside className="po-sidebar">
          <nav aria-label="Project workspace">
            {navigation.map(([path, label]) => (
              <a
                key={path}
                href={`/r/job/${jobId}/${path}`}
                aria-current={path === "purchase-orders" ? "page" : undefined}
              >
                {label}
              </a>
            ))}
          </nav>
        </aside>
        <div className="po-main">{children}</div>
      </div>
    </main>
  );
}
export function PurchaseOrdersPage({
  jobId,
  initialTab = "orders",
}: {
  jobId: string;
  initialTab?: Tab;
}) {
  const { session, loading } = useAuth();
  if (loading)
    return (
      <Shell jobId={jobId}>
        <h1>Suppliers & purchase orders</h1>
        <p role="status">Checking project access…</p>
      </Shell>
    );
  if (!session) return <BoardSignIn returnTo={`/r/job/${jobId}/purchase-orders`} />;
  return (
    <AuthorizedPurchaseOrdersPage
      key={`${jobId}:${session.user.id}:${initialTab}`}
      jobId={jobId}
      userId={session.user.id}
      initialTab={initialTab}
    />
  );
}
function AuthorizedPurchaseOrdersPage({
  jobId,
  userId,
  initialTab,
}: {
  jobId: string;
  userId: string;
  initialTab: Tab;
}) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [supplier, setSupplier] = useState(""),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [sidebarView, setSidebarView] = useState<{ orderId: string; version: number } | null>(null),
    [initialPin, setInitialPin] = useState<{ orderId: string; version: number } | null>(null),
    [revision, setRevision] = useState<Revision | null>(null),
    [notice, setNotice] = useState("");
  const result = useQuery({
    queryKey: ["purchase-orders", jobId, userId],
    enabled: true,
    retry: false,
    queryFn: async () => {
      const r = await rpc("mcp_project_purchase_orders_get", { _job: jobId });
      if (r.error) throw new Error("Purchase orders unavailable.");
      return r.data as PurchaseOrderLedger;
    },
  });
  const context = useQuery({
    queryKey: ["purchase-order-context", jobId, userId],
    enabled: !!result.data && !result.error,
    retry: false,
    queryFn: async () => {
      const j = await supabase
        .from("mcp_jobs")
        .select("id,job_number,name,company_id")
        .eq("id", jobId)
        .single();
      if (j.error || !j.data || j.data.id !== jobId)
        throw new Error("Project details unavailable.");
      const c = await supabase
        .from("mcp_companies")
        .select("id,name")
        .eq("id", j.data.company_id!)
        .single();
      if (c.error || !c.data || c.data.id !== j.data.company_id)
        throw new Error("Company details unavailable.");
      return {
        companyId: c.data.id,
        companyName: c.data.name,
        jobNumber: j.data.job_number,
        jobName: j.data.name,
      } as PurchaseOrderContext;
    },
  });
  if (result.isLoading)
    return (
      <Shell jobId={jobId}>
        <h1>Suppliers & purchase orders</h1>
        <p role="status">Loading purchase orders…</p>
      </Shell>
    );
  if (!result.data)
    return (
      <Shell jobId={jobId}>
        <h1>Suppliers & purchase orders</h1>
        <div className="po-error" role="alert">
          <p>
            Purchase orders are unavailable for this project. Your role must have full project
            access.
          </p>
          <button className="po-button" onClick={() => void result.refetch()}>
            Retry loading
          </button>
          <a href={`/r/job/${jobId}/home`}>Back to project home</a>
        </div>
      </Shell>
    );
  const ledger = result.data,
    visible = filterPurchaseOrders(ledger, { search, status, supplier });
  const selected = visible.find((o) => o.id === selectedId) ?? visible[0];
  const current = selected && orderVersions(selected)[0];
  const currentParty = ledger.parties.find((p) => p.id === selected?.party_id),
    currentTerms = ledger.terms.find((t) => t.id === current?.terms_id);
  const canRevise =
    !!context.data &&
    !context.error &&
    !result.error &&
    !result.isFetching &&
    !refreshing &&
    !!current &&
    !!currentParty?.version &&
    currentTerms?.state === "approved" &&
    !!currentTerms.approved_by &&
    !["issued", "accepted"].includes(current.status);
  const supplierChoices = [
    ...new Map(
      ledger.orders.map((o) => [
        o.party_id,
        ledger.parties.find((p) => p.id === o.party_id)?.name ??
          orderVersions(o)[0]?.party_snapshot.name ??
          "Supplier unavailable",
      ]),
    ).entries(),
  ];
  function resetSelection() {
    setSelectedId(null);
    setSidebarView(null);
    setInitialPin(null);
    setNotice("");
  }
  async function refreshVisible() {
    setRefreshing(true);
    setNotice("");
    try {
      await Promise.all([
        result.refetch(),
        context.refetch(),
        ...(context.data
          ? [
              queryClient.invalidateQueries({
                queryKey: ["po-buyout", context.data.companyId, jobId, userId],
              }),
            ]
          : []),
      ]);
    } finally {
      setRefreshing(false);
    }
  }
  async function finishRevision(message: string) {
    setRevision(null);
    setNotice(message);
    await result.refetch();
    if (context.data)
      await queryClient.invalidateQueries({
        queryKey: ["po-buyout", context.data.companyId, jobId, userId],
      });
  }
  function startRevision() {
    if (!canRevise || !selected || !currentParty || !currentTerms || !context.data) return;
    setNotice("");
    setRevision(
      structuredClone({
        order: selected,
        party: currentParty,
        terms: currentTerms,
        context: context.data,
      }),
    );
  }
  return (
    <Shell jobId={jobId} context={context.data}>
      <div className="po-page-head">
        <div>
          <h1>Suppliers & purchase orders</h1>
          <div
            className="po-tabs"
            role="tablist"
            aria-label="Supplier and purchase order views"
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
              );
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                      buttons.length;
              buttons[next].click();
              buttons[next].focus();
            }}
          >
            {(
              [
                ["orders", "Purchase orders"],
                ["suppliers", "Suppliers"],
                ["terms", "Terms & approvals"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                id={`po-tab-${value}`}
                role="tab"
                aria-selected={tab === value}
                tabIndex={tab === value ? 0 : -1}
                aria-controls={`po-panel-${value}`}
                disabled={!!revision}
                onClick={() => {
                  setTab(value);
                  setSearch("");
                  setNotice("");
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="po-actions">
          {tab === "orders" && !revision && (
            <button className="po-button po-primary" disabled={!canRevise} onClick={startRevision}>
              Propose revision
            </button>
          )}
          <button
            className="po-button po-refresh"
            disabled={!!revision || result.isFetching || refreshing}
            onClick={() => void refreshVisible()}
          >
            {result.isFetching || refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      {notice && (
        <p className="po-notice" role="status">
          {notice}
        </p>
      )}
      {result.error && (
        <p className="po-error" role="alert">
          Refresh failed. Showing previously loaded records; refresh successfully before proposing a
          revision.
        </p>
      )}
      {context.error && (
        <p className="po-warning">
          Project identity details are unavailable. Records remain read-only until the company and
          job can be confirmed.
        </p>
      )}
      {revision ? (
        <PurchaseOrderRevision
          key={revision.order.id}
          jobId={jobId}
          {...revision}
          rpc={rpc}
          onFinish={finishRevision}
        />
      ) : (
        <>
          <div className="po-filters">
            <label className="po-field po-search">
              {tab === "orders"
                ? "Search orders or suppliers"
                : tab === "suppliers"
                  ? "Search suppliers and contacts"
                  : "Search terms and sources"}
              <input
                type="search"
                value={search}
                placeholder={
                  tab === "orders"
                    ? "PO number, supplier or trade"
                    : tab === "suppliers"
                      ? "Name, trade or contact"
                      : "Title, text or source"
                }
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetSelection();
                }}
              />
            </label>
            {tab === "orders" && (
              <>
                <label className="po-field">
                  Status
                  <select
                    value={status}
                    onChange={(e) => {
                      setStatus(e.target.value);
                      resetSelection();
                    }}
                  >
                    <option value="">All statuses</option>
                    {["draft", "reviewed", "approved", "issued", "accepted"].map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="po-field">
                  Supplier
                  <select
                    value={supplier}
                    onChange={(e) => {
                      setSupplier(e.target.value);
                      resetSelection();
                    }}
                  >
                    <option value="">All suppliers</option>
                    {supplierChoices.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {(search || status || supplier) && (
              <button
                className="po-button po-subtle"
                onClick={() => {
                  setSearch("");
                  setStatus("");
                  setSupplier("");
                  resetSelection();
                }}
              >
                Clear filters
              </button>
            )}
          </div>
          {tab === "orders" && (
            <section id="po-panel-orders" role="tabpanel" aria-labelledby="po-tab-orders">
              <p className="po-result-count" role="status">
                {visible.length} of {ledger.orders.length} purchase orders
              </p>
              {!ledger.orders.length ? (
                <div className="po-empty">
                  <h2>No purchase orders recorded</h2>
                  <p>
                    Create a draft with Athena after selecting the job, project supplier and
                    applicable terms. No example records have been added.
                  </p>
                </div>
              ) : !visible.length ? (
                <div className="po-empty">
                  <h2>No orders match these filters</h2>
                  <p>Change the search, status or supplier, or clear the filters.</p>
                </div>
              ) : (
                <div className="po-workspace-grid">
                  <div className="po-list-column">
                    <section className="po-panel po-order-list">
                      <h2>Purchase orders</h2>
                      <ul>
                        {visible.map((o) => {
                          const v = orderVersions(o)[0];
                          return (
                            <li key={o.id}>
                              <button
                                className="po-order-pick"
                                aria-pressed={selected?.id === o.id}
                                onClick={() => {
                                  setSelectedId(o.id);
                                  setInitialPin(null);
                                  setSidebarView(null);
                                  setNotice("");
                                }}
                              >
                                <span
                                  className={`po-list-status po-status-${v?.status ?? "unknown"}`}
                                >
                                  {v ? statusLabel(v.status) : "No saved version"}
                                </span>
                                <strong>{o.number}</strong>
                                <span className="po-muted">
                                  {v?.party_snapshot.name ?? "Supplier unavailable"}
                                </span>
                                <span className="po-list-bottom">
                                  <b>{v ? poMoney(orderTotal(v)) : "Unavailable"}</b>
                                  <span>v{v?.version ?? "?"}</span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                    <a className="po-mobile-jump" href="#po-selected-order">
                      View selected order ↓
                    </a>
                    <SupplierContext
                      party={currentParty}
                      version={
                        sidebarView?.orderId === selected?.id
                          ? (orderVersions(selected!).find(
                              (v) => v.version === sidebarView.version,
                            ) ?? current)
                          : current
                      }
                    />
                    {current && ["issued", "accepted"].includes(current.status) && (
                      <p className="po-small po-muted">
                        Issued or accepted orders cannot be revised here.
                      </p>
                    )}
                    {current && !canRevise && !["issued", "accepted"].includes(current.status) && (
                      <p className="po-small po-muted">
                        Revision requires the confirmed job, current project party and applicable
                        approved terms available to your role.
                      </p>
                    )}
                  </div>
                  {selected && (
                    <PurchaseOrderDetails
                      key={`${selected.id}:${initialPin?.orderId === selected.id ? initialPin.version : "current"}`}
                      initialVersion={
                        initialPin?.orderId === selected.id ? initialPin.version : undefined
                      }
                      order={selected}
                      ledger={ledger}
                      onSelectVersion={(v) =>
                        setSidebarView({ orderId: selected.id, version: v.version })
                      }
                    />
                  )}
                </div>
              )}
            </section>
          )}
          {tab === "suppliers" && (
            <section id="po-panel-suppliers" role="tabpanel" aria-labelledby="po-tab-suppliers">
              <h2 className="po-section-title">Project suppliers & subcontractors</h2>
              {context.data && (
                <PurchaseOrderBuyout
                  jobId={jobId}
                  companyId={context.data.companyId}
                  userId={userId}
                  rpc={rpc}
                  onOpenOrder={async (id, version) => {
                    const fresh = await result.refetch();
                    if (
                      fresh.error ||
                      !fresh.data?.orders.some(
                        (o) => o.id === id && o.versions.some((v) => v.version === version),
                      )
                    ) {
                      setNotice(
                        "The pinned PO/version is unavailable. No other order has been selected.",
                      );
                      return;
                    }
                    setTab("orders");
                    setSearch("");
                    setStatus("");
                    setSupplier("");
                    setSelectedId(id);
                    setSidebarView({ orderId: id, version });
                    setInitialPin({ orderId: id, version });
                  }}
                />
              )}
              {!ledger.parties.length ? (
                <p className="po-empty">
                  No project parties recorded. Add or select a party with Athena before preparing an
                  order.
                </p>
              ) : (
                <div className="po-supplier-grid">
                  {ledger.parties
                    .filter((p) =>
                      [p.name, p.trade, p.contact_name, p.contact_email, p.contact_phone]
                        .filter(Boolean)
                        .join(" ")
                        .toLowerCase()
                        .includes(search.trim().toLowerCase()),
                    )
                    .map((p) => (
                      <article className="po-panel" key={p.id}>
                        <div className="po-panel-body">
                          <h3>{p.name}</h3>
                          <p className="po-muted">
                            {p.kind === "both" ? "Supplier and subcontractor" : p.kind}
                            {p.trade ? ` · ${p.trade}` : ""}
                          </p>
                          <dl className="po-facts">
                            <div>
                              <dt>Contact</dt>
                              <dd>
                                {[p.contact_name, p.contact_email, p.contact_phone]
                                  .filter(Boolean)
                                  .join(" · ") || "Not recorded"}
                              </dd>
                            </div>
                            <div>
                              <dt>Contract reference</dt>
                              <dd>{p.contract_reference ?? "Not recorded"}</dd>
                            </div>
                            <div>
                              <dt>Insurance reference</dt>
                              <dd>{p.insurance_reference ?? "Not recorded"}</dd>
                            </div>
                          </dl>
                          <p className="po-small po-muted">
                            Current directory version {p.version ?? "unavailable"}. Contact and
                            insurance references are recorded evidence, not authority or compliance
                            determinations.
                          </p>
                          <button
                            className="po-button"
                            onClick={() => {
                              setTab("orders");
                              setSearch("");
                              setStatus("");
                              setSupplier(p.id);
                              setSelectedId(null);
                            }}
                          >
                            View this supplier’s orders
                          </button>
                        </div>
                      </article>
                    ))}
                </div>
              )}
              {ledger.parties.length > 0 &&
                !ledger.parties.some((p) =>
                  [p.name, p.trade, p.contact_name, p.contact_email, p.contact_phone]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()),
                ) && <p className="po-empty">No suppliers match this search.</p>}
            </section>
          )}
          {tab === "terms" && (
            <section id="po-panel-terms" role="tabpanel" aria-labelledby="po-tab-terms">
              <h2 className="po-section-title">Terms history</h2>
              <p className="po-muted">
                Only terms returned for your project access are shown. Proposals, owner approval,
                company defaults and supplier acceptance remain separate.
              </p>
              {!ledger.terms.length ? (
                <p className="po-empty">No terms are available to this view.</p>
              ) : (
                ledger.terms
                  .filter((t) =>
                    [t.title, t.body, t.source, t.scope, t.change_note]
                      .filter(Boolean)
                      .join(" ")
                      .toLowerCase()
                      .includes(search.trim().toLowerCase()),
                  )
                  .map((t) => (
                    <article className="po-panel po-terms-record" key={t.id}>
                      <header className="po-panel-head">
                        <h3>{t.title}</h3>
                        <span className="po-badge">
                          {t.state === "approved" ? "Owner-approved terms" : "Proposal"}
                        </span>
                      </header>
                      <div className="po-panel-body">
                        <TermsEvidence
                          terms={t}
                          parent={ledger.terms.find((p) => p.id === t.parent_id)}
                          isDefault={t.id === ledger.default_terms_id}
                        />
                      </div>
                    </article>
                  ))
              )}
              {ledger.terms.length > 0 &&
                !ledger.terms.some((t) =>
                  [t.title, t.body, t.source, t.scope, t.change_note]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()),
                ) && <p className="po-empty">No terms match this search.</p>}
            </section>
          )}
        </>
      )}
    </Shell>
  );
}
