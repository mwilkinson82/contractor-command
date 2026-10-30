import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  buyoutProjection,
  readinessChecks,
  readinessFacts,
  type BuyoutLedger,
} from "@/lib/mcp/buyout";
import { poMoney, poDate, type PoRpc } from "@/lib/purchase-order-workspace";

/** Read the integrated domain. No duplicate ledger, pin updates or schedule calculations. */
export function PurchaseOrderBuyout({
  jobId,
  companyId,
  userId,
  rpc,
  onOpenOrder,
}: {
  jobId: string;
  companyId: string;
  userId: string;
  rpc: PoRpc;
  onOpenOrder: (id: string, version: number) => void;
}) {
  const q = useQuery({
    queryKey: ["po-buyout", companyId, jobId, userId],
    retry: false,
    queryFn: async () => {
      const r = await rpc("mcp_buyout_get", { _company: companyId, _job: jobId });
      if (r.error) throw new Error("Buyout unavailable.");
      return r.data as BuyoutLedger;
    },
  });
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!q.data) return;
    let hash = "";
    try {
      hash = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    const key = `${jobId}:${hash}`;
    if (
      !hash ||
      scrolled.current === key ||
      !q.data.records.some((r) => r.id === hash && r.kind === "package")
    )
      return;
    const target = document.getElementById(hash);
    if (target) {
      target.scrollIntoView();
      scrolled.current = key;
    }
  }, [q.data, jobId]);
  if (q.isLoading)
    return (
      <section className="po-panel">
        <h2>Buyout & payment readiness</h2>
        <p className="po-panel-body" role="status">
          Loading saved buyout records…
        </p>
      </section>
    );
  if (q.error || !q.data)
    return (
      <section className="po-panel">
        <h2>Buyout & payment readiness</h2>
        <div className="po-panel-body">
          <p role="alert">
            Buyout records are unavailable for this job. No exposure or readiness has been assumed.
          </p>
          <button className="po-button" onClick={() => void q.refetch()}>
            Retry buyout records
          </button>
        </div>
      </section>
    );
  const ledger = q.data,
    projection = buyoutProjection(ledger),
    requirements = ledger.records.filter((r) => r.kind === "readiness");
  return (
    <section className="po-panel po-buyout">
      <h2>Buyout & payment readiness</h2>
      <div className="po-panel-body">
        <div className="po-buyout-summary">
          <div>
            <span className="po-label">Canonical approved PO commitments</span>
            <strong>{poMoney(projection.canonical_committed_cents)}</strong>
          </div>
          <p className="po-small po-muted">
            Each latest internally approved PO is counted once. Draft revisions and cancelled buyout
            packages do not release the approved commitment. These are commitments, not costs or
            payments.
          </p>
        </div>
        {!projection.packages.length ? (
          <p className="po-empty">
            No buyout scope packages recorded. Use Athena to review and save scope comparisons
            against the existing project party and PO.
          </p>
        ) : (
          <div className="po-buyout-grid">
            {projection.packages.map((p) => (
              <article className="po-buyout-card" id={p.id} key={p.id}>
                <div className="po-panel-head">
                  <h3>
                    {p.code} · {p.title}
                  </h3>
                  <span className="po-badge">
                    {p.status} · scope version {p.version}
                  </span>
                </div>
                <div className="po-panel-body">
                  <dl className="po-buyout-values">
                    <div>
                      <dt>Scope budget</dt>
                      <dd>{p.budget_cents === null ? "Unknown" : poMoney(p.budget_cents)}</dd>
                    </div>
                    <div>
                      <dt>Pinned commitments</dt>
                      <dd>{poMoney(p.committed_cents)}</dd>
                    </div>
                    <div>
                      <dt>Uncommitted scope exposure</dt>
                      <dd>
                        {p.uncommitted_exposure_cents === null
                          ? "Unknown"
                          : poMoney(p.uncommitted_exposure_cents)}
                      </dd>
                    </div>
                  </dl>
                  {p.cancelled && (
                    <p className="po-warning">
                      Cancelled scope; retained in history. Its approved PO commitments remain in
                      canonical exposure.
                    </p>
                  )}
                  <p className="po-small po-muted">
                    Expected award {poDate(p.expected_award_on)} · Reported delivery{" "}
                    {poDate(p.expected_delivery_on)} · Needed by {poDate(p.needed_by)}
                  </p>
                  {p.schedule_ref && (
                    <p className="po-small">
                      Pinned schedule version {p.schedule_ref.report_version} · activity{" "}
                      {p.schedule_ref.activity_id}.{" "}
                      <a href={`/r/job/${jobId}/schedule`}>View schedule</a> The saved pin is
                      unchanged; this link opens the current schedule.
                    </p>
                  )}
                  {p.commitment_sources.map((s) => (
                    <p className="po-small" key={s.po_id}>
                      <button
                        className="po-inline-button"
                        onClick={() => onOpenOrder(s.po_id, s.version)}
                      >
                        {s.number ?? "Linked PO"} · pinned version {s.version}
                      </button>
                      {!s.current
                        ? " · superseded or unavailable; pinned amount remains unknown"
                        : ""}
                    </p>
                  ))}
                  {p.blockers.length ? (
                    <ul className="po-blocker-list">
                      {p.blockers.map((b, i) => (
                        <li key={`${b.key}:${i}`}>{b.message}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="po-small po-muted">
                      {p.readiness === "evidence_checked"
                        ? "Recorded evidence checks available; bill approval remains separate."
                        : "Payment requirements have not been established."}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {requirements.length > 0 && (
          <div className="po-readiness-records">
            <h3>Supplier requirement checks</h3>
            {requirements.map((r) => {
              const f = readinessFacts.parse(r.facts);
              return (
                <div key={r.id}>
                  <strong>
                    {ledger.parties.find((p) => p.id === f.party_id)?.name ?? "Project party"} ·
                    record version {r.version} · party version {f.party_version}
                  </strong>
                  <ul className="po-blocker-list">
                    {readinessChecks(f, ledger.today, ledger).map((c) => (
                      <li key={c.key}>{c.message}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        <p className="po-small po-muted">
          Insurance evidence is not a coverage certification. Owner exceptions remain exceptions.
          Use Athena for a separately reviewed change; readiness never approves a bill, posts a cost
          or moves money.
        </p>
      </div>
    </section>
  );
}
