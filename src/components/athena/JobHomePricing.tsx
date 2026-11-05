import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { accountingMoney } from "@/lib/accounting-report";
import { usePageVisible } from "./ReportPage";
import "./job-home-notices.css";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

type Terms = { job_kind: "project" | "service"; contract_type: string | null };
type Bill = { number: string; net_due_cents: number; remaining_cents: number; paid: boolean };
type WorkOrder = {
  id: string;
  number: string;
  version: number;
  title: string;
  basis: string;
  basis_label: string;
  state: string;
  estimate_cents: number;
  cap_cents: number | null;
  actual_cents: number | null;
  decision: { decision: string; by?: string; channel?: string } | null;
  bill: Bill | null;
};
type Call = {
  number: number;
  stage: string;
  next_step: string | null;
  customer: { name: string };
  site_address: string;
  issue: string;
  tech_name: string | null;
  window_start: string | null;
  window_end: string | null;
  time_zone: string;
  fee_cents: number;
  fee: Bill | null;
  work_orders: WorkOrder[];
};

const CONTRACT_LABEL: Record<string, string> = {
  lump_sum: "Lump sum",
  unit_price: "Unit price",
  cost_plus: "Cost plus",
  time_and_material: "Time and material",
};
const CO_BASES = [
  ["lump_sum", "Lump sum", "One price for the change"],
  ["unit_price", "Unit price", "Quantity times a set price per unit"],
  ["time_and_material", "Time and material", "Actual labor and material, often with a cap"],
  ["hourly", "Hourly", "Labor hours at your rate"],
] as const;
const money = (c: number | null | undefined) => (typeof c === "number" ? accountingMoney(c) : "—");

function arrival(c: Call): string {
  const opts = { timeZone: c.time_zone } as const;
  const start = new Date(c.window_start as string);
  const day = start.toLocaleDateString("en-US", {
    ...opts,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = (d: Date) =>
    d.toLocaleTimeString("en-US", { ...opts, hour: "numeric", minute: "2-digit" });
  return c.window_end
    ? `${day}, ${time(start)} to ${time(new Date(c.window_end))}`
    : `${day}, ${time(start)}`;
}

const STAGE: Record<string, [string, string]> = {
  new: ["New", "waiting"],
  scheduled: ["Scheduled", "waiting"],
  fee_requested: ["Fee sent", "waiting"],
  fee_paid: ["Fee paid", "approved"],
  diagnosed: ["Diagnosed", "waiting"],
  work_order_draft: ["Work order drafted", "waiting"],
  work_order_sent: ["Waiting on approval", "waiting"],
  declined: ["Declined", "declined"],
  approved: ["Approved", "approved"],
  work_done: ["Work done", "approved"],
  billed: ["Billed", "waiting"],
  paid: ["Paid", "approved"],
  closed: ["Closed", "approved"],
  cancelled: ["Cancelled", "declined"],
};
const WO_STATE: Record<string, [string, string]> = {
  draft: ["Draft", "waiting"],
  sent: ["Waiting on the customer", "waiting"],
  approved: ["Approved", "approved"],
  declined: ["Declined", "declined"],
  done: ["Work done", "approved"],
  billed: ["Billed", "waiting"],
};

/**
 * How the job is priced: a project's contract type with every change order pricing basis it can carry (a lump sum
 * job can still take a unit price, T&M or hourly change order), or a service call's work orders and bills.
 */
export function JobHomePricing({ jobId }: { jobId: string }) {
  const { session, loading } = useAuth();
  const visible = usePageVisible();
  const q = useQuery({
    queryKey: ["job-home-pricing", jobId, session?.user.id ?? null],
    enabled: !loading && !!session,
    retry: false,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query: { state: { error: unknown } }) =>
      visible && !query.state.error ? 30_000 : false,
    queryFn: async () => {
      const t = await rpc("mcp_job_terms", { _job: jobId });
      if (t.error || !t.data) return null;
      const terms = t.data as Terms;
      if (terms.job_kind === "service") {
        const c = await rpc("mcp_service_call_get", { _job: jobId });
        return { terms, call: c.error ? null : (c.data as Call), pricing: null };
      }
      const p = await rpc("mcp_change_order_pricing_list", { _job: jobId });
      return {
        terms,
        call: null,
        pricing: p.error ? {} : ((p.data as Record<string, string>) ?? {}),
      };
    },
  });
  // Before the service call SQL is applied, the reads don't exist and the panel stays hidden.
  if (!session || !q.data) return null;
  const { terms, call, pricing } = q.data;

  if (terms.job_kind === "service") {
    if (!call) return null;
    const [stage, tone] = STAGE[call.stage] ?? [call.stage, "waiting"];
    return (
      <div className="jh-panel jhn-panel jhp-panel" id="service-call">
        <div className="jhn-head">
          <h2>Service call SC-{call.number}</h2>
          <span className={`jhn-status jhn-status-${tone}`}>{stage}</span>
        </div>
        <div className="jh-panel-body jhn-body">
          <dl className="jhp-facts">
            <div>
              <dt>Customer</dt>
              <dd>{call.customer.name}</dd>
            </div>
            <div>
              <dt>Site</dt>
              <dd>{call.site_address}</dd>
            </div>
            <div>
              <dt>Tech</dt>
              <dd>
                {call.tech_name ?? "Not assigned"}
                {call.window_start ? ` · ${arrival(call)}` : ""}
              </dd>
            </div>
            <div>
              <dt>Service call fee</dt>
              <dd>
                {call.fee_cents > 0
                  ? `${money(call.fee_cents)} · ${call.fee ? (call.fee.paid ? "paid" : "sent") : "not sent"}`
                  : "None"}
              </dd>
            </div>
          </dl>
          <p className="jhp-issue">{call.issue}</p>
          {call.work_orders.length ? (
            <div className="jhn-co-table jhp-wo" role="table" aria-label="Work orders">
              <div className="jhn-co-row jhn-co-headrow" role="row">
                <span role="columnheader">Number</span>
                <span role="columnheader">Title</span>
                <span role="columnheader">Status</span>
                <span role="columnheader" className="jhn-num">
                  Amount
                </span>
                <span role="columnheader" className="jhn-num">
                  Priced by
                </span>
              </div>
              {call.work_orders.map((w) => {
                const [label, t] = WO_STATE[w.state] ?? [w.state, "waiting"];
                const amount =
                  w.bill != null
                    ? `${money(w.bill.net_due_cents)} billed${w.bill.paid ? ", paid" : ""}`
                    : w.actual_cents != null
                      ? `${money(w.actual_cents)} actual`
                      : w.basis === "unit_price"
                        ? money(w.estimate_cents)
                        : w.cap_cents != null
                          ? `Up to ${money(w.cap_cents)}`
                          : `About ${money(w.estimate_cents)}`;
                return (
                  <div className="jhn-co-row" role="row" key={w.id}>
                    <span role="cell" className="jhn-co-number">
                      {w.number}
                    </span>
                    <span role="cell" className="jhn-co-title">
                      {w.title}
                      {w.decision?.by ? (
                        <small className="jhn-co-decision">
                          {w.decision.decision === "approved" ? "Approved" : "Declined"} by{" "}
                          {w.decision.by}
                          {w.decision.channel === "on_site" ? " on site" : " on the client page"}
                        </small>
                      ) : null}
                    </span>
                    <span role="cell">
                      <span className={`jhn-status jhn-status-${t}`}>{label}</span>
                    </span>
                    <span role="cell" className="jhn-num" data-label="Amount">
                      {amount}
                    </span>
                    <span role="cell" className="jhn-num" data-label="Priced by">
                      {w.basis_label}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="jhn-empty">No work order yet.</p>
          )}
          {call.next_step ? (
            <p className="jhp-next">
              <b>Next:</b> {call.next_step} Ask Athena in chat and it walks you through it.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const counts: Record<string, number> = {};
  for (const b of Object.values(pricing ?? {})) counts[b] = (counts[b] ?? 0) + 1;
  return (
    <div className="jh-panel jhn-panel jhp-panel" id="pricing">
      <div className="jhn-head">
        <h2>Contract type</h2>
        <span className="jhp-type">
          {terms.contract_type ? CONTRACT_LABEL[terms.contract_type] : "Not set"}
        </span>
      </div>
      <div className="jh-panel-body jhn-body">
        <p className="jhn-summary">
          {terms.contract_type
            ? "Change orders on this job can be priced any of these ways, whatever the contract type."
            : "Tell Athena in chat whether this job is lump sum, unit price, cost plus, or time and material. Change orders can be priced any of these ways either way."}
        </p>
        <ul className="jhp-bases" aria-label="Change order pricing">
          {CO_BASES.map(([b, label, hint]) => (
            <li key={b} className={counts[b] ? "jhp-on" : undefined}>
              <b>{label}</b>
              <span className="jhp-hint">{hint}</span>
              <span className="jhp-count">
                {counts[b]
                  ? `${counts[b]} change ${counts[b] === 1 ? "order" : "orders"}`
                  : "Available"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
