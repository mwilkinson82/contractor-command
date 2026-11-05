// Company board (Nov 5 2026, approved by Marshall from the preview): the company's own record, above its jobs.
// Profile, kinds of work, labor rules, decision authority and tools are read from what Athena saved in chat;
// the company details and logo editor moved here from the account page unchanged. Team, plan and billing stay
// on the account page. Every read is the member's own (RLS); the jobs and money summary is leaders only.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AthenaPage } from "@/components/athena/AthenaPage";
import { CompanyProfileSection, useCompanyProfile } from "@/components/account/company-profile-section";
import { reportPageQuery, type PortfolioPayload } from "@/lib/report-pages";
import { buildOwnerPortfolio, percent, shortMoney, type JobMoneyRead } from "@/lib/owner-portfolio";
import { readPortfolioMoney } from "@/lib/owner-portfolio-read";
import {
  decisionFacts,
  laborRows,
  profileFacts,
  shopTile,
  toolFacts,
  workAnswers,
  type CompanyBoardRow,
  type Fact,
} from "@/lib/company-board-model";
import "@/components/account/athena-account.css";
import "./company-board.css";

type Rpc = (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = (f: string, a: Record<string, unknown>) => (supabase.rpc as unknown as Rpc)(f, a);

type Board = { company: CompanyBoardRow | null; role: string | null; leader: boolean };

async function readBoard(companyId: string, userId: string): Promise<Board> {
  const [c, m, l] = await Promise.all([
    supabase.from("mcp_companies").select("*").eq("id", companyId).maybeSingle(),
    supabase.from("mcp_company_members").select("role").eq("company_id", companyId).eq("user_id", userId).maybeSingle(),
    rpc("mcp_is_company_leader", { _company: companyId }),
  ]);
  if (c.error) throw c.error;
  const row = (c.data as CompanyBoardRow | null) ?? null;
  return {
    company: row && row.id === companyId ? row : null,
    role: (m.data as { role?: string } | null)?.role ?? null,
    leader: !l.error && l.data === true,
  };
}

async function readMoney(companyId: string, asOf: string) {
  const { data, error } = await rpc("mcp_report_page_get", reportPageQuery("portfolio", null, companyId).args);
  if (error || !data) return null;
  const payload = data as PortfolioPayload;
  const ids = (payload.jobs ?? []).map((j) => j.job_id);
  const reads = ids.length ? ((await readPortfolioMoney(ids, asOf).catch(() => ({}))) as Record<string, JobMoneyRead>) : {};
  return buildOwnerPortfolio(payload, reads && typeof reads === "object" && !("page" in reads) ? reads : {}, asOf);
}

function Copy({ say }: { say: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="cb-change">
      <span>
        To change it, tell Athena <q className="cb-say">{say}</q>
      </span>
      <button
        type="button"
        className="cb-btn cb-ghost"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(say)
            .then(() => {
              setDone(true);
              window.setTimeout(() => setDone(false), 1800);
            })
            .catch(() => undefined);
        }}
      >
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Facts({ facts, empty }: { facts: Fact[]; empty: string }) {
  if (!facts.length) return <p className="cb-empty">{empty}</p>;
  return (
    <dl className="cb-dl">
      {facts.map((f) => (
        <div key={f.label} className="cb-dl-row">
          <dt>{f.label}</dt>
          <dd>
            {f.value}
            {f.note ? <small>{f.note}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Panel({ id, title, sub, aside, children }: { id: string; title: string; sub?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="cb-panel" id={id} aria-labelledby={`${id}-title`}>
      <div className="cb-phead">
        <h2 id={`${id}-title`}>{title}</h2>
        {aside ?? (sub ? <p>{sub}</p> : null)}
      </div>
      {children}
    </section>
  );
}

type MenuLink = { href: string; label: string; out?: boolean };
type MenuGroup = { label: string; open: boolean; links: MenuLink[] };

function Menu({ groups, current, onPick }: { groups: MenuGroup[]; current: string; onPick: (href: string) => void }) {
  return (
    <nav className="cb-menu" aria-label="Company board menu">
      {groups.map((g) => (
        <details key={g.label} open={g.open}>
          <summary>{g.label}</summary>
          {g.links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className={l.out ? "cb-out" : undefined}
              aria-current={!l.out && current === l.href ? "location" : undefined}
              onClick={() => (l.out ? undefined : onPick(l.href))}
            >
              {l.label}
            </a>
          ))}
        </details>
      ))}
    </nav>
  );
}

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <AthenaPage>
      <div className="cb-notice" role="status">
        <h1>{title}</h1>
        {children}
      </div>
    </AthenaPage>
  );
}

export function CompanyBoard({ companyId }: { companyId: string }) {
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user?.id ?? null;
  const board = useQuery({
    queryKey: ["athena-company-board", companyId, userId],
    enabled: !authLoading && !!userId,
    queryFn: () => readBoard(companyId, userId!),
    retry: false,
  });
  const asOf = new Date().toISOString().slice(0, 10);
  const leader = board.data?.leader === true;
  const money = useQuery({
    queryKey: ["athena-company-board-money", companyId, userId, asOf],
    enabled: leader,
    queryFn: () => readMoney(companyId, asOf),
    retry: false,
    staleTime: 60_000,
  });
  const editor = useCompanyProfile(board.data?.company ? companyId : null);
  const [current, setCurrent] = useState("#profile");
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash) setCurrent(window.location.hash);
  }, []);

  const c = board.data?.company ?? null;
  const work = useMemo(() => workAnswers(c?.work_profile), [c?.work_profile]);
  const labor = useMemo(() => laborRows(c?.work_profile), [c?.work_profile]);

  if (authLoading || (userId && board.isLoading)) return <Notice title="Loading your company board…" />;
  if (!userId) {
    const back = typeof window === "undefined" ? `/r/company/${companyId}` : `${window.location.pathname}${window.location.search}${window.location.hash}`;
    return (
      <Notice title="Sign in to open your company board">
        <p>
          <a href={`/login?redirect=${encodeURIComponent(back)}`}>Sign in</a> with the email you use for Athena and you'll come straight
          back here.
        </p>
      </Notice>
    );
  }
  if (board.error)
    return (
      <Notice title="Your company board could not be loaded">
        <p>Reload the page to try again.</p>
      </Notice>
    );
  if (!c)
    return (
      <Notice title="You don't have access to this company board">
        <p>It's private to the company's members. Ask your company owner if you need it.</p>
      </Notice>
    );

  const name = editor.profile?.name?.trim() || c.name?.trim() || "Your company";
  const isOwner = board.data?.role === "owner";
  const rights = decisionFacts(c.decision_rights);
  const tools = toolFacts(c.tool_stack);
  const facts = profileFacts(c);
  const t = money.data?.totals ?? null;
  const setupDone = work.answered === work.total;
  const groups: MenuGroup[] = [
    {
      label: "Company",
      open: true,
      links: [
        { href: "#profile", label: "Profile" },
        { href: "#work", label: "Kinds of work" },
        { href: "#labor", label: "Labor and wage rules" },
      ],
    },
    {
      label: "How you run",
      open: true,
      links: [
        { href: "#authority", label: "Decision authority" },
        { href: "#tools", label: "Tools you use" },
      ],
    },
    { label: "Client-facing", open: true, links: [{ href: "#branding", label: "Company details and logo" }] },
    {
      label: "Account",
      open: false,
      links: [
        { href: "/account#team", label: "Team and access", out: true },
        { href: "/account#billing", label: "Plan and billing", out: true },
      ],
    },
    ...(leader
      ? [
          {
            label: "Portfolio",
            open: false,
            links: [
              { href: "#portfolio", label: "Jobs and money" },
              { href: `/r/portfolio/${companyId}`, label: "Open portfolio board", out: true },
            ],
          },
        ]
      : []),
  ];

  return (
    <AthenaPage company={name}>
      <div className="cb">
        <div className="cb-bar">
          <nav aria-label="Company pages" className="cb-pages">
            <a href={`/r/company/${companyId}`} aria-current="page">
              Company board
            </a>
            {leader ? <a href={`/r/portfolio/${companyId}`}>Portfolio</a> : null}
            <a href="/account">Account page</a>
          </nav>
        </div>
        <div className="cb-layout">
          <Menu groups={groups} current={current} onPick={setCurrent} />
          <div className="cb-content">
            <section className="cb-hero" id="profile">
              <div>
                <p className="cb-eyebrow">Company board</p>
                <h1>{name}</h1>
                {c.company_role?.trim() ? <p className="cb-sub">{c.company_role.trim()}</p> : null}
              </div>
              <p className="cb-asof">Saved in Athena</p>
            </section>

            <div className="cb-tiles">
              <div className="cb-tile">
                <span>Setup</span>
                <strong>{setupDone ? "Complete" : `${work.answered} of ${work.total}`}</strong>
                <em>{setupDone ? "All kinds of work answered" : "Kinds of work answered so far"}</em>
              </div>
              <div className="cb-tile">
                <span>Trades</span>
                <strong>{(c.trades ?? []).length ? (c.trades ?? []).slice(0, 2).join(", ") : "Not saved yet"}</strong>
                <em>{(c.trades ?? []).length > 2 ? `and ${(c.trades ?? []).length - 2} more` : "From your company profile"}</em>
              </div>
              <div className="cb-tile">
                <span>Shop</span>
                <strong>{shopTile(c.work_profile)}</strong>
                <em>Question 4 of kinds of work</em>
              </div>
              {leader ? (
                <div className="cb-tile">
                  <span>Active jobs</span>
                  <strong>{t ? t.activeJobs : money.isLoading ? "…" : "Not available"}</strong>
                  <em>
                    {t ? `${shortMoney(t.contractCents)} current contract · ` : ""}
                    <a href={`/r/portfolio/${companyId}`}>portfolio</a>
                  </em>
                </div>
              ) : null}
            </div>

            <Panel id="profile-facts" title="Profile" sub="Every new job starts from this">
              <Facts facts={facts} empty="Nothing saved yet." />
              <Copy say="Change our company time zone to Central" />
            </Panel>

            <Panel
              id="work"
              title="Kinds of work"
              aside={
                <span className={setupDone ? "cb-pill cb-good" : "cb-pill"}>
                  {work.answered} of {work.total} answered
                </span>
              }
            >
              <dl className="cb-dl">
                {work.answers.map((a) => (
                  <div key={a.key} className="cb-dl-row">
                    <dt>
                      <span className="cb-q" aria-hidden="true">
                        {a.number}
                      </span>
                      {a.label}
                    </dt>
                    <dd className={a.state === "answered" ? undefined : "cb-muted"}>
                      {Array.isArray(a.value) ? (
                        <span className="cb-chips">
                          {a.value.map((v) => (
                            <span key={v} className="cb-chip">
                              {v}
                            </span>
                          ))}
                        </span>
                      ) : (
                        a.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <Copy say={setupDone ? "Change my kinds of work question 8 to yes" : "Let's finish my kinds of work questions"} />
            </Panel>

            <Panel id="labor" title="Labor and wage rules" sub="What each new job asks about">
              {labor.rows.length ? (
                <div className="cb-table-scroll">
                  <table className="cb-table">
                    <thead>
                      <tr>
                        <th scope="col">Work</th>
                        <th scope="col">Rules Athena checks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {labor.rows.map((r) => (
                        <tr key={r.work}>
                          <td data-label="Work">{r.work}</td>
                          <td data-label="Rules Athena checks">{r.rules}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="cb-empty">Answer question 4 (union or open shop) and the rules show here.</p>
              )}
              <p className="cb-line">
                <strong>Asked on each new job:</strong> {labor.askedOnEachJob}
              </p>
            </Panel>

            <div className="cb-split">
              <Panel id="authority" title="Decision authority" sub="Which role signs off">
                <Facts facts={rights} empty="Not saved yet. Tell Athena who signs off on buyout, change orders and claims." />
                <div className="cb-change">
                  <span>Who has each role is on your account page.</span>
                  <a className="cb-btn cb-ghost" href="/account#team">
                    Team and access
                  </a>
                </div>
              </Panel>
              <Panel id="tools" title="Tools you use" sub="Saved on your profile">
                <Facts facts={tools} empty="Not saved yet. Tell Athena which accounting and project tools you use." />
              </Panel>
            </div>

            <section className="cb-panel" id="branding" aria-labelledby="branding-title">
              <div className="cb-phead">
                <h2 id="branding-title">Company details and logo</h2>
                <p>What clients see on pay apps, proposals, client pages and emails · {isOwner ? "You can edit" : "Owner edits"}</p>
              </div>
              <div className="athena-account cb-editor">
                <CompanyProfileSection key={companyId} state={editor} companyId={companyId} isOwner={isOwner} userId={userId} />
              </div>
            </section>

            {leader ? (
              <Panel id="portfolio" title="Jobs and money" sub="Owners and leadership only">
                {t ? (
                  <div className="cb-tiles">
                    <div className="cb-tile">
                      <span>Active jobs</span>
                      <strong>{t.activeJobs}</strong>
                      <em>
                        {t.counts.good} on track · {t.counts.watch} to watch · {t.counts.risk} at risk
                      </em>
                    </div>
                    <div className="cb-tile">
                      <span>Current contract</span>
                      <strong>{shortMoney(t.contractCents)}</strong>
                      <em>{shortMoney(t.changeCents)} in approved change orders</em>
                    </div>
                    <div className="cb-tile">
                      <span>Planned profit</span>
                      <strong>{t.plannedProfitCents == null ? "Not available" : shortMoney(t.plannedProfitCents)}</strong>
                      <em>
                        {t.plannedProfitCents == null
                          ? "No job has a budget yet"
                          : `${percent(t.plannedMargin)} on ${t.plannedJobs} ${t.plannedJobs === 1 ? "job" : "jobs"}`}
                      </em>
                    </div>
                    <div className="cb-tile">
                      <span>Billed to date</span>
                      <strong>{shortMoney(t.billedCents)}</strong>
                      <em>{percent(t.pctComplete, 0)} of contract</em>
                    </div>
                  </div>
                ) : (
                  <p className="cb-empty">{money.isLoading ? "Reading each job's contract, billing and cost…" : "The money summary could not be read right now."}</p>
                )}
                <div className="cb-change">
                  <a className="cb-btn" href={`/r/portfolio/${companyId}`}>
                    Open the portfolio board
                  </a>
                  <span>Every job's contract, billing, cost and IOR</span>
                </div>
              </Panel>
            ) : null}
          </div>
        </div>
      </div>
    </AthenaPage>
  );
}
