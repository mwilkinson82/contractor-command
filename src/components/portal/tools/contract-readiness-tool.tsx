// Contract Readiness Scan — full-screen drawer tool.
// Owner pastes contract text → server route hits Lovable AI Gateway with
// a structured-output schema → finding card with vault + calls terminus.

import { useMemo, useRef, useState } from "react";
import { Play, RotateCcw, Save, Check, AlertTriangle, ShieldCheck, MessageSquare, FileText, Upload, Loader2, Copy } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  CONTRACT_SCAN_STEPS,
  buildScanTicker,
  type ContractScanResult,
  type DimensionScore,
  type MissingClause,
} from "@/lib/tools/contract-readiness";
import { extractTextFromFile } from "@/lib/tools/extract-text";
import { ComputeTheater } from "@/components/portal/compute-theater";
import { vault } from "@/lib/vault";
import { supabase } from "@/integrations/supabase/client";

type Stage = "idle" | "running" | "ready" | "error";

const DIM_LABEL: Record<DimensionScore["dimension"], string> = {
  cash: "Cash",
  schedule: "Schedule",
  scope: "Scope",
  margin: "Margin",
};

export function ContractReadinessTool({ onClose }: { onClose: () => void }) {
  const [contractText, setContractText] = useState("");
  const [projectContext, setProjectContext] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<ContractScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const pendingResult = useRef<ContractScanResult | null>(null);
  const theaterDone = useRef(false);
  const fetchDone = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedName, setUploadedName] = useState<string | null>(null);

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file
    if (!f) return;
    setUploading(true);
    setError(null);
    try {
      const text = await extractTextFromFile(f);
      if (!text.trim()) {
        setError("Couldn't pull any text out of that file. Try a different export or paste the contract directly.");
      } else {
        setContractText(text);
        setUploadedName(f.name);
        if (stage === "ready" || stage === "error") setStage("idle");
        setSavedId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file.");
    } finally {
      setUploading(false);
    }
  }

  const ticker = useMemo(() => buildScanTicker(contractText.length), [contractText.length]);

  const canRun = contractText.trim().length >= 200 && stage !== "running";

  async function run() {
    if (!canRun) return;
    setStage("running");
    setResult(null);
    setError(null);
    setSavedId(null);
    pendingResult.current = null;
    theaterDone.current = false;
    fetchDone.current = false;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError("You need to be signed in to run this scan.");
        setStage("error");
        return;
      }

      const res = await fetch("/api/contract-scan", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ contractText, projectContext }),
      });
      if (!res.ok) {
        const msg = await res.text();
        setError(msg || `Scan failed (${res.status})`);
        setStage("error");
        return;
      }
      const data = (await res.json()) as ContractScanResult;
      pendingResult.current = data;
      fetchDone.current = true;
      maybeReveal();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
      setStage("error");
    }
  }

  function maybeReveal() {
    if (theaterDone.current && fetchDone.current && pendingResult.current) {
      setResult(pendingResult.current);
      setStage("ready");
    }
  }

  function reset() {
    setContractText("");
    setProjectContext("");
    setStage("idle");
    setResult(null);
    setError(null);
    setSavedId(null);
    pendingResult.current = null;
    theaterDone.current = false;
    fetchDone.current = false;
  }

  function onTheaterDone() {
    theaterDone.current = true;
    maybeReveal();
  }

  function savePacket() {
    if (!result) return;
    const saved = vault.save({
      kind: "command",
      source: "Contract Readiness Scan",
      title: result.headline,
      primaryFinding: result.topRisk,
      primaryConstraint: weakestDimensionLabel(result),
      financialConsequence: result.financialConsequence,
      missingSystem:
        result.missingClauses.length > 0
          ? `Missing clauses: ${result.missingClauses.map((c) => c.name).join("; ")}`
          : "Contract review checklist tied to cash, schedule, scope, margin.",
      recommendedAction: result.recommendedAction,
      bringOneIssuePrompt:
        result.status === "do-not-sign"
          ? "What's the single clause you'd refuse to sign without?"
          : "Which of these clauses are you actually willing to push back on?",
      intensiveRecommended: result.status === "do-not-sign",
      inputs: {
        overallScore: result.overallScore,
        status: result.status,
        contractChars: contractText.length,
      },
    });
    setSavedId(saved.id);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            Command Tool · Deliver better projects
          </p>
          <h1
            className="mt-1 font-display text-[1.8rem] leading-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Contract Readiness Scan
          </h1>
          <p className="mt-1 max-w-xl text-[13px] text-muted-foreground">
            Paste the contract. ALP reads it across cash, schedule, scope, and margin —
            flags weak clauses and missing protections before you sign.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground/70 hover:bg-muted"
        >
          Close
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(360px,460px)_1fr] lg:items-start">
        {/* Inputs */}
        <section className="rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-6">
          <p className="label-mono">Inputs</p>

          {/* Upload */}
          <div className="mt-4 rounded-md border border-dashed border-border bg-background/40 p-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              onChange={onFileChosen}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
            >
              {uploading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading file…</>
              ) : (
                <><Upload className="h-3.5 w-3.5" /> Upload contract (PDF or text)</>
              )}
            </button>
            {uploadedName && !uploading ? (
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                Loaded: <span className="text-foreground">{uploadedName}</span> · you can edit below.
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-muted-foreground">
                PDF, .txt, or .md. Stays in your browser — only the extracted text is sent.
              </p>
            )}
          </div>

          <label className="mt-4 block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Contract text (paste or edit)
            </span>
            <textarea
              value={contractText}
              onChange={(e) => {
                setContractText(e.target.value);
                if (stage === "ready" || stage === "error") setStage("idle");
                setSavedId(null);
              }}
              placeholder="Paste the full contract or the sections you want pressure-tested. ~200 characters minimum."
              className="mt-1.5 h-[260px] w-full resize-y rounded-md border border-border bg-background p-3 text-[13px] leading-relaxed text-foreground outline-none focus:border-foreground/40"
            />
            <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
              {contractText.length.toLocaleString()} chars
              {contractText.length > 0 && contractText.trim().length < 200
                ? " · need ~200 to scan"
                : ""}
            </span>
          </label>

          <label className="mt-4 block">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Project context (optional)
            </span>
            <textarea
              value={projectContext}
              onChange={(e) => setProjectContext(e.target.value)}
              placeholder="e.g. $1.2M custom home, GMP, 9 month schedule, new client."
              className="mt-1.5 h-[90px] w-full resize-y rounded-md border border-border bg-background p-3 text-[13px] leading-relaxed text-foreground outline-none focus:border-foreground/40"
            />
          </label>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={!canRun}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5" />
              {stage === "ready" ? "Re-scan" : "Run scan"}
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12px] text-foreground/70 hover:bg-muted"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          </div>

          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Nothing's stored on the server — the contract text leaves only to score, not to keep.
          </p>
        </section>

        {/* Right: theater + result */}
        <div className="flex min-w-0 flex-col gap-6">
          {stage === "idle" && (
            <div className="rounded-2xl border border-dashed border-border bg-background/40 p-10 text-center">
              <FileText className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                Awaiting contract
              </p>
              <p
                className="mt-2 text-[13px] text-muted-foreground"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                Paste the contract on the left, then run the scan to see where you're exposed.
              </p>
            </div>
          )}

          {stage === "error" && (
            <div className="rounded-2xl border border-signal/40 bg-signal/10 p-6">
              <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">
                Scan failed
              </p>
              <p className="mt-2 text-[14px] text-foreground">{error}</p>
            </div>
          )}

          {(stage === "running" || stage === "ready") && (
            <ComputeTheater
              steps={CONTRACT_SCAN_STEPS}
              ticker={ticker}
              running={stage === "running"}
              onDone={onTheaterDone}
              subtitle="Contract Readiness Scan"
              fileLabel="tools/contract-readiness.scan"
            />
          )}

          {stage === "ready" && result && (
            <section className="rounded-2xl border border-border bg-card p-6 reveal-up">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                    Finding
                  </p>
                  <h2
                    className="mt-1 font-display text-[1.5rem] leading-tight"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {result.headline}
                  </h2>
                </div>
                <StatusPill status={result.status} score={result.overallScore} />
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-4">
                {result.dimensions.map((d) => (
                  <DimensionCard key={d.dimension} d={d} />
                ))}
              </div>

              <div className="mt-5 space-y-4 text-[14px] leading-relaxed text-foreground/85">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Top risk
                  </p>
                  <p className="mt-1" style={{ fontFamily: "var(--font-serif)" }}>
                    {result.topRisk}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Financial consequence
                  </p>
                  <p className="mt-1" style={{ fontFamily: "var(--font-serif)" }}>
                    {result.financialConsequence}
                  </p>
                </div>
                {result.missingClauses.length > 0 && (
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                      Missing clauses · sample language + how to ask
                    </p>
                    <div className="mt-2 space-y-3">
                      {result.missingClauses.map((c, i) => (
                        <MissingClauseCard key={i} clause={c} />
                      ))}
                    </div>
                  </div>
                )}
                <div className="rounded-md border border-border bg-background/60 p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                    Recommended next move
                  </p>
                  <p
                    className="mt-1.5 text-[14px] text-foreground"
                    style={{ fontFamily: "var(--font-serif)" }}
                  >
                    {result.recommendedAction}
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={savePacket}
                  disabled={!!savedId}
                  className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-70"
                >
                  {savedId ? <Check className="h-3.5 w-3.5 text-signal-success" /> : <Save className="h-3.5 w-3.5" />}
                  {savedId ? "Saved to vault" : "Save to vault"}
                </button>
                <Link
                  to="/calls"
                  hash="submit-topic"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Bring to next call
                </Link>
                <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Terminus · Vault / Calls
                </span>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function weakestDimensionLabel(r: ContractScanResult): string {
  const weakest = [...r.dimensions].sort((a, b) => a.score - b.score)[0];
  if (!weakest) return "Contract protection";
  return `${DIM_LABEL[weakest.dimension]} — ${weakest.status}`;
}

function DimensionCard({ d }: { d: DimensionScore }) {
  const tone =
    d.status === "strong"
      ? "border-signal-success/40 bg-signal-success/5 text-signal-success"
      : d.status === "weak"
        ? "border-gold/40 bg-gold/5 text-gold"
        : "border-signal/40 bg-signal/5 text-signal";
  return (
    <div className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          {DIM_LABEL[d.dimension]}
        </p>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}>
          {d.status}
        </span>
      </div>
      <p className="mt-2 font-display text-[1.6rem] leading-none text-foreground">
        {d.score}
        <span className="text-[0.9rem] text-muted-foreground">/10</span>
      </p>
      <p className="mt-2 text-[13.5px] leading-relaxed text-foreground/85">{d.finding}</p>
      <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">
        <span className="font-mono uppercase tracking-[0.18em]">Fix:</span> {d.clauseToAddOrFix}
      </p>
    </div>
  );
}

function StatusPill({ status, score }: { status: ContractScanResult["status"]; score: number }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-success/40 bg-signal-success/10 px-3 py-1 text-[11px] font-medium text-signal-success">
        <ShieldCheck className="h-3 w-3" /> Ready · {score}/100
      </span>
    );
  }
  if (status === "tighten") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[11px] font-medium text-gold">
        <AlertTriangle className="h-3 w-3" /> Tighten · {score}/100
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-signal/40 bg-signal/10 px-3 py-1 text-[11px] font-medium text-signal">
      <AlertTriangle className="h-3 w-3" /> Do not sign · {score}/100
    </span>
  );
}

function MissingClauseCard({ clause }: { clause: MissingClause }) {
  const [copied, setCopied] = useState<"lang" | "talk" | null>(null);
  async function copy(kind: "lang" | "talk", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
    } catch {
      /* no-op */
    }
  }
  const hasLang = clause.sampleLanguage.trim().length > 0;
  const hasTalk = clause.talkingPoints.length > 0;
  return (
    <div className="rounded-md border border-border bg-background/60 p-4">
      <p className="text-[15px] font-medium leading-snug text-foreground" style={{ fontFamily: "var(--font-serif)" }}>
        {clause.name}
      </p>
      {clause.whyItMatters && (
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
          {clause.whyItMatters}
        </p>
      )}

      {hasLang && (
        <div className="mt-3 rounded border border-border bg-background p-2.5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted-foreground">
              Sample clause language
            </p>
            <button
              type="button"
              onClick={() => copy("lang", clause.sampleLanguage)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-foreground/70 hover:bg-muted"
            >
              {copied === "lang" ? <Check className="h-3 w-3 text-signal-success" /> : <Copy className="h-3 w-3" />}
              {copied === "lang" ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground/90">
            {clause.sampleLanguage}
          </p>
        </div>
      )}

      {hasTalk && (
        <div className="mt-2.5 rounded border border-border bg-background p-2.5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted-foreground">
              How to ask for it
            </p>
            <button
              type="button"
              onClick={() => copy("talk", clause.talkingPoints.map((t) => `• ${t}`).join("\n"))}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-foreground/70 hover:bg-muted"
            >
              {copied === "talk" ? <Check className="h-3 w-3 text-signal-success" /> : <Copy className="h-3 w-3" />}
              {copied === "talk" ? "Copied" : "Copy"}
            </button>
          </div>
          <ul className="mt-1.5 list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-foreground/90">
            {clause.talkingPoints.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
        Starting point only · not legal advice
      </p>
    </div>
  );
}
