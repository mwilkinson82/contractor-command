import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  PHASE_LABEL,
  creditState,
  nextInstallment,
  preconMoney,
  preconNextStep,
  usd,
  type PreconAgreement,
  type PreconPayload,
} from "@/lib/precon/model";
import type { NextStep } from "@/lib/job-board-commercial";
import { CopyAsk } from "./JobHomeCommercial";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

/**
 * The job's pre-construction agreement, if it has one. A failed read (or a database without pre-con yet) shows
 * nothing, because pre-con is optional and most jobs never have one. Read-only.
 */
export function usePrecon(input: {
  jobId: string;
  companyId: string | null | undefined;
  enabled: boolean;
  visible: boolean;
  userId: string | undefined;
}) {
  const { jobId, companyId, enabled, visible, userId } = input;
  const agreement = useQuery({
    queryKey: ["job-home", jobId, "precon", userId],
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (q) => (visible && !q.state.error ? 60_000 : false),
    queryFn: async () => {
      const r = await rpc("mcp_precon_get", { _job: jobId });
      if (r.error) return null;
      return (r.data as PreconPayload).agreement ?? null;
    },
  });
  // The company's onboarding answer (work_profile.preconstruction): only then does a job without pre-con offer it.
  const offers = useQuery({
    queryKey: ["job-home", "precon-offer", companyId, userId],
    enabled: enabled && !!companyId && agreement.data === null,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const r = await supabase
        .from("mcp_companies")
        .select("work_profile")
        .eq("id", companyId as string)
        .maybeSingle();
      if (r.error || !r.data) return false;
      const profile = (r.data as { work_profile?: { preconstruction?: unknown } | null })
        .work_profile;
      return profile?.preconstruction === "yes";
    },
  });
  return { a: agreement.data ?? null, offer: offers.data === true };
}

/**
 * Index into the board's stage strip for a pre-con job (two pre-con stages, then the usual ones), or the usual
 * index when the job has no pre-con. A closed-lost agreement stays on Design: the job went no further.
 */
export function preconStage(a: PreconAgreement | null, usual: number): number {
  if (!a) return usual;
  if (a.phase === "agreement") return 0;
  if (a.phase === "design" || a.outcome === "lost") return 1;
  return usual + 2;
}

/** The board's next step while a pre-con job is still in its agreement or design. */
export function preconBoardStep(a: PreconAgreement, jobNumber: string): NextStep | null {
  const credit = creditState(a);
  const creditOpen = credit === "to_make" || credit === "waiting";
  if (a.status === "closed" && !(a.outcome === "won" && creditOpen)) return null;
  if (
    a.phase !== "agreement" &&
    a.phase !== "design" &&
    !(a.status === "closed" && a.outcome === "won")
  )
    return null;
  const title = preconNextStep(a);
  const inv = nextInstallment(a);
  const ask = inv
    ? `Send pre-con invoice ${inv.index} for job ${jobNumber} to the owner's client page.`
    : a.status === "draft"
      ? `The pre-con agreement for job ${jobNumber} went to the owner.`
      : a.status === "sent"
        ? `The owner signed the pre-con agreement for job ${jobNumber}.`
        : a.status === "closed"
          ? credit === "waiting"
            ? `Move the pre-con credit change order on job ${jobNumber} to the owner.`
            : `Add the pre-con credit to the contract on job ${jobNumber} as a change order.`
          : `The owner approved the final drawings for job ${jobNumber}.`;
  return {
    title,
    detail:
      "Copy this into your Athena chat and Athena takes it from there. Nothing goes to the owner from here.",
    label: inv ? `Invoice ${usd(inv.amount_cents)}` : "Copy for Athena",
    ask,
    href: null,
  } as NextStep;
}

const statusLine = (a: PreconAgreement) =>
  a.status === "closed"
    ? a.outcome === "won"
      ? `Won${a.closed_on ? ` ${a.closed_on}` : ""}: the owner hired you to build`
      : `Closed${a.closed_on ? ` ${a.closed_on}` : ""}: the owner kept the drawings`
    : a.status === "signed"
      ? `Signed by ${a.signed_name ?? "the owner"}${a.signed_on ? ` on ${a.signed_on}` : ""}`
      : a.status === "sent"
        ? `Sent to the owner${a.sent_on ? ` ${a.sent_on}` : ""}`
        : "Draft, not sent yet";

/** The pre-con section of the board: only on jobs that have an agreement. */
export function PreconSection({ a, jobNumber }: { a: PreconAgreement; jobNumber: string }) {
  const money = preconMoney(a);
  const credit = creditState(a);
  const hoursPct =
    a.parts.hours > 0 ? Math.min(100, Math.round((a.hours_used / a.parts.hours) * 100)) : 0;
  const over = a.hours_used > a.parts.hours;
  return (
    <section className="jb-section" id="precon" aria-labelledby="jb-precon-head">
      <div className="jb-section-head">
        <h2 id="jb-precon-head">Pre-construction</h2>
        <p className="jh-small">
          {PHASE_LABEL[a.phase]} · {statusLine(a)}
        </p>
      </div>
      <dl className="jb-kpis">
        <div>
          <dt>Agreement</dt>
          <dd>
            {usd(a.price_cents)}
            <small>
              {a.billing === "full"
                ? "Billed at signing"
                : "Half at signing, half at final drawings"}
            </small>
          </dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>
            {usd(money.paid)}
            <small>
              {money.open
                ? `${usd(money.open)} open`
                : money.unbilled
                  ? `${usd(money.unbilled)} not billed yet`
                  : "Nothing open"}
            </small>
          </dd>
        </div>
        <div>
          <dt>Design</dt>
          <dd>
            {a.design_days ? `${a.design_days} days` : "Not set"}
            <small>{a.design_partner ?? "Designer not named"}</small>
          </dd>
        </div>
        <div>
          <dt>Credit to contract</dt>
          <dd>
            {a.credit ? (credit === "applied" ? "Applied" : usd(a.price_cents)) : "None"}
            <small>
              {a.credit
                ? a.credit_change && credit !== "to_make"
                  ? credit === "applied"
                    ? `On ${a.credit_change.co_number ?? a.credit_change.number}`
                    : `${a.credit_change.number} waiting on the owner`
                  : a.credit_until
                    ? `If signed by ${a.credit_until}`
                    : `Within ${a.credit_days} days of final drawings`
                : "Fee stays with the agreement"}
            </small>
          </dd>
        </div>
      </dl>
      <div className="jb-card jb-precon">
        <div className="jb-precon-hours">
          <span className="jh-small">
            Your hours: <b>{a.hours_used}</b> of {a.parts.hours} in the price
            {over ? " (over)" : ""}
          </span>
          <div className="jb-meter" data-over={over ? "true" : undefined} aria-hidden="true">
            <span style={{ width: `${hoursPct}%` }} />
          </div>
        </div>
        <details className="jb-precon-more">
          <summary>Price build-up and invoices</summary>
          <div className="jb-table-wrap">
            <table className="jb-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th className="jb-num">Hours</th>
                  <th className="jb-num">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {a.design_partner ?? "Design"}
                    {a.design_role ? <small> {a.design_role}</small> : null}
                  </td>
                  <td className="jb-num" />
                  <td className="jb-num" data-label="Amount">
                    {usd(a.design_fee_cents)}
                  </td>
                </tr>
                {a.parts.markup_cents ? (
                  <tr>
                    <td>Markup on design ({a.design_markup_bps / 100}%)</td>
                    <td className="jb-num" />
                    <td className="jb-num" data-label="Amount">
                      {usd(a.parts.markup_cents)}
                    </td>
                  </tr>
                ) : null}
                {a.time_lines.map((l, i) => (
                  <tr key={`${l.label}-${i}`}>
                    <td>
                      {l.label}
                      {l.note ? <small> {l.note}</small> : null}
                    </td>
                    <td className="jb-num" data-label="Hours">
                      {l.hours}
                    </td>
                    <td className="jb-num" data-label="Amount">
                      {usd(Math.round(l.hours * a.hourly_rate_cents))}
                    </td>
                  </tr>
                ))}
                <tr className="jb-group">
                  <td>Agreement price</td>
                  <td className="jb-num" data-label="Hours">
                    {a.parts.hours}
                  </td>
                  <td className="jb-num" data-label="Price">
                    {usd(a.price_cents)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {a.invoices.length || a.credit_change ? (
            <ul className="jb-files">
              {a.invoices.map((i) => {
                const settled = i.paid_cents + i.credited_cents;
                return (
                  <li key={i.id}>
                    <b>{i.number}</b>
                    <span>
                      {usd(i.net_due_cents)} ·{" "}
                      {settled >= i.net_due_cents
                        ? "Paid"
                        : settled
                          ? `${usd(settled)} paid`
                          : "Open"}
                    </span>
                  </li>
                );
              })}
              {a.credit_change ? (
                <li>
                  <b>{a.credit_change.co_number ?? a.credit_change.number}</b>
                  <span>
                    −{usd(Math.abs(a.credit_change.total_cents ?? a.price_cents))}{" "}
                    {credit === "applied"
                      ? "credited to the contract"
                      : a.credit_change.state === "rejected"
                        ? "credit change order rejected"
                        : "credit change order, waiting on the owner"}
                  </span>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="jb-empty">No pre-con invoices yet.</p>
          )}
          <p className="jh-small">
            {a.owner_owns_drawings ? "The owner owns the drawings." : "The drawings stay with you."}{" "}
            Ask Athena to change anything on job {jobNumber}.
          </p>
        </details>
      </div>
    </section>
  );
}

/** A quiet offer on a job with no estimate or contract yet, for companies that sell pre-con. */
export function PreconOffer({ jobNumber }: { jobNumber: string }) {
  return (
    <section className="jb-card jb-precon-offer" aria-label="Pre-construction">
      <p>
        <b>Does this job start with pre-construction?</b> Athena prices the design agreement, bills
        it and carries the credit into the contract.
      </p>
      <CopyAsk
        ask={`Start a pre-construction agreement on job ${jobNumber}.`}
        label="Start pre-con"
      />
    </section>
  );
}
