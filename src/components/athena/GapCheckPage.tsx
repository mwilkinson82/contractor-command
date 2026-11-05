import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  ANSWER_LABEL,
  COLUMNS,
  COLUMN_LABEL,
  COVERED_BY,
  COVERED_LABEL,
  TEMP_UTILITY_RE,
  answerProblem,
  answerSummary,
  columnOf,
  defaultQuestion,
  exposureText,
  money,
  nextGap,
  parseBoard,
  progress,
  stillHolds,
  walkOrder,
  type AnswerInput,
  type Column,
  type CoveredBy,
  type GapAnswerKind,
  type GapCheckItem,
} from "@/lib/mcp/gap-check";
import { gapCheckFileName, gapCheckSheets, gapCheckXlsx } from "@/lib/gap-check-xlsx";
import type { XlsxCell } from "@/lib/xlsx-writer";
import { BoardSignIn } from "./BoardSignIn";
import { ProjectReadUnavailable } from "./ProjectReadUnavailable";
import { AthenaBrand, AthenaFooter } from "./AthenaBrand";
import { CopyAsk } from "./JobHomeCommercial";
import "./project-overview.css";
import "./job-board-commercial.css";
import "./gap-check.css";

const rpc = supabase.rpc.bind(supabase) as unknown as (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message?: string } | null }>;

type View = "walk" | "board" | "excel";
type Board = ReturnType<typeof parseBoard>;
type Move = { ref: string; title: string; to: Column; summary: string; from: string; at: number };

const POLL_MS = 3000;
const VIEW_KEY = "athena-gap-check-view";
const SOURCE_LABEL: Record<string, string> = {
  chat: "from your Athena chat",
  board: "on the board",
  walkthrough: "in the walk-through",
  excel: "from Excel",
};

const plainError = (e: unknown) =>
  (e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e))
    .replace(/^MCP_BAD:/, "")
    .replace(/^MCP_NO_JOB$/, "This job isn't available to you.");

function readView(): View {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return v === "board" || v === "excel" ? v : "walk";
  } catch {
    return "walk";
  }
}

/** The estimate's gap check: walk through each gap, watch the board move as the chat saves answers, or take it to Excel. */
export function GapCheckPage({ jobId }: { jobId: string }) {
  const { session, loading } = useAuth();
  const qc = useQueryClient();
  const key = ["gap-check", jobId, session?.user.id];
  const q = useQuery({
    queryKey: key,
    enabled: !loading && !!session,
    retry: false,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await rpc("mcp_estimate_gap_board", { _job: jobId });
      if (error) throw new Error(plainError(error));
      return parseBoard(data);
    },
  });
  const [view, setView] = useState<View>("walk");
  useEffect(() => setView(readView()), []);
  const pick = (v: View) => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* per-viewer convenience only */
    }
  };

  // Moves that arrive from the chat (or another screen) between polls.
  const [moves, setMoves] = useState<Move[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const last = useRef<Map<string, Column | "dropped"> | null>(null);
  const mine = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!q.data) return;
    const now = new Map(q.data.items.map((i) => [i.ref, columnOf(i)] as const));
    const before = last.current;
    last.current = now;
    if (!before) return;
    const changed: Move[] = [];
    for (const it of q.data.items) {
      const was = before.get(it.ref);
      const col = now.get(it.ref)!;
      if (was === undefined || was === col || col === "dropped") continue;
      if (mine.current.delete(it.ref)) continue;
      changed.push({
        ref: it.ref,
        title: it.title,
        to: col,
        summary: it.answer ? answerSummary(it.answer) : COLUMN_LABEL[col],
        from: it.answer ? SOURCE_LABEL[it.answer.source] : "",
        at: Date.now(),
      });
    }
    if (!changed.length) return;
    setMoves((m) => [...changed, ...m].slice(0, 20));
    setFresh(new Set(changed.map((c) => c.ref)));
    const t = window.setTimeout(() => setFresh(new Set()), 1600);
    return () => window.clearTimeout(t);
  }, [q.data]);

  const save = async (gap: GapCheckItem, input: AnswerInput | null, source: "board" | "walkthrough") => {
    mine.current.add(gap.ref);
    const { error } = input
      ? await rpc("mcp_estimate_gap_answer_save", {
          _job: jobId,
          _gap: gap.ref,
          _answer: input.answer,
          _amount: input.amount ?? null,
          _covered_by: input.covered_by ?? null,
          _note: input.note ?? null,
          _qualification: input.qualification ?? null,
          _question: input.question ?? null,
          _source: source,
        })
      : await rpc("mcp_estimate_gap_answer_clear", { _job: jobId, _gap: gap.ref });
    if (error) {
      mine.current.delete(gap.ref);
      throw new Error(plainError(error));
    }
    await qc.invalidateQueries({ queryKey: key });
  };

  if (loading || q.isLoading)
    return (
      <main className="job-home">
        <p role="status">Loading the gap check…</p>
      </main>
    );
  if (!session) return <BoardSignIn returnTo={`/r/job/${jobId}/gap-check`} />;
  if (!q.data) return <ProjectReadUnavailable />;
  const b = q.data;
  const p = progress(b.items);
  const ask = `Hey Athena, let's walk the gap check for job ${b.jobNumber}.`;
  return (
    <main className="job-home gc">
      <div className="jh-shell">
        <div className="jh-top">
          <AthenaBrand jobId={jobId} company={b.company ?? undefined} />
          <span className="jh-project">
            {b.jobNumber}
            {b.jobName ? ` · ${b.jobName}` : ""}
          </span>
          <div className="jh-top-right">
            <a className="jb-btn" href={`/r/job/${jobId}/estimate`}>
              Back to the estimate
            </a>
          </div>
        </div>
        <div className="jh-content">
          <header className="gc-top">
            <div className="gc-toprow">
              <div>
                <p className="jh-eyebrow">Estimate · Gap check</p>
                <h1>{b.jobName || b.jobNumber}</h1>
                <p className="gc-muted">
                  Each gap is something the drawings, notes, specs and contract don't line up on. Answer each one so you
                  know it's in your number.
                </p>
              </div>
              <div className="gc-topright">
                <span className={`gc-verdict${p.met ? " met" : ""}`}>
                  {p.met ? "Gap check met" : p.total ? "Gap check not met" : "No gaps yet"}
                </span>
                <CopyAsk ask={ask} label="Walk it in Athena chat" />
              </div>
            </div>
            <div className="gc-kpis">
              <div>
                <span>Answered</span>
                <strong>
                  {p.answered} of {p.total}
                </strong>
              </div>
              <div>
                <span>Still holding the bid</span>
                <strong className={p.holding ? "risk" : ""}>{p.holding}</strong>
              </div>
              <div>
                <span>Unanswered money at risk</span>
                <strong className={p.exposureHigh ? "risk" : ""}>
                  {p.exposureHigh
                    ? p.exposureLow && p.exposureLow !== p.exposureHigh
                      ? `${money(p.exposureLow)} to ${money(p.exposureHigh)}`
                      : money(p.exposureHigh)
                    : "$0"}
                </strong>
              </div>
              <div>
                <span>You're carrying</span>
                <strong>{money(p.carrying) || "$0"}</strong>
              </div>
            </div>
            <div className="gc-track" aria-hidden="true">
              <i style={{ width: `${p.total ? Math.round((p.answered / p.total) * 100) : 0}%` }} />
            </div>
            <div className="gc-tabs" role="tablist" aria-label="Gap check views">
              {(
                [
                  ["walk", "Walk through"],
                  ["board", "Board"],
                  ["excel", "Excel"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  className="gc-tab"
                  aria-selected={view === v}
                  onClick={() => pick(v)}
                >
                  {label}
                  {v === "board" ? <span className="gc-count">{p.open} to answer</span> : null}
                </button>
              ))}
            </div>
          </header>
          {!p.total ? (
            <section className="jb-card">
              <h2>No gaps yet</h2>
              <p>Athena builds the gap list when it checks the takeoff against the drawings, notes, specs and contract.</p>
              <div className="jb-actions">
                <CopyAsk
                  ask={`Hey Athena, run the gap analysis on the estimate for job ${b.jobNumber}.`}
                  label="Run the gap analysis in Athena chat"
                  primary
                />
              </div>
            </section>
          ) : view === "walk" ? (
            <Walk items={b.items} onSave={(g, i) => save(g, i, "walkthrough")} />
          ) : view === "board" ? (
            <BoardView
              items={b.items}
              moves={moves}
              fresh={fresh}
              updatedAt={q.dataUpdatedAt}
              ask={ask}
              onSave={(g, i) => save(g, i, "board")}
            />
          ) : (
            <ExcelView board={b} />
          )}
        </div>
      </div>
      <div className="jh-foot">
        <AthenaFooter jobId={jobId} />
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ walk-through */

export function Walk({
  items,
  onSave,
}: {
  items: GapCheckItem[];
  onSave: (g: GapCheckItem, input: AnswerInput | null) => Promise<void>;
}) {
  const order = useMemo(() => walkOrder(items), [items]);
  const [current, setCurrent] = useState<string | null>(null);
  const ref = current && order.some((g) => g.ref === current) ? current : (nextGap(items)?.ref ?? order[0]?.ref);
  const gap = order.find((g) => g.ref === ref) ?? null;
  const holds = order.filter((g) => g.holds_bid);
  const rest = order.filter((g) => !g.holds_bid);
  const idx = gap ? order.findIndex((g) => g.ref === gap.ref) : -1;
  const go = (r: string | undefined) => {
    if (!r) return;
    setCurrent(r);
    document.getElementById("gc-stage")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  return (
    <section>
      <div className="gc-strip" aria-label="Gaps">
        {order.map((g) => (
          <button
            key={g.ref}
            type="button"
            className="gc-chip"
            aria-current={g.ref === ref}
            onClick={() => go(g.ref)}
          >
            <Dot g={g} />
            {g.ref}
          </button>
        ))}
      </div>
      <div className="gc-walk">
        <nav className="gc-rail" aria-label="Gaps">
          {holds.length ? <p className="gc-railgroup">Holds the bid</p> : null}
          {holds.map((g) => (
            <RailItem key={g.ref} g={g} on={g.ref === ref} go={go} />
          ))}
          {rest.length ? <p className="gc-railgroup">Worth checking</p> : null}
          {rest.map((g) => (
            <RailItem key={g.ref} g={g} on={g.ref === ref} go={go} />
          ))}
        </nav>
        <div id="gc-stage">
          {gap ? (
            <GapCard
              key={gap.ref}
              gap={gap}
              onSave={async (input) => {
                await onSave(gap, input);
                if (input) {
                  const after = order.filter((g) => g.ref !== gap.ref && columnOf(g) === "to_answer");
                  if (after[0]) setCurrent(after[0].ref);
                }
              }}
              prev={idx > 0 ? () => go(order[idx - 1].ref) : null}
              next={idx >= 0 && idx < order.length - 1 ? () => go(order[idx + 1].ref) : null}
              position={`${idx + 1} of ${order.length}`}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Dot({ g }: { g: GapCheckItem }) {
  const col = columnOf(g);
  const cls = col === "to_answer" ? (g.holds_bid ? "hold" : "") : col;
  return <i className={`gc-dot ${cls}`} aria-hidden="true" />;
}

function RailItem({ g, on, go }: { g: GapCheckItem; on: boolean; go: (r: string) => void }) {
  return (
    <button type="button" className="gc-railitem" aria-current={on} onClick={() => go(g.ref)}>
      <Dot g={g} />
      <span className="t">{g.title}</span>
      <span className="r">{g.ref}</span>
    </button>
  );
}

const OPTION_HINT: Record<GapAnswerKind, string> = {
  carrying: "Put a dollar amount in the estimate for it.",
  covered: "Name the line, quote or letter that already has it.",
  understood: "Leave it out and say so in the proposal.",
  rfi: "Ask before bid. It holds the bid until the answer's back.",
};

function GapCard({
  gap,
  onSave,
  prev,
  next,
  position,
}: {
  gap: GapCheckItem;
  onSave: (input: AnswerInput | null) => Promise<void>;
  prev: (() => void) | null;
  next: (() => void) | null;
  position: string;
}) {
  const col = columnOf(gap);
  const [editing, setEditing] = useState(col === "to_answer");
  const exposure = exposureText(gap);
  return (
    <article className="gc-gap">
      <div className="gc-gaphead">
        <div className="gc-meta">
          <span className="gc-badge">{gap.ref}</span>
          {stillHolds(gap) ? <span className="gc-badge risk">Holds the bid</span> : null}
          {gap.conditional ? <span className="gc-badge risk">Only if the owner agrees</span> : null}
          {col !== "to_answer" ? (
            <span className={`gc-badge ${col === "rfi" ? "wait" : "ok"}`}>{COLUMN_LABEL[col as Column]}</span>
          ) : null}
          <span className="gc-muted gc-small">{position}</span>
        </div>
        <h2>{gap.title}</h2>
        <p className="gc-read">{gap.reasoning}</p>
      </div>
      <div className="gc-gapbody">
        {gap.condition_text ? (
          <div className="gc-warn">
            <b>The note says:</b> “{gap.condition_text}” The owner can still say no on load. A spare breaker isn't a
            yes. If they refuse, you own the generator, fuel and service for the whole job, and longer if it runs late.
          </div>
        ) : null}
        <div className="gc-sect">
          <h3>Where Athena found it</h3>
          <ul className="gc-sources">
            {(gap.citations.length ? gap.citations : [`${gap.sheet} · ${gap.spec_section}`]).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        {exposure || gap.schedule_activity ? (
          <div className="gc-money">
            {exposure ? (
              <div>
                <span>At risk if it's missed</span>
                <strong className="risk">{exposure}</strong>
              </div>
            ) : null}
            {gap.schedule_activity ? (
              <div>
                <span>Runs with</span>
                <strong>{gap.schedule_activity}</strong>
              </div>
            ) : null}
          </div>
        ) : null}
        {gap.answer && !editing ? (
          <div className={`gc-answered${gap.answer.answer === "rfi" ? " wait" : ""}`}>
            <p className="lead">{answerSummary(gap.answer)}</p>
            <p className="gc-small gc-muted">Answered {SOURCE_LABEL[gap.answer.source]}.</p>
            <div className="gc-actions">
              <button type="button" className="jb-btn" onClick={() => setEditing(true)}>
                Change the answer
              </button>
              <button type="button" className="jb-btn gc-quiet" onClick={() => void onSave(null)}>
                Move back to To answer
              </button>
            </div>
          </div>
        ) : !gap.answer && col !== "to_answer" && !editing ? (
          <div className="gc-answered">
            <p className="lead">Marked earlier: {gap.verdict?.owner ?? gap.verdict?.note ?? COLUMN_LABEL[col as Column]}</p>
            <div className="gc-actions">
              <button type="button" className="jb-btn" onClick={() => setEditing(true)}>
                Answer it in the gap check
              </button>
            </div>
          </div>
        ) : (
          <AnswerBox gap={gap} onSave={async (i) => { await onSave(i); setEditing(false); }} />
        )}
      </div>
      <div className="gc-nav">
        <button type="button" className="jb-btn gc-quiet" disabled={!prev} onClick={() => prev?.()}>
          Previous
        </button>
        <button type="button" className="jb-btn" disabled={!next} onClick={() => next?.()}>
          Next gap
        </button>
      </div>
    </article>
  );
}

function AnswerBox({
  gap,
  onSave,
  compact,
  initial,
}: {
  gap: GapCheckItem;
  onSave: (input: AnswerInput) => Promise<void>;
  compact?: boolean;
  initial?: GapAnswerKind;
}) {
  const [kind, setKind] = useState<GapAnswerKind | null>(initial ?? gap.answer?.answer ?? null);
  const [amount, setAmount] = useState(gap.answer?.amount != null ? String(gap.answer.amount) : "");
  const [coveredBy, setCoveredBy] = useState<CoveredBy | "">(gap.answer?.covered_by ?? "");
  const [note, setNote] = useState(gap.answer?.note ?? "");
  const [qual, setQual] = useState(gap.answer?.qualification ?? "");
  const [rfi, setRfi] = useState(gap.answer?.question ?? gap.question ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const temp = gap.conditional || TEMP_UTILITY_RE.test(gap.title);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    const input: AnswerInput = {
      answer: kind,
      amount: kind === "carrying" ? (amount.trim() === "" ? null : Number(amount.replace(/[$,\s]/g, ""))) : null,
      covered_by: kind === "covered" ? (coveredBy || null) : null,
      note: note.trim() || null,
      qualification: kind === "understood" ? qual.trim() || null : null,
      question: kind === "rfi" ? rfi.trim() || null : null,
    };
    const why = answerProblem(gap, input);
    if (why) return setProblem(why);
    setBusy(true);
    setProblem(null);
    try {
      await onSave(input);
    } catch (err) {
      setProblem(plainError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="gc-ask" onSubmit={submit}>
      {!compact ? <p className="q">{gap.question ?? defaultQuestion(gap)}</p> : null}
      <div className={`gc-opts${compact ? " compact" : ""}`} role="group" aria-label="Your answer">
        {(Object.keys(ANSWER_LABEL) as GapAnswerKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className="gc-opt"
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setProblem(null);
            }}
          >
            <b>{ANSWER_LABEL[k]}</b>
            {!compact ? <span>{OPTION_HINT[k]}</span> : null}
          </button>
        ))}
      </div>
      {kind === "carrying" ? (
        <>
          {temp && !compact ? <TempPowerCalc onUse={(n, how) => { setAmount(String(n)); setNote(how); }} /> : null}
          <div className="gc-field">
            <label htmlFor={`amt-${gap.ref}`}>What you're carrying</label>
            <input
              id={`amt-${gap.ref}`}
              inputMode="decimal"
              placeholder="$0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="gc-field">
            <label htmlFor={`note-${gap.ref}`}>Where it sits in the estimate (optional)</label>
            <input id={`note-${gap.ref}`} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </>
      ) : null}
      {kind === "covered" ? (
        <>
          <div className="gc-field">
            <label htmlFor={`by-${gap.ref}`}>Covered by</label>
            <select id={`by-${gap.ref}`} value={coveredBy} onChange={(e) => setCoveredBy(e.target.value as CoveredBy)}>
              <option value="">Choose…</option>
              {COVERED_BY.map((c) => (
                <option key={c} value={c}>
                  {COVERED_LABEL[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="gc-field">
            <label htmlFor={`cov-${gap.ref}`}>Which line, quote or letter</label>
            <input
              id={`cov-${gap.ref}`}
              placeholder="For example: GC line 01-500, or Summit quote of Oct 30"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </>
      ) : null}
      {kind === "understood" ? (
        <div className="gc-field">
          <label htmlFor={`q-${gap.ref}`}>Qualification for the proposal</label>
          <textarea
            id={`q-${gap.ref}`}
            placeholder="For example: Arc flash study by owner. Not included."
            value={qual}
            onChange={(e) => setQual(e.target.value)}
          />
        </div>
      ) : null}
      {kind === "rfi" ? (
        <div className="gc-field">
          <label htmlFor={`r-${gap.ref}`}>Your RFI question</label>
          <textarea id={`r-${gap.ref}`} value={rfi} onChange={(e) => setRfi(e.target.value)} />
        </div>
      ) : null}
      {problem ? (
        <p className="gc-warn" role="alert">
          {problem}
        </p>
      ) : null}
      {kind ? (
        <div className="gc-actions">
          <button type="submit" className="jb-btn jb-btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save the answer"}
          </button>
        </div>
      ) : null}
    </form>
  );
}

/** Generator, fuel and service for the whole job, and for each month it runs late. */
function TempPowerCalc({ onUse }: { onUse: (amount: number, how: string) => void }) {
  const [v, setV] = useState({ months: 6, rental: 9800, gal: 180, price: 4.25, service: 1450, once: 21600, late: 0 });
  const monthly = v.rental + v.gal * v.price * 30.4 + v.service;
  const base = monthly * v.months + v.once;
  const late = monthly * v.late;
  const total = Math.round(base + late);
  const field = (k: keyof typeof v, label: string, step = 1) => (
    <div className="gc-field">
      <label htmlFor={`tp-${k}`}>{label}</label>
      <input
        id={`tp-${k}`}
        type="number"
        min={0}
        step={step}
        value={v[k]}
        onChange={(e) => setV({ ...v, [k]: Math.max(0, Number(e.target.value) || 0) })}
      />
    </div>
  );
  return (
    <div className="gc-calc">
      <p className="gc-small">
        <b>If the owner says no:</b> what a generator costs you for this job. Change any number.
      </p>
      <div className="gc-grid3">
        {field("months", "Months of temp power")}
        {field("rental", "Generator rental a month ($)")}
        {field("gal", "Diesel a day (gallons)")}
        {field("price", "Diesel price a gallon ($)", 0.05)}
        {field("service", "Service and refuel a month ($)")}
        {field("once", "Delivery, hookup and removal ($)")}
        {field("late", "Months late to plan for")}
      </div>
      <div className="gc-calcout">
        <div>
          <span>A month</span>
          <strong>{money(monthly)}</strong>
        </div>
        <div>
          <span>Whole job</span>
          <strong>{money(base)}</strong>
        </div>
        <div>
          <span>Each month late</span>
          <strong className="risk">{money(monthly)}</strong>
        </div>
      </div>
      <p className="gc-small gc-muted">
        A late finish that isn't your fault is a change order. Keep the monthly number with your bid so you can price it.
      </p>
      <div className="gc-actions">
        <button
          type="button"
          className="jb-btn"
          onClick={() =>
            onUse(
              total,
              `Generator ${v.months} months${v.late ? ` plus ${v.late} late` : ""}: ${money(monthly)} a month, ${money(v.once)} one-time`,
            )
          }
        >
          Carry {money(total)}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ board */

export function BoardView({
  items,
  moves,
  fresh,
  updatedAt,
  ask,
  onSave,
}: {
  items: GapCheckItem[];
  moves: Move[];
  fresh: Set<string>;
  updatedAt: number;
  ask: string;
  onSave: (g: GapCheckItem, input: AnswerInput | null) => Promise<void>;
}) {
  const live = items.filter((i) => columnOf(i) !== "dropped");
  const [open, setOpen] = useState<GapCheckItem | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const ago = Math.max(0, Math.round((now - updatedAt) / 1000));

  // FLIP: a card that changes column slides from where it was.
  const rects = useRef<Map<string, DOMRect>>(new Map());
  const boardRef = useRef<HTMLDivElement>(null);
  const layoutKey = live.map((i) => `${i.ref}:${columnOf(i)}`).join("|");
  useLayoutEffect(() => {
    const root = boardRef.current;
    if (!root) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, DOMRect>();
    root.querySelectorAll<HTMLElement>("[data-card]").forEach((el) => {
      const r = el.getBoundingClientRect();
      next.set(el.dataset.card!, r);
      const was = rects.current.get(el.dataset.card!);
      if (!was || reduce) return;
      const dx = was.left - r.left;
      const dy = was.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = "transform 450ms cubic-bezier(.2,.7,.2,1)";
        el.style.transform = "";
      });
    });
    rects.current = next;
  }, [layoutKey]);

  return (
    <section>
      <div className="gc-livebar">
        <span className="gc-livepill">
          <i aria-hidden="true" />
          Live with your Athena chat · {ago < 5 ? "up to date" : `checked ${ago}s ago`}
        </span>
        <CopyAsk ask={ask} label="Walk it in Athena chat" />
      </div>
      <div className="gc-live">
        <div className="gc-board" ref={boardRef}>
          {COLUMNS.map((c) => {
            const cards = live.filter((i) => columnOf(i) === c);
            return (
              <div key={c} className={`gc-col ${c}`}>
                <div className="gc-colhead">
                  <b>{COLUMN_LABEL[c]}</b>
                  <span>{cards.length}</span>
                </div>
                {cards.length ? (
                  cards.map((g) => (
                    <button
                      key={g.ref}
                      type="button"
                      data-card={g.ref}
                      className={`gc-bcard${stillHolds(g) ? " hold" : ""}${fresh.has(g.ref) ? " moved" : ""}`}
                      onClick={() => setOpen(g)}
                    >
                      <span className="r">{g.ref}</span>
                      <span className="t">{g.title}</span>
                      <span className="m">
                        {g.answer ? (
                          <span>{answerSummary(g.answer)}</span>
                        ) : exposureText(g) ? (
                          <span className="amt">{exposureText(g)} at risk</span>
                        ) : null}
                        {stillHolds(g) ? <span className="gc-badge risk">Holds the bid</span> : null}
                        {g.conditional && c === "to_answer" ? <span className="gc-badge risk">Owner may refuse</span> : null}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="gc-empty">Nothing here</p>
                )}
              </div>
            );
          })}
        </div>
        <aside className="gc-feed" aria-label="What moved">
          <div className="gc-feedhead">
            <b>What moved</b>
            <p>Answers you give Athena in chat move the cards here within a few seconds. Answers you give here, Athena reads back in chat.</p>
          </div>
          <ol className="gc-moves" aria-live="polite">
            {moves.length ? (
              moves.map((m) => (
                <li key={`${m.ref}-${m.at}`}>
                  <b>{m.ref}</b> {m.title}
                  <span>
                    {m.summary}
                    {m.from ? ` · ${m.from}` : ""}
                  </span>
                </li>
              ))
            ) : (
              <li className="gc-muted">Nothing has moved since you opened this page.</li>
            )}
          </ol>
        </aside>
      </div>
      {open ? (
        <MovePop
          gap={items.find((i) => i.ref === open.ref) ?? open}
          close={() => setOpen(null)}
          onSave={async (input) => {
            await onSave(open, input);
            setOpen(null);
          }}
        />
      ) : null}
    </section>
  );
}

function MovePop({
  gap,
  close,
  onSave,
}: {
  gap: GapCheckItem;
  close: () => void;
  onSave: (input: AnswerInput | null) => Promise<void>;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [close]);
  // Rendered on the body: the page shell keeps a transform after its entrance animation, and a fixed
  // overlay inside it would size to the whole page and put the dialog thousands of pixels down.
  return createPortal(
    <div className="gc gc-portal gc-pop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="gc-popcard" role="dialog" aria-modal="true" aria-labelledby="gc-pop-title">
        <p className="jh-eyebrow">{gap.ref}</p>
        <h3 id="gc-pop-title">{gap.title}</h3>
        <p className="gc-small">{gap.question ?? defaultQuestion(gap)}</p>
        {gap.condition_text ? <p className="gc-warn gc-small">“{gap.condition_text}” The owner can still refuse on load.</p> : null}
        <AnswerBox gap={gap} compact onSave={onSave} />
        <div className="gc-actions">
          {gap.answer ? (
            <button type="button" className="jb-btn gc-quiet" onClick={() => void onSave(null)}>
              Move back to To answer
            </button>
          ) : null}
          <span className="gc-spacer" />
          <button type="button" className="jb-btn gc-quiet" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ excel */

function cellText(c: XlsxCell): string {
  if (c === null || c === undefined) return "";
  if (typeof c !== "object") return String(c);
  if (c.f) return "ƒ";
  if (typeof c.v === "number") return c.s === "money" || c.s === "totalMoney" ? money(c.v) : String(c.v);
  return String(c.v ?? "");
}

export function ExcelView({ board }: { board: Board }) {
  const sheets = useMemo(() => gapCheckSheets(board), [board]);
  const [tab, setTab] = useState(0);
  const visible = sheets.filter((s) => !s.hidden);
  const sheet = visible[tab] ?? visible[0];
  const name = gapCheckFileName(board.jobNumber, board.jobName);
  const download = () => {
    const bytes = gapCheckXlsx(board);
    const blob = new Blob([new Uint8Array(bytes)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const shown = sheet.rows.slice(0, 1 + 60);
  return (
    <section className="gc-xl">
      <div className="gc-xlbar">
        <div className="gc-file">
          <span className="gc-xlicon">XLSX</span>
          <div>
            <b>{name}</b>
            <p className="gc-small gc-muted">
              The Answer column is a dropdown, and the totals and the verdict work out in Excel. It's a copy: answers
              you change in Excel stay in the file.
            </p>
          </div>
        </div>
        <button type="button" className="jb-btn jb-btn-primary" onClick={download}>
          Download Excel
        </button>
      </div>
      <div className="gc-sheetwrap">
        <table className="gc-sheet">
          <tbody>
            {shown.map((row, r) => (
              <tr key={r} className={r === 0 ? "hdr" : ""}>
                <td className="rn">{r + 1}</td>
                {row.map((c, i) => (
                  <td key={i} className={typeof c === "object" && c && (c.s === "money" || c.s === "totalMoney") ? "n" : ""}>
                    {cellText(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="gc-sheettabs" role="tablist" aria-label="Sheets">
        {visible.map((s, i) => (
          <button
            key={s.name}
            type="button"
            role="tab"
            className="gc-sheettab"
            aria-selected={i === tab}
            onClick={() => setTab(i)}
          >
            {s.name}
          </button>
        ))}
      </div>
    </section>
  );
}
