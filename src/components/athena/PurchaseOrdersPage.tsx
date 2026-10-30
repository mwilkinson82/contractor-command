import { AccountingWorkspace } from "./AccountingWorkspace";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { BoardSignIn } from "./BoardSignIn";
import { extendedCents, sumCents } from "@/lib/accounting-report";

type Party = {
  id: string;
  name: string;
  kind: string;
  trade: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  insurance_reference: string | null;
  contract_reference: string | null;
};
type Terms = {
  id: string;
  title: string;
  body: string;
  scope: string;
  state: "proposed" | "approved";
  parent_id: string | null;
  source: string;
  change_note: string | null;
};
type Order = {
  id: string;
  number: string;
  party_id: string;
  versions: Array<{
    version: number;
    status: string;
    terms_id: string;
    party_snapshot: { name: string };
    order_date: string;
    needed_by: string;
    reason: string | null;
    lines: Array<{ description: string; quantity: number; unit: string; unit_price_cents: number }>;
  }>;
};
type Ledger = {
  parties: Party[];
  terms: Terms[];
  orders: Order[];
  default_terms_id: string | null;
};
const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const money = (cents: number | null) => {
  if (cents === null) return "Unavailable";
  const amount = BigInt(cents);
  return `$${new Intl.NumberFormat("en-US").format(amount / 100n)}.${String(amount % 100n).padStart(2, "0")}`;
};
export function PurchaseOrdersPage({ jobId }: { jobId: string }) {
  const { session, loading } = useAuth();
  const result = useQuery({
    queryKey: ["purchase-orders", jobId, session?.user.id],
    enabled: !loading && !!session,
    retry: false,
    queryFn: async () => {
      const r = await rpc("mcp_project_purchase_orders_get", { _job: jobId });
      if (r.error) throw new Error(r.error.message);
      return r.data as Ledger;
    },
  });
  if (loading)
    return (
      <AccountingWorkspace jobId={jobId} title="Suppliers and purchase orders">
        <p role="status">Loading purchase orders…</p>
      </AccountingWorkspace>
    );
  if (!session) return <BoardSignIn returnTo={`/r/job/${jobId}/purchase-orders`} />;
  if (result.isLoading)
    return (
      <AccountingWorkspace jobId={jobId} title="Suppliers and purchase orders">
        <p role="status">Loading purchase orders…</p>
      </AccountingWorkspace>
    );
  if (result.error || !result.data)
    return (
      <AccountingWorkspace jobId={jobId} title="Suppliers and purchase orders">
        <p role="alert">Purchase orders are unavailable for this project.</p>
        <a href={`/r/job/${jobId}/home`}>Project home</a>
      </AccountingWorkspace>
    );
  const { parties, terms, orders, default_terms_id } = result.data;
  return (
    <AccountingWorkspace
      jobId={jobId}
      title="Suppliers and purchase orders"
      className="af-purchase-orders"
      description={
        <p>
          Purchase orders are commitments. They are not posted costs or payments. Create or revise
          drafts with Athena. Owners approve company and job terms. Project members can read
          approved terms on an internally approved PO; contracts staff may propose redlines. A
          proposal is not effective until owner approval, which does not establish supplier
          acceptance.
        </p>
      }
    >
      <section>
        <h2 className="text-xl font-semibold">Project parties</h2>
        {parties.length === 0 ? (
          <p className="af-empty">No parties recorded.</p>
        ) : (
          <div className="mt-3 grid gap-3">
            {parties.map((p) => (
              <article key={p.id} className="rounded border p-4">
                <h3 className="font-semibold">{p.name}</h3>
                <p>
                  {p.kind}
                  {p.trade ? ` · ${p.trade}` : ""}
                </p>
                <p>
                  {[p.contact_name, p.contact_email, p.contact_phone].filter(Boolean).join(" · ") ||
                    "Contact not recorded"}
                </p>
                <p>Insurance reference: {p.insurance_reference || "Not recorded"}</p>
                <p>Contract reference: {p.contract_reference || "Not recorded"}</p>
              </article>
            ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="text-xl font-semibold">Purchase orders</h2>
        {orders.length === 0 ? (
          <p className="af-empty">No orders recorded.</p>
        ) : (
          <div className="mt-3 grid gap-3">
            {orders.map((o) => (
              <article key={o.id} className="rounded border p-4">
                <h3 className="font-semibold">
                  {o.number} · {o.versions[0]?.party_snapshot.name ?? "Unavailable party"}
                </h3>
                {o.versions.map((v) => {
                  const t = terms.find((x) => x.id === v.terms_id);
                  const extensions = v.lines.map((line) =>
                    extendedCents(line.quantity, line.unit_price_cents),
                  );
                  const total = sumCents(extensions);
                  return (
                    <details key={v.version} className="mt-3" open={v === o.versions[0]}>
                      <summary>
                        Version {v.version} ·{" "}
                        {v.status === "approved" ? "internally approved" : v.status} · dated{" "}
                        {v.order_date} · needed by {v.needed_by}
                      </summary>
                      <ul className="ml-5 list-disc">
                        {v.lines.map((line, i) => (
                          <li key={i}>
                            {line.description} · {line.quantity} {line.unit} ·{" "}
                            {money(line.unit_price_cents)} per {line.unit} · Line total:{" "}
                            <strong className="tabular-nums">{money(extensions[i])}</strong>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-3 font-semibold tabular-nums">
                        Order total (USD): {money(total)}
                      </p>
                      {total === null && (
                        <p>
                          A line or total cannot be represented as whole cents at supported
                          precision. No amount has been rounded.
                        </p>
                      )}
                      <p>Supplier at this version: {v.party_snapshot.name}</p>
                      {v.reason && <p>Revision: {v.reason}</p>}
                      <p>
                        Terms: {t?.title ?? "Unavailable"} ({t?.scope ?? "unknown"})
                      </p>
                      {t && <pre className="whitespace-pre-wrap break-words">{t.body}</pre>}
                    </details>
                  );
                })}
              </article>
            ))}
          </div>
        )}
      </section>
      <section>
        <h2 className="text-xl font-semibold">Terms history</h2>
        {terms.length === 0 ? (
          <p className="af-empty">No terms recorded.</p>
        ) : (
          terms.map((t) => (
            <details key={t.id} className="mt-3 rounded border p-4">
              <summary>
                {t.title} · {t.scope} · {t.state}
                {t.id === default_terms_id ? " · company default" : ""}
              </summary>
              <p>Source: {t.source}</p>
              {t.change_note && <p>Changes: {t.change_note}</p>}
              {t.parent_id && (
                <p>Base: {terms.find((x) => x.id === t.parent_id)?.title ?? "Unavailable"}</p>
              )}
              <pre className="whitespace-pre-wrap break-words">{t.body}</pre>
              {t.parent_id && terms.find((x) => x.id === t.parent_id) && (
                <>
                  <p className="mt-3 font-semibold">Base text</p>
                  <pre className="whitespace-pre-wrap break-words">
                    {terms.find((x) => x.id === t.parent_id)?.body}
                  </pre>
                </>
              )}
            </details>
          ))
        )}
      </section>
    </AccountingWorkspace>
  );
}
