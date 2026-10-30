import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { openBoardPage } from "@/lib/board-link.functions";
import { BoardSignIn } from "./BoardSignIn";
import { ProjectReadUnavailable } from "./ProjectReadUnavailable";
import { projectReadRecovery } from "@/lib/project-read-recovery";
import { usePageVisible } from "./ReportPage";
import { dedupeOpenRows } from "@/lib/mcp/open-feed";
import { lookaheadModel, lookaheadWindow, type SAct } from "@/lib/mcp/styled-views";
import { currentSubmittals } from "@/lib/mcp/submittals";
import type { BoardPage } from "@/lib/mcp/board-link";
import { jobHomePath } from "@/lib/report-pages";
import {
  overviewCommunications,
  overviewContract,
  overviewItemAction,
  overviewPayments,
  type OverviewFact,
} from "@/lib/project-overview";
import { accountingMoney } from "@/lib/accounting-report";
import { detailAnchor } from "@/lib/mcp/plain-label";
import "./project-overview.css";
import type {
  PagePayload,
  FieldPagePayload,
  JobPayload,
  SubmittalsPagePayload,
  DailyPagePayload,
} from "@/lib/report-pages";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;
type Job = { id: string; job_number: string; name: string | null; company_id: string };

/** A home composes existing scoped board reads; it never saves a separate dashboard. */
export function JobHome({ jobId, token }: { jobId: string; token?: string }) {
  const { session, loading } = useAuth();
  const open = useServerFn(openBoardPage);
  const visible = usePageVisible();
  const read = async (page: BoardPage): Promise<PagePayload> => {
    let readError: unknown;
    if (session) {
      const result = await rpc("mcp_report_page_get", { _page: page, _job: jobId, _company: null });
      readError = result.error;
      if (
        !result.error &&
        result.data &&
        typeof result.data === "object" &&
        (result.data as PagePayload).page === page
      )
        return result.data as PagePayload;
    }
    if (token) {
      const result = await open({ data: { token, jobId, page } });
      if (result.status === "ok") return JSON.parse(result.payload) as PagePayload;
    }
    throw readError ?? new Error("This view is unavailable.");
  };
  const field = useQuery({
    queryKey: ["job-home", jobId, "field", session?.user.id, token],
    enabled: !loading && (!!session || !!token),
    queryFn: () => read("field"),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (q) => (visible && !q.state.error ? 60_000 : false),
  });
  const base =
    !field.error && field.data?.page === "field" ? (field.data as FieldPagePayload) : undefined;
  const full = base?.scope === "full";
  const extra = (page: BoardPage, enabled = true) => ({
    queryKey: ["job-home", jobId, page, session?.user.id, token],
    enabled: !!base && enabled,
    queryFn: () => read(page),
    retry: false as const,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (q: { state: { error: unknown } }) =>
      visible && !q.state.error ? 60_000 : false,
  });
  // Each source is independent: an unavailable read cannot be mistaken for zero records.
  const schedule = useQuery(extra("schedule"));
  const lookahead = useQuery(extra("lookahead"));
  const submittals = useQuery(extra("submittals"));
  const daily = useQuery(extra("daily"));
  const billing = useQuery(extra("payapp", full));
  const ior = useQuery(extra("ior", full));
  const financial = useQuery({
    ...extra("field", false),
    queryKey: ["job-home", jobId, "financial", session?.user.id],
    enabled: !!base && full && !!session,
    queryFn: async () => {
      // Canonical read checks active membership and full scope before any financial read.
      const billing = await rpc("mcp_billing_evidence_get", { _job: jobId });
      if (billing.error) throw new Error("Financial evidence unavailable.");
      const facts: OverviewFact[] = [];
      for (let start = 0; ; start += 500) {
        const result = await supabase
          .from("mcp_job_facts")
          .select("module,key,value,status")
          .eq("job_id", jobId)
          .in("module", ["contract", "budget", "job", "setup", "sov"])
          .order("module")
          .order("key")
          .range(start, start + 499);
        if (result.error || !result.data || facts.length + result.data.length > 10_000)
          throw new Error("Contract evidence unavailable; no partial value returned.");
        facts.push(...result.data);
        if (result.data.length < 500) break;
      }
      const [job, outcome] = await Promise.all([
        supabase.from("mcp_jobs").select("sov_fee_pct").eq("id", jobId).single(),
        rpc("mcp_living_report_get", { _job: jobId, _type: "ior", _version: null }),
      ]);
      if (job.error) throw new Error("Contract evidence unavailable.");
      const contract = overviewContract(
        facts,
        job.data.sov_fee_pct,
        outcome.error ? null : (outcome.data as { data?: unknown }),
      );
      if (!contract.source && outcome.error) throw new Error("Contract fallback unavailable.");
      return { contract, payments: overviewPayments(billing.data, jobId) };
    },
  });
  const communications = useQuery({
    ...extra("field", false),
    queryKey: ["job-home", jobId, "communications", session?.user.id],
    enabled: !!base && full && !!session,
    queryFn: async () => {
      // Recheck membership/scope server-side. Share tokens never read job communications.
      const gate = await rpc("mcp_report_page_get", {
        _page: "field",
        _job: jobId,
        _company: null,
      });
      if (gate.error || (gate.data as FieldPagePayload | null)?.scope !== "full")
        throw new Error("Communications unavailable.");
      const [events, mail] = await Promise.all([
        supabase
          .from("mcp_project_record_events")
          .select("id,occurred_at,kind,title,ref_table,ref_id")
          .eq("job_id", jobId)
          .in("kind", ["email_sent", "rfi_answer", "rfc_answer"])
          .order("occurred_at", { ascending: false })
          .order("id")
          .limit(100),
        supabase
          .from("mcp_submittal_mail")
          .select("id,job_id,submittal_id,kind,created_at,approved_at,sent_at,provider,message_id")
          .eq("job_id", jobId)
          .order("created_at", { ascending: false })
          .order("id")
          .limit(100),
      ]);
      if (events.error || mail.error) throw new Error("Communications unavailable.");
      return overviewCommunications({ events: events.data }, mail.data, jobId);
    },
  });
  const jobs = useQuery({
    queryKey: ["job-home-jobs", session?.user.id],
    enabled: !!session && !!base,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mcp_jobs")
        .select("id, job_number, name, company_id")
        .order("job_number");
      if (error) throw error;
      return (data ?? []) as Job[];
    },
  });
  if (loading || field.isLoading)
    return (
      <main className="job-home">
        <p role="status">Loading project…</p>
      </main>
    );
  if (!base)
    return projectReadRecovery(!!session, field.error) === "sign-in" ? (
      <BoardSignIn returnTo={`/r/job/${jobId}/home`} />
    ) : (
      <ProjectReadUnavailable />
    );
  const href = (page: string) =>
    `/r/job/${jobId}/${page}${token && !["accounting", "purchase-orders", "billing-records", "production"].includes(page) ? `?t=${encodeURIComponent(token)}` : ""}`;
  const state = (q: { isLoading: boolean; error: unknown }, text: string) =>
    q.isLoading ? "Loading…" : q.error ? "Currently unavailable" : text;
  const sched = schedule.data?.page === "schedule" ? (schedule.data as JobPayload).report : null;
  const subs =
    submittals.data?.page === "submittals" ? (submittals.data as SubmittalsPagePayload) : null;
  const today = daily.data?.page === "daily" ? (daily.data as DailyPagePayload) : null;
  const la = lookahead.data?.page === "lookahead" ? lookahead.data : null;
  const laWindow = la
    ? lookaheadWindow(la.lookahead ?? null, la.report?.found ? (la.report.data_date ?? null) : null)
    : null;
  const laDetail =
    laWindow && la && Array.isArray(la.report?.data?.activities)
      ? `${lookaheadModel(laWindow.start, laWindow.end, (la.report?.data?.activities ?? []) as SAct[], la.items ?? [], { today: la.today, dataDate: la.report?.data_date }).counts.activities} activities in window`
      : laWindow
        ? "Activity details unavailable"
        : la?.report && typeof la.report.found === "boolean"
          ? "No lookahead window or saved schedule yet"
          : "Currently unavailable";
  const openItems = Array.isArray(base.items)
    ? dedupeOpenRows(
        (base.items ?? []).map((item, i) => ({
          ...item,
          id: item.id || String(i),
          action: item.action || "Item",
        })),
      )
    : null;
  const count = openItems?.length ?? null;
  const tiles = [
    {
      title: "Schedule",
      detail: state(
        schedule,
        sched?.found
          ? Array.isArray(sched.data?.activities)
            ? `${sched.data.activities.length} saved activities`
            : "Activity details unavailable"
          : sched?.found === false
            ? "No schedule recorded yet"
            : "Currently unavailable",
      ),
      page: "schedule",
    },
    { title: "Two-week lookahead", detail: state(lookahead, laDetail), page: "lookahead" },
    {
      title: "Open items",
      detail:
        count === null
          ? "Currently unavailable"
          : `${count} open ${count === 1 ? "item" : "items"}`,
      page: "items",
    },
    {
      title: "Submittals",
      detail: state(
        submittals,
        subs && Array.isArray(subs.submittals)
          ? `${currentSubmittals(subs.submittals).filter((row) => row.status !== "void").length} current submittals`
          : "Currently unavailable",
      ),
      page: "submittals",
    },
    { title: "RFI log", detail: "View saved requests", page: "rfis" },
    { title: "RFC log", detail: "View saved requests", page: "rfcs" },
    {
      title: "Daily reports",
      detail: state(
        daily,
        today?.found
          ? `Latest report · ${today.report_date ?? "Date not recorded"}`
          : today?.found === false
            ? "No report recorded yet"
            : "Currently unavailable",
      ),
      page: "daily",
    },
    {
      title: "Production",
      detail: "Recorded quantities, hours and actual rates",
      page: "production",
    },
    { title: "Field board", detail: "Activities, crews and follow-ups", page: "field" },
    { title: "Progress photos", detail: "View saved photos", page: "photos" },
    ...(full
      ? [
          {
            title: "Accounting evidence",
            detail: "Job ledger, budget comparison and accountant export",
            page: "accounting",
          },
          { title: "Change orders", detail: "View saved log", page: "cos" },
          {
            title: "Suppliers and purchase orders",
            detail: "View project parties and PO drafts",
            page: "purchase-orders",
          },
          {
            title: "Billing and payment records",
            detail: "View recorded invoices and receipts",
            page: "billing-records",
          },
          {
            title: "Billing forecast",
            detail: state(
              billing,
              billing.data?.page === "payapp" && billing.data.report?.found
                ? "View saved billing"
                : billing.data?.page === "payapp" && billing.data.report?.found === false
                  ? "No billing recorded yet"
                  : "Currently unavailable",
            ),
            page: "payapp",
          },
          {
            title: "Indicated Outcome Report",
            detail: state(
              ior,
              ior.data?.page === "ior" && ior.data.report?.found
                ? "View saved IOR"
                : ior.data?.page === "ior" && ior.data.report?.found === false
                  ? "No IOR recorded yet"
                  : "Currently unavailable",
            ),
            page: "ior",
          },
        ]
      : []),
  ];
  // Never render a cached financial/communication result after a denied refresh or scope change.
  const money = full && session && !financial.error ? financial.data : undefined;
  const payment = (key: string) => money?.payments.metrics.find((m) => m.key === key);
  const amount = (key: string) =>
    financial.isLoading
      ? "Loading…"
      : !session
        ? "Sign in to view"
        : financial.error
          ? "Currently unavailable"
          : accountingMoney(payment(key)?.cents ?? null);
  const comms = full && session && !communications.error ? communications.data : undefined;
  const orderedItems = openItems
    ?.slice()
    .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  return (
    <main className="job-home">
      <div className="jh-shell">
        <div className="jh-top">
          <a className="jh-brand" href={jobHomePath(jobId)}>
            ATHENA
          </a>
          <span className="jh-project">
            {base.company || "Your project"} / {base.job_number}
            {base.job_name ? ` · ${base.job_name}` : ""}
          </span>
          {jobs.data && jobs.data.length > 1 ? (
            <label className="jh-select">
              Saved jobs
              <select
                value={jobId}
                onChange={(e) => {
                  if (e.target.value !== jobId) window.location.assign(jobHomePath(e.target.value));
                }}
              >
                {jobs.data.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.job_number} · {j.name ?? "Saved job"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="jh-layout">
          <nav className="jh-nav" aria-label="Project views">
            <a href="#overview" aria-current="page">
              Overview
            </a>
            {tiles.map((tile) => (
              <a key={tile.page} href={href(tile.page)}>
                {tile.title}
              </a>
            ))}
          </nav>
          <div className="jh-content" id="overview">
            <header className="jh-hero">
              <div>
                <p className="jh-eyebrow">Project Overview</p>
                <h1>{base.job_name || base.job_number || "Your project"}</h1>
                <p>
                  {base.job_number} · {full ? "Project overview" : "Field overview"}
                </p>
              </div>
              {full ? (
                <a className="jh-button" href={href("accounting")}>
                  Full accounting evidence →
                </a>
              ) : null}
            </header>
            {full ? (
              <section aria-label="Contract and customer payments">
                <div className="jh-metrics">
                  <article className="jh-metric">
                    <h2>Current contract value</h2>
                    <strong>
                      {financial.isLoading
                        ? "Loading…"
                        : !session
                          ? "Sign in to view"
                          : financial.error
                            ? "Currently unavailable"
                            : money?.contract.amount == null
                              ? "Needed"
                              : new Intl.NumberFormat("en-US", {
                                  style: "currency",
                                  currency: "USD",
                                }).format(money.contract.amount)}
                    </strong>
                    <p>
                      {money?.contract.source ? `Source: ${money.contract.source}. ` : ""}
                      {money?.contract.basis || "Saved contract / setup evidence required."}
                    </p>
                    {money?.contract.source === "SOV" || money?.contract.source === "IOR" ? (
                      <a href={href(money.contract.source === "IOR" ? "ior" : "payapp")}>
                        Review value source →
                      </a>
                    ) : null}
                    {money?.contract.source === "job setup" ? (
                      <details>
                        <summary>Setup value provenance</summary>
                        <p>
                          Original saved setup value:{" "}
                          {money.contract.original == null
                            ? "Unknown"
                            : new Intl.NumberFormat("en-US", {
                                style: "currency",
                                currency: "USD",
                              }).format(money.contract.original)}
                          .
                        </p>
                        <p>
                          Recorded executed change-order delta:{" "}
                          {typeof money.contract.executedDelta === "number"
                            ? new Intl.NumberFormat("en-US", {
                                style: "currency",
                                currency: "USD",
                              }).format(money.contract.executedDelta)
                            : "Not recorded; no additional delta is assumed by the existing selector"}
                          .
                        </p>
                      </details>
                    ) : null}
                    <span className="jh-small">
                      For saved setup facts and contract originals, ask Athena to show contract
                      terms and source references.
                    </span>
                  </article>
                  <article className="jh-metric">
                    <h2>Paid to date / recorded receipts</h2>
                    <strong>{amount("receipts")}</strong>
                    <p>
                      {payment("receipts")?.basis ||
                        "Recorded receipts less evidence reversals. Allocations are not new cash."}
                    </p>
                    <a href={href("billing-records")}>Receipt evidence and originals →</a>
                  </article>
                  <article className="jh-metric">
                    <h2>Outstanding customer payments</h2>
                    <strong>{amount("unpaid_invoices")}</strong>
                    <p>
                      {payment("unpaid_invoices")?.basis ||
                        "Unpaid recorded invoices; no balance inferred from contract value."}
                    </p>
                    <a href={href("billing-records")}>Invoice evidence and history →</a>
                  </article>
                </div>
                <div className="jh-separate">
                  <b>Keep separate</b>
                  <span>
                    Unapplied receipts <strong>{amount("unapplied_receipts")}</strong>
                  </span>
                  <span>
                    Recorded retainage held <strong>{amount("retainage")}</strong>
                  </span>
                </div>
                <p className="jh-note">
                  {money
                    ? `${money.payments.currency} · Inception through ${money.payments.asOf}, inclusive · Captured ${money.payments.capturedAt}. `
                    : "USD evidence; as-of unavailable until the source is read. "}
                  Entered evidence, not bank reconciliation. Missing opening records can leave
                  coverage incomplete. Unknown differs from zero; these measures do not establish
                  profit or a paid-contract percentage.
                </p>
              </section>
            ) : (
              <p className="jh-scope">
                Field view · Financial amounts and private job communications are restricted to
                authenticated full project access.
              </p>
            )}
            <div className="jh-columns">
              <section className="jh-panel" aria-labelledby="jh-schedule">
                <h2 id="jh-schedule">Schedule &amp; next work</h2>
                <div className="jh-panel-body">
                  <div className="jh-heading">
                    <h3>Schedule and two-week lookahead</h3>
                    <span className="jh-badge">
                      {state(
                        schedule,
                        sched?.found
                          ? "Saved schedule"
                          : sched?.found === false
                            ? "Not recorded"
                            : "Currently unavailable",
                      )}
                    </span>
                  </div>
                  <p>
                    {tiles[0].detail}
                    {sched?.found && sched.data_date ? ` · Data date ${sched.data_date}` : ""}
                  </p>
                  <p>
                    {state(lookahead, laDetail)}
                    {laWindow ? ` · ${laWindow.start} through ${laWindow.end}` : ""}
                  </p>
                  <div className="jh-actions">
                    <a className="jh-button" href={href("schedule")}>
                      Open schedule
                    </a>
                    <a className="jh-button" href={href("lookahead")}>
                      Two-week lookahead
                    </a>
                  </div>
                </div>
                <div className="jh-panel-body jh-divider">
                  <div className="jh-heading">
                    <h3>
                      {count === null
                        ? "Open items unavailable"
                        : `${count} open ${count === 1 ? "item" : "items"}`}
                    </h3>
                    <a href={href("items")}>Review all →</a>
                  </div>
                  <p className="jh-small">
                    Dates are recorded source dates and can include workflow defaults. Review the
                    source before treating a date as a contractual deadline.
                  </p>
                  {orderedItems?.length === 0 ? (
                    <p>No open items in the current scoped feed.</p>
                  ) : null}
                  {orderedItems?.slice(0, 5).map((item, n) => {
                    const action = overviewItemAction(item);
                    return (
                      <div className="jh-item" key={item.id || n}>
                        <strong>{item.action}</strong>
                        <p>
                          {item.owner || "Owner needed"} ·{" "}
                          {item.due ? `Due ${item.due.slice(0, 10)}` : "Due date needed"}
                        </p>
                        <a
                          href={`${href(action.page)}${action.page === "items" && item.id ? `#${detailAnchor("item", item.id)}` : ""}`}
                        >
                          {action.label} →
                        </a>
                        <details>
                          <summary>Schedule / set due date</summary>
                          <p>{action.guidance}</p>
                          <p>
                            This overview makes no date changes. No calendar meeting is created.
                          </p>
                        </details>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="jh-panel" aria-labelledby="jh-communications">
                <h2 id="jh-communications">Latest Athena job communications</h2>
                <div className="jh-panel-body">
                  <p>
                    Saved job-linked records only. Drafts, approvals, recorded responses and send
                    receipts have different meanings.
                  </p>
                  {!full || !session ? (
                    <p>Sign in with full project access to view these records.</p>
                  ) : communications.isLoading ? (
                    <p role="status">Loading communications…</p>
                  ) : communications.error ? (
                    <p>Currently unavailable. No empty result is inferred.</p>
                  ) : comms?.length === 0 ? (
                    <p>
                      No matching communication records in the latest saved source windows. This is
                      not an inbox or a complete email history.
                    </p>
                  ) : !comms ? (
                    <p>Currently unavailable.</p>
                  ) : null}
                  {comms?.map((row) => (
                    <article className="jh-comm" id={row.id} key={row.id}>
                      <span className="jh-badge">{row.status}</span>
                      <h3>{row.title}</h3>
                      <time dateTime={row.when}>
                        {row.when.replace("T", " ").replace("Z", " UTC")}
                      </time>
                      <p>{row.basis}</p>
                      <details>
                        <summary>Source record</summary>
                        <p>
                          {row.sourceTable === "mcp_submittal_mail"
                            ? "Saved delivery record"
                            : "Saved project event"}{" "}
                          · {row.sourceId}
                        </p>
                        {row.page ? (
                          <a
                            href={`${href(row.page)}${row.anchor ? `#${detailAnchor("submittal", row.anchor)}` : ""}`}
                          >
                            Open source log and history →
                          </a>
                        ) : (
                          <p>
                            Ask Athena for this job's project-record event by this source ID.
                            Generic email authorizations have no delivery receipt link.
                          </p>
                        )}
                      </details>
                    </article>
                  ))}
                  {comms?.length ? (
                    <p className="jh-small">
                      Up to 12 latest matching records from the latest 100 events and 100 mail
                      drafts. A host receipt is not independent provider confirmation. No personal
                      inbox is read.
                    </p>
                  ) : null}
                </div>
              </section>
            </div>
            <section className="jh-panel jh-routines" aria-labelledby="jh-routines">
              <h2 id="jh-routines">Routines &amp; reminders</h2>
              <div className="jh-panel-body">
                {session ? (
                  <a className="jh-button" href="/today">
                    Open existing morning brief →
                  </a>
                ) : null}
                <details>
                  <summary>Use existing job routines</summary>
                  <p>
                    In your connected Athena chat, ask to run the morning, evening or PM meeting
                    routine for {base.job_number || "this job"}. These are guided in-app workflows.
                    Review the saved job and confirm any proposed action.
                  </p>
                  <p>
                    The daily-report reminder appears during your next Athena interaction after its
                    configured time when today's report is missing. Background push delivery is not
                    verified here. These routines do not create external calendar events.
                  </p>
                </details>
                <a href={href("daily")}>Daily reports and saved field evidence →</a>
              </div>
            </section>
            <section className="jh-panel" aria-labelledby="jh-evidence">
              <h2 id="jh-evidence">
                {full ? "Commercial evidence & project views" : "Project evidence & views"}
              </h2>
              <div className="jh-panel-body">
                <p>
                  Open the source workspace for recorded measures, original documents, versions and
                  history. Access to financial originals is checked separately for your role.
                </p>
                <div className="jh-grid">
                  {tiles.map((tile) => (
                    <a className="jh-card" key={tile.page} href={href(tile.page)}>
                      <strong>{tile.title}</strong>
                      <span>{tile.detail}</span>
                      <b>Open →</b>
                    </a>
                  ))}
                </div>
                <p className="jh-note">
                  Saved contracts, specifications and drawings are available through Athena in chat.
                  Ask to list this job’s project documents or drawing sets and open their original
                  source references.
                </p>
              </div>
            </section>
            <p className="jh-note">
              Each source refreshes independently while this page is open. Open a workspace for its
              current version; this overview is not an atomic project snapshot.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
