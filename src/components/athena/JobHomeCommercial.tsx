import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CONTRACTS_UNAVAILABLE,
  STAGES,
  commercialNextStep,
  contractsOverview,
  estimateOverview,
  gbbOverview,
  jobStage,
  tierName,
  usd,
  type ContractKind,
  type ContractRow,
  type ContractsOverview,
  type EstimateFile,
  type EstimateOverview,
  type GbbOverview,
  type NextStep,
} from "@/lib/job-board-commercial";
import { optionNames } from "@/lib/selections/model";
import { ATHENA_BRAND_MARK } from "./AthenaBrand";
import "./job-board-commercial.css";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

const EXPORT_BUCKET = "athena-files";

const poll = (visible: boolean) => (q: { state: { error: unknown } }) =>
  visible && !q.state.error ? 60_000 : false;

/**
 * The estimate, Good, Better, Best and contracts reads for the board. Each read is separate, so
 * one that fails shows as unavailable and never as an empty list. Read-only: nothing is saved here.
 */
export function useJobCommercial(input: {
  jobId: string;
  enabled: boolean;
  visible: boolean;
  userId: string | undefined;
  /** Contract value in dollars from the board's existing contract read, or null when not on file. */
  contractValue: number | null;
}) {
  const { jobId, enabled, visible, userId, contractValue } = input;
  const common = {
    enabled,
    retry: false as const,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: poll(visible),
  };
  const estimate = useQuery({
    ...common,
    queryKey: ["job-home", jobId, "estimate", userId],
    queryFn: async () => {
      const [e, b, x] = await Promise.all([
        rpc("mcp_estimate_get", { _job: jobId }),
        rpc("mcp_estimate_bid_get", { _job: jobId }),
        rpc("mcp_takeoff_exports", { _job: jobId }),
      ]);
      if (e.error) throw new Error("Estimate unavailable.");
      // Pricing and exports add detail; when either read fails the estimate still shows.
      return estimateOverview(e.data, b.error ? null : b.data, x.error ? [] : x.data);
    },
  });
  const gbb = useQuery({
    ...common,
    queryKey: ["job-home", jobId, "gbb", userId],
    queryFn: async () => {
      const r = await rpc("mcp_residential_selections_get", { _job: jobId });
      if (r.error) throw new Error("Good, Better, Best unavailable.");
      return r.data;
    },
  });
  const contracts = useQuery({
    ...common,
    queryKey: ["job-home", jobId, "contracts", userId],
    queryFn: async () => {
      const [c, p] = await Promise.all([
        rpc("mcp_job_contract_rows", { _job: jobId }),
        rpc("mcp_project_purchase_orders_get", { _job: jobId }),
      ]);
      if (p.error && c.error) throw new Error("Contracts unavailable.");
      return {
        contracts: c.error ? null : c.data,
        pos: p.error ? null : p.data,
        posFailed: !!p.error,
      };
    },
  });
  const contracted = contractValue !== null;
  const g = gbb.data !== undefined && !gbb.error ? gbbOverview(gbb.data, contracted) : null;
  const c =
    contracts.data && !contracts.error
      ? contractsOverview(contracts.data.contracts, contracts.data.pos, contractValue)
      : null;
  return {
    estimate,
    gbbQuery: gbb,
    contractsQuery: contracts,
    e: estimate.data && !estimate.error ? estimate.data : null,
    g,
    c,
    posFailed: !!contracts.data?.posFailed,
    contracted,
  };
}

export type JobCommercial = ReturnType<typeof useJobCommercial>;

/** Pre-con jobs start two stages earlier: the agreement, then the design. */
const PRECON_STAGES = [
  ["Pre-con", "Agreement"],
  ["Design", "Drawings"],
] as const;

export function StageStrip({
  stage,
  precon,
  compact,
}: {
  stage: number;
  precon?: boolean;
  /** Pills only, for the job title's Phase row. */
  compact?: boolean;
}) {
  const stages = precon ? [...PRECON_STAGES, ...STAGES] : STAGES;
  return (
    <ol
      className={`jb-stages${compact ? " jb-stages-compact" : ""}`}
      data-precon={precon ? "true" : undefined}
      aria-label={compact ? "Phase" : "Where this job stands"}
    >
      {stages.map(([name, detail], i) => (
        <li
          key={name}
          data-state={i < stage ? "done" : i === stage ? "now" : "later"}
          aria-current={i === stage ? "step" : undefined}
        >
          <b>
            {i < stage ? "✓ " : ""}
            {name}
          </b>
          {compact ? null : detail}
        </li>
      ))}
    </ol>
  );
}

export function stageOf(c: JobCommercial, fieldStarted: boolean): number {
  return jobStage({
    contracted: c.contracted,
    fieldStarted,
    proposalReady: !!c.g?.exists && !c.g.blockers.length,
  });
}

/** Copies an ask for the member's Athena chat. Nothing is sent or saved from the board. */
export function CopyAsk({
  ask,
  label,
  primary,
}: {
  ask: string;
  label: string;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span>
      <button
        type="button"
        className={`jb-btn${primary ? " jb-btn-primary" : ""}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(ask);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 4000);
          } catch {
            window.prompt("Copy this into your Athena chat:", ask);
          }
        }}
      >
        {label}
      </button>
      {copied ? (
        <span className="jb-copied" role="status">
          {" "}
          Copied. Paste it in your Athena chat.
        </span>
      ) : null}
    </span>
  );
}

export function NextStepCard({
  step,
  href,
}: {
  step: NextStep | null;
  href: (p: string) => string;
}) {
  if (!step) return null;
  return (
    <section className="jb-card jb-next" aria-label="Athena next step">
      <img src={ATHENA_BRAND_MARK} alt="" />
      <div>
        <span className="jb-next-eyebrow">Next step</span>
        <h3>{step.title}</h3>
        <p>{step.detail}</p>
      </div>
      <div>
        {step.href ? (
          <a className="jb-btn jb-btn-primary" href={href(step.href)}>
            {step.label}
          </a>
        ) : (
          <CopyAsk ask={step.ask} label={step.label} primary />
        )}
      </div>
    </section>
  );
}

export function nextStepOf(c: JobCommercial, jobNumber: string) {
  return commercialNextStep({
    jobNumber,
    estimate: c.e,
    gbb: c.g,
    contracts: c.c,
    contracted: c.contracted,
  });
}

async function openExport(file: EstimateFile) {
  if (!file.path) return;
  const tab = window.open("", "_blank");
  const signed = await supabase.storage.from(EXPORT_BUCKET).createSignedUrl(file.path, 600);
  if (signed.error || !signed.data?.signedUrl) {
    tab?.close();
    window.alert("That PDF couldn't be opened just now. Ask Athena to export the takeoff again.");
    return;
  }
  if (tab) tab.location.href = signed.data.signedUrl;
  else window.location.assign(signed.data.signedUrl);
}

export function ExportList({ files, limit = 4 }: { files: EstimateFile[]; limit?: number }) {
  if (!files.length) return null;
  return (
    <ul className="jb-files" aria-label="Saved takeoff PDFs">
      {files.slice(0, limit).map((f) => (
        <li key={f.id}>
          <div>
            <strong>{f.label}</strong>
            <br />
            <span>{f.detail}</span>
          </div>
          {f.path ? (
            <button type="button" className="jb-btn" onClick={() => void openExport(f)}>
              Open PDF
            </button>
          ) : (
            <span>PDF not saved</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Pill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className="jb-pill" data-tone={tone}>
      {label}
    </span>
  );
}

function EstimateCard({
  e,
  jobNumber,
  href,
}: {
  e: EstimateOverview;
  jobNumber: string;
  href: (p: string) => string;
}) {
  const settled = Math.max(0, e.withQuantity - e.excluded);
  const open = e.missingInput;
  const total = Math.max(1, e.lines);
  return (
    <article className="jb-card" aria-labelledby="jb-estimate-title">
      <div className="jb-head">
        <div>
          <h3 id="jb-estimate-title">Estimate</h3>
          <p>
            {e.started
              ? [
                  e.takeoffVersion ? `Takeoff version ${e.takeoffVersion}` : "No takeoff saved",
                  e.role,
                  e.trades.join(", ") || null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "No estimate on this job yet."}
          </p>
        </div>
        <Pill {...e.status} />
      </div>
      {e.started && e.lines ? (
        <>
          <div className="jb-bar" aria-hidden="true">
            <span style={{ width: `${(settled / total) * 100}%` }} />
            <span style={{ width: `${(open / total) * 100}%` }} />
          </div>
          <div className="jb-legend">
            <span>{settled} with quantities</span>
            <span>{open} need a quantity</span>
            <span>{e.excluded} excluded</span>
            <span>{e.lines} lines</span>
          </div>
          <dl className="jb-facts">
            <div>
              <dt>Bid due</dt>
              <dd>{e.bidDue ?? "Not set"}</dd>
            </div>
            <div>
              <dt>Questions holding the bid</dt>
              <dd>{e.holdingBid}</dd>
            </div>
            <div>
              <dt>Priced lines</dt>
              <dd>
                {e.pricedLines} of {e.lines - e.excluded}
              </dd>
            </div>
            <div>
              <dt>Overhead and profit</dt>
              <dd>
                {e.overheadPct === null && e.profitPct === null
                  ? "Not set"
                  : `${e.overheadPct ?? 0}% + ${e.profitPct ?? 0}%`}
              </dd>
            </div>
          </dl>
        </>
      ) : null}
      <ExportList files={e.files} limit={3} />
      <div className="jb-actions">
        {e.started ? (
          <a className="jb-btn jb-btn-primary" href={href("estimate")}>
            Open estimate
          </a>
        ) : null}
        <CopyAsk
          ask={
            e.started
              ? `Hey Athena, let's keep working on the estimate for job ${jobNumber}.`
              : `Hey Athena, start the estimate for job ${jobNumber} and add the drawings.`
          }
          label={e.started ? "Continue in Athena chat" : "Start the estimate in Athena chat"}
          primary={!e.started}
        />
      </div>
    </article>
  );
}

const TRACK = ["Draft", "Ready", "On client page", "Chosen"] as const;

export function GbbCard({
  g,
  jobNumber,
  heading,
}: {
  g: GbbOverview;
  jobNumber: string;
  heading: string;
}) {
  const reached = g.chosen ? 3 : g.blockers.length ? 0 : 1;
  return (
    <article className="jb-card" aria-label={heading}>
      <div className="jb-head">
        <div>
          <h3>{heading}</h3>
          <p>
            {g.title} · version {g.version} · {g.selections}{" "}
            {g.selections === 1 ? "selection" : "selections"}
          </p>
        </div>
        <Pill {...g.status} />
      </div>
      <div className="jb-tiers">
        {optionNames.map((t) => (
          <div key={t} data-chosen={g.chosen === t}>
            <b>
              {tierName(t)}
              {g.baseTier === t ? " · in base price" : ""}
            </b>
            <strong>{usd(g.totals[t])}</strong>
            <span>{g.time[t]}</span>
          </div>
        ))}
      </div>
      <ol className="jb-track" aria-label="Where the options stand">
        {TRACK.map((s, i) => (
          <li key={s} data-done={i <= reached}>
            {s}
          </li>
        ))}
      </ol>
      <p className="jh-small">
        {g.underContract
          ? "When your client picks Better or Best, Athena drafts one change order for that upgrade for your review. Regular change orders stay in the change order log."
          : "Part of the proposal. When your client signs, the pick is in the contract."}
        {g.blockers.length ? ` Still needed: ${g.blockers[0]}` : ""}
      </p>
      <div className="jb-actions">
        <CopyAsk
          ask={`Hey Athena, open the Good, Better, Best options for job ${jobNumber}.`}
          label="Open in Athena chat"
        />
      </div>
    </article>
  );
}

function ProposalCard({
  g,
  gbbFailed,
  jobNumber,
  contracted,
}: {
  g: GbbOverview | null;
  gbbFailed: boolean;
  jobNumber: string;
  contracted: boolean;
}) {
  return (
    <article className="jb-card" aria-labelledby="jb-proposal-title">
      <div className="jb-head">
        <div>
          <h3 id="jb-proposal-title">Proposal</h3>
          <p>
            {contracted
              ? "Signed proposals became the contract. The estimate stays here for reference."
              : "The proposal your client signs. Once signed it becomes the contract."}
          </p>
        </div>
        <Pill
          label={contracted ? "Contract on file" : g?.chosen ? "Signed" : "Not sent yet"}
          tone={contracted || g?.chosen ? "ok" : "idle"}
        />
      </div>
      {gbbFailed ? (
        <p className="jb-empty">Good, Better, Best options are unavailable right now.</p>
      ) : g?.exists && !contracted ? (
        <div style={{ marginTop: 12 }}>
          <GbbCard g={g} jobNumber={jobNumber} heading="Good, Better, Best in this proposal" />
        </div>
      ) : !contracted ? (
        <p className="jb-empty">
          No Good, Better, Best options yet. Offer upgrades by asking Athena to set them up from the
          estimate.
        </p>
      ) : null}
      <div className="jb-actions">
        <CopyAsk
          ask={
            contracted
              ? `Hey Athena, show me the proposal that became the contract on job ${jobNumber}.`
              : `Hey Athena, build the proposal for job ${jobNumber} from the estimate.`
          }
          label={contracted ? "Open in Athena chat" : "Build the proposal in Athena chat"}
        />
      </div>
    </article>
  );
}

export function EstimateProposalSection({
  c,
  jobNumber,
  href,
}: {
  c: JobCommercial;
  jobNumber: string;
  href: (p: string) => string;
}) {
  return (
    <section className="jb-section" id="estimate" aria-labelledby="jb-estimate-head">
      <div className="jb-section-head">
        <h2 id="jb-estimate-head">Estimate &amp; proposal</h2>
        <p className="jh-small">Takeoff, pricing and the proposal your client signs.</p>
      </div>
      <div className="jb-two">
        {c.estimate.isLoading ? (
          <article className="jb-card">
            <p role="status">Loading the estimate…</p>
          </article>
        ) : c.e ? (
          <EstimateCard e={c.e} jobNumber={jobNumber} href={href} />
        ) : (
          <article className="jb-card">
            <h3>Estimate</h3>
            <p className="jb-empty">
              The estimate is unavailable right now. Nothing is assumed empty.
            </p>
          </article>
        )}
        <ProposalCard
          g={c.g}
          gbbFailed={!!c.gbbQuery.error}
          jobNumber={jobNumber}
          contracted={c.contracted}
        />
      </div>
    </section>
  );
}

const GROUP: Record<ContractKind, string> = {
  prime: "Prime contract",
  subcontract: "Subcontracts",
  supplier: "Suppliers and purchase orders",
  other: "Other agreements",
};
const KIND: Record<ContractKind, string> = {
  prime: "Prime",
  subcontract: "Subcontract",
  supplier: "Supplier",
  other: "Other",
};

function ContractRowView({
  r,
  jobNumber,
  href,
}: {
  r: ContractRow;
  jobNumber: string;
  href: (p: string) => string;
}) {
  return (
    <tr>
      <td data-label="With">
        <strong>{r.with}</strong>
        <small>{[r.number, r.title].filter(Boolean).join(" · ") || KIND[r.kind]}</small>
      </td>
      <td data-label="Tagged to">{r.tag ?? "Not tagged"}</td>
      <td data-label="Value" className="jb-num">
        {r.valueCents === null ? "Not set" : usd(r.valueCents)}
      </td>
      <td data-label="Status">
        <Pill {...r.status} />
        {r.signedOn ? <small>Signed {r.signedOn}</small> : null}
      </td>
      <td data-label="Signed copy">
        <small style={{ color: "inherit" }}>{r.signedCopy}</small>
        {r.source === "purchase_order" ? (
          <a href={href("purchase-orders")}>Open PO</a>
        ) : r.documentId ? (
          <CopyAsk
            ask={`Hey Athena, open the signed contract with ${r.with} on job ${jobNumber}.`}
            label="Open in chat"
          />
        ) : (
          <CopyAsk
            ask={`Hey Athena, here's the signed ${r.kind === "prime" ? "prime contract" : `contract with ${r.with}`} for job ${jobNumber}. Save it to the job's contracts.`}
            label="Upload in chat"
          />
        )}
      </td>
    </tr>
  );
}

export function ContractsSection({
  c,
  jobNumber,
  href,
}: {
  c: JobCommercial;
  jobNumber: string;
  href: (p: string) => string;
}) {
  const o: ContractsOverview | null = c.c;
  const groups = (["prime", "subcontract", "supplier", "other"] as const)
    .map((k) => [k, o?.rows.filter((r) => r.kind === k) ?? []] as const)
    .filter(([, rows]) => rows.length);
  return (
    <section className="jb-section" id="contracts" aria-labelledby="jb-contracts-head">
      <div className="jb-section-head">
        <h2 id="jb-contracts-head">Contracts</h2>
        <p className="jh-small">
          Every agreement on this job: who it's with, what it covers, where it stands.
        </p>
      </div>
      {c.contractsQuery.isLoading ? (
        <div className="jb-card">
          <p role="status">Loading contracts…</p>
        </div>
      ) : !o ? (
        <div className="jb-card">
          <p className="jb-empty">Contracts are unavailable right now. Nothing is assumed empty.</p>
        </div>
      ) : (
        <>
          <dl className="jb-kpis">
            <div>
              <dt>Prime contract</dt>
              <dd>
                {o.prime?.valueCents == null ? "Not on file" : usd(o.prime.valueCents)}
                <small>{o.prime ? o.prime.status.label : "No prime contract recorded"}</small>
              </dd>
            </div>
            <div>
              <dt>Subcontracts</dt>
              <dd>
                {usd(o.totals.subcontract)}
                <small>{o.counts.subcontract} on this job</small>
              </dd>
            </div>
            <div>
              <dt>Suppliers and POs</dt>
              <dd>
                {usd(o.totals.supplier)}
                <small>{o.counts.supplier} on this job</small>
              </dd>
            </div>
            <div>
              <dt>Waiting on a signature</dt>
              <dd>
                {o.outForSignature}
                <small>Sent and not signed back</small>
              </dd>
            </div>
          </dl>
          <div className="jb-card">
            {groups.length ? (
              <div className="jb-table-wrap">
                <table className="jb-table">
                  <thead>
                    <tr>
                      <th scope="col">With</th>
                      <th scope="col">Tagged to</th>
                      <th scope="col" className="jb-num">
                        Value
                      </th>
                      <th scope="col">Status</th>
                      <th scope="col">Signed copy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([kind, rows]) => [
                      <tr className="jb-group" key={`g:${kind}`}>
                        <td colSpan={5}>{GROUP[kind]}</td>
                      </tr>,
                      ...rows.map((r) => (
                        <ContractRowView key={r.key} r={r} jobNumber={jobNumber} href={href} />
                      )),
                    ])}
                  </tbody>
                </table>
              </div>
            ) : o.recordAvailable ? (
              <p className="jb-empty">No contracts on this job yet.</p>
            ) : null}
            {c.posFailed ? (
              <p className="jh-small">
                Purchase orders are unavailable right now, so none are listed.
              </p>
            ) : null}
            {!o.recordAvailable ? (
              <p className="jb-empty" role="status">
                {CONTRACTS_UNAVAILABLE}
              </p>
            ) : null}
            <h3 style={{ margin: "18px 0 0", fontSize: 14, color: "#18314f" }}>Add a contract</h3>
            <ol className="jb-steps">
              <li>Drop the signed PDF into your Athena chat</li>
              <li>Athena reads who it's with, the value and the dates</li>
              <li>You confirm what it's tagged to</li>
              <li>It lands here on the job board</li>
            </ol>
            <div className="jb-actions">
              <CopyAsk
                ask={`Hey Athena, I have a signed contract for job ${jobNumber}. Save it to the job's contracts.`}
                label="Add a contract in Athena chat"
                primary
              />
              <a className="jb-btn" href={href("purchase-orders")}>
                Purchase orders
              </a>
            </div>
          </div>
          {c.contracted && c.g?.exists ? (
            <GbbCard
              g={c.g}
              jobNumber={jobNumber}
              heading="Good, Better, Best options on this contract"
            />
          ) : null}
        </>
      )}
    </section>
  );
}
