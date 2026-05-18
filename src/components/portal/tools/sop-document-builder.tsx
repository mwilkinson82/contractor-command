// SOP Document Builder — the actual authoring surface.
// Opens inline (replaces the right-panel content) when the user clicks
// "Build this SOP" on any backlog row. AI pre-fills via /api/sop-draft.
// User edits inline. Actions: Save to vault · Email · Print/PDF.

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  Save,
  Check,
  Mail,
  Printer,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { vault } from "@/lib/vault";
import type { SopDocument, SopStep } from "@/lib/tools/sop-draft";
import type {
  OptimizationPlay,
  SopBacklogItem,
  SopDepartment,
} from "@/lib/tools/sop-department";

type Props = {
  item: SopBacklogItem;
  department: SopDepartment;
  parentPlay: OptimizationPlay | null;
  ownerContext?: string;
  onBack: () => void;
};

export function SopDocumentBuilder({ item, department, parentPlay, ownerContext, onBack }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<SopDocument | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const triedDraft = useRef(false);

  useEffect(() => {
    if (triedDraft.current) return;
    triedDraft.current = true;
    void draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function draft() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setError("You need to be signed in to draft an SOP.");
        setLoading(false);
        return;
      }
      const res = await fetch("/api/sop-draft", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sopName: item.name,
          purpose: item.purpose,
          trigger: item.trigger,
          owner: item.owner,
          department,
          parentPlay: parentPlay ? { name: parentPlay.name, mechanism: parentPlay.mechanism } : undefined,
          context: ownerContext,
        }),
      });
      if (!res.ok) {
        setError((await res.text()) || `Draft failed (${res.status})`);
        setLoading(false);
        return;
      }
      const drafted = (await res.json()) as SopDocument;
      setDoc(drafted);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft failed.");
      setLoading(false);
    }
  }

  function update<K extends keyof SopDocument>(key: K, value: SopDocument[K]) {
    setDoc((d) => (d ? { ...d, [key]: value } : d));
    setSavedId(null);
  }

  function updateStep(idx: number, patch: Partial<SopStep>) {
    setDoc((d) => {
      if (!d) return d;
      const steps = d.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
      return { ...d, steps };
    });
    setSavedId(null);
  }
  function addStep() {
    setDoc((d) => {
      if (!d) return d;
      const next = d.steps.length + 1;
      return { ...d, steps: [...d.steps, { number: next, action: "", detail: "" }] };
    });
  }
  function removeStep(idx: number) {
    setDoc((d) => {
      if (!d) return d;
      const steps = d.steps
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, number: i + 1 }));
      return { ...d, steps };
    });
  }

  function updateListItem(key: "inputs" | "outputs" | "kpis" | "exceptions", idx: number, val: string) {
    setDoc((d) => {
      if (!d) return d;
      const arr = [...d[key]];
      arr[idx] = val;
      return { ...d, [key]: arr };
    });
    setSavedId(null);
  }
  function addListItem(key: "inputs" | "outputs" | "kpis" | "exceptions") {
    setDoc((d) => (d ? { ...d, [key]: [...d[key], ""] } : d));
  }
  function removeListItem(key: "inputs" | "outputs" | "kpis" | "exceptions", idx: number) {
    setDoc((d) => (d ? { ...d, [key]: d[key].filter((_, i) => i !== idx) } : d));
  }

  function saveToVault() {
    if (!doc) return;
    const saved = vault.save({
      kind: "command",
      source: "SOP Builder · Document",
      title: `SOP · ${doc.title}`,
      primaryFinding: doc.purpose,
      primaryConstraint: `${department} — ${doc.owner}`,
      financialConsequence: doc.kpis.join(" · "),
      missingSystem: doc.title,
      recommendedAction: `Roll out "${doc.title}" — owner: ${doc.owner}. Trigger: ${doc.trigger}.`,
      bringOneIssuePrompt: "Who on the team needs to be trained on this SOP first?",
      intensiveRecommended: false,
      inputs: {
        department,
        owner: doc.owner,
        stepCount: doc.steps.length,
        sopDocument: JSON.stringify(doc),
      },
    });
    setSavedId(saved.id);
  }

  function emailIt() {
    if (!doc) return;
    const subject = `SOP · ${doc.title}`;
    const body = renderSopAsText(doc);
    const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  }

  function printIt() {
    if (!doc) return;
    const w = window.open("", "_blank", "width=900,height=1000");
    if (!w) return;
    w.document.write(renderSopAsPrintableHtml(doc));
    w.document.close();
    w.focus();
    // give the new window a tick to paint before triggering print
    setTimeout(() => w.print(), 250);
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 reveal-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground/80 hover:bg-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to SOP stack
        </button>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          SOP Builder · Document
        </p>
      </div>

      {loading && (
        <div className="mt-6 flex items-center gap-3 rounded-md border border-dashed border-border bg-background/60 p-6">
          <Loader2 className="h-4 w-4 animate-spin text-foreground/70" />
          <p className="text-[13px] text-foreground/80">
            Drafting <span className="font-medium">{item.name}</span>…
          </p>
        </div>
      )}

      {error && !loading && (
        <div className="mt-6 rounded-md border border-signal/40 bg-signal/10 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">Draft failed</p>
          <p className="mt-1 text-[13px] text-foreground">{error}</p>
          <button
            type="button"
            onClick={() => { triedDraft.current = false; void draft(); }}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-cream hover:opacity-90"
          >
            <Sparkles className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}

      {doc && !loading && (
        <>
          <div className="mt-5 space-y-4">
            <div>
              <Label>Title</Label>
              <TextLine value={doc.title} onChange={(v) => update("title", v)} className="text-[18px]" serif />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Department</Label>
                <TextLine value={doc.department} onChange={(v) => update("department", v)} />
              </div>
              <div>
                <Label>Owner (seat)</Label>
                <TextLine value={doc.owner} onChange={(v) => update("owner", v)} />
              </div>
            </div>

            <Block label="Purpose" value={doc.purpose} onChange={(v) => update("purpose", v)} rows={2} />
            <Block label="Scope" value={doc.scope} onChange={(v) => update("scope", v)} rows={2} />
            <Block label="Trigger" value={doc.trigger} onChange={(v) => update("trigger", v)} rows={2} />

            <List
              label="Inputs"
              items={doc.inputs}
              onChange={(i, v) => updateListItem("inputs", i, v)}
              onAdd={() => addListItem("inputs")}
              onRemove={(i) => removeListItem("inputs", i)}
              placeholder="e.g. Signed contract, scope-of-work tab, Bid Recap PDF"
            />

            <div>
              <div className="flex items-center justify-between">
                <Label>Procedure</Label>
                <button
                  type="button"
                  onClick={addStep}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-foreground/70 hover:bg-muted"
                >
                  <Plus className="h-3 w-3" /> Add step
                </button>
              </div>
              <ol className="mt-2 space-y-2">
                {doc.steps.map((s, i) => (
                  <li key={i} className="rounded-md border border-border bg-background/60 p-3">
                    <div className="flex items-start gap-3">
                      <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-foreground/30 font-mono text-[10px] text-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <input
                          type="text"
                          value={s.action}
                          onChange={(e) => updateStep(i, { action: e.target.value })}
                          placeholder="Imperative action — e.g. Open the Pre-Con folder in SharePoint…"
                          className="w-full rounded-sm bg-transparent text-[13.5px] font-medium text-foreground outline-none focus:bg-background/80"
                        />
                        <textarea
                          value={s.detail ?? ""}
                          onChange={(e) => updateStep(i, { detail: e.target.value })}
                          placeholder="Optional — examples, thresholds, edge cases"
                          rows={2}
                          className="w-full resize-y rounded-sm bg-transparent text-[12.5px] leading-snug text-foreground/80 outline-none focus:bg-background/80"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeStep(i)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Remove step"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <List
              label="Outputs"
              items={doc.outputs}
              onChange={(i, v) => updateListItem("outputs", i, v)}
              onAdd={() => addListItem("outputs")}
              onRemove={(i) => removeListItem("outputs", i)}
              placeholder="e.g. Signed hand-off form, populated /02_Handoff folder"
            />

            <Block
              label="Definition of done"
              value={doc.definitionOfDone}
              onChange={(v) => update("definitionOfDone", v)}
              rows={2}
            />

            <List
              label="KPIs"
              items={doc.kpis}
              onChange={(i, v) => updateListItem("kpis", i, v)}
              onAdd={() => addListItem("kpis")}
              onRemove={(i) => removeListItem("kpis", i)}
              placeholder="e.g. Hand-off lead time < 3 days; zero scope-gap RFIs in first 30 days"
            />

            <List
              label="Exceptions / escalation"
              items={doc.exceptions}
              onChange={(i, v) => updateListItem("exceptions", i, v)}
              onAdd={() => addListItem("exceptions")}
              onRemove={(i) => removeListItem("exceptions", i)}
              placeholder="e.g. Missing Exhibit A → escalate to Estimator + Owner same day"
            />

            <div>
              <Label>Revision cadence</Label>
              <TextLine value={doc.revisionCadence} onChange={(v) => update("revisionCadence", v)} />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={saveToVault}
              disabled={!!savedId}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-70"
            >
              {savedId ? <Check className="h-3.5 w-3.5 text-signal-success" /> : <Save className="h-3.5 w-3.5" />}
              {savedId ? "Saved to vault" : "Save to vault"}
            </button>
            <button
              type="button"
              onClick={emailIt}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              <Mail className="h-3.5 w-3.5" /> Email to team
            </button>
            <button
              type="button"
              onClick={printIt}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              <Printer className="h-3.5 w-3.5" /> Print / PDF
            </button>
            <button
              type="button"
              onClick={() => { triedDraft.current = false; void draft(); }}
              className="ml-auto inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[12px] text-foreground/70 hover:bg-muted"
              title="Re-draft from scratch with AI (discards your edits)"
            >
              <Sparkles className="h-3.5 w-3.5" /> Re-draft
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------------------------- inputs ---------------------------- */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
      {children}
    </p>
  );
}

function TextLine({
  value,
  onChange,
  className,
  serif,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  serif?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={serif ? { fontFamily: "var(--font-serif)" } : undefined}
      className={`mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40 ${className ?? ""}`}
    />
  );
}

function Block({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="mt-1 w-full resize-y rounded-md border border-border bg-background p-2.5 text-[13px] leading-relaxed text-foreground outline-none focus:border-foreground/40"
      />
    </div>
  );
}

function List({
  label,
  items,
  onChange,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (i: number, v: string) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-foreground/70 hover:bg-muted"
        >
          <Plus className="h-3 w-3" /> Add
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground" />
            <input
              type="text"
              value={it}
              onChange={(e) => onChange(i, e.target.value)}
              placeholder={placeholder}
              className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-foreground/40"
            />
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------------------- export ---------------------------- */

function renderSopAsText(d: SopDocument): string {
  const lines: string[] = [];
  lines.push(`SOP — ${d.title}`);
  lines.push(`Department: ${d.department}`);
  lines.push(`Owner: ${d.owner}`);
  lines.push("");
  lines.push("PURPOSE");
  lines.push(d.purpose);
  lines.push("");
  lines.push("SCOPE");
  lines.push(d.scope);
  lines.push("");
  lines.push("TRIGGER");
  lines.push(d.trigger);
  lines.push("");
  lines.push("INPUTS");
  d.inputs.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("PROCEDURE");
  d.steps.forEach((s) => {
    lines.push(`${s.number}. ${s.action}`);
    if (s.detail?.trim()) lines.push(`   ${s.detail.trim()}`);
  });
  lines.push("");
  lines.push("OUTPUTS");
  d.outputs.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("DEFINITION OF DONE");
  lines.push(d.definitionOfDone);
  lines.push("");
  lines.push("KPIs");
  d.kpis.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push("EXCEPTIONS / ESCALATION");
  d.exceptions.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  lines.push(`Revision cadence: ${d.revisionCadence}`);
  return lines.join("\n");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderSopAsPrintableHtml(d: SopDocument): string {
  const li = (xs: string[]) => xs.map((x) => `<li>${esc(x)}</li>`).join("");
  const steps = d.steps
    .map(
      (s) =>
        `<li><div class="step-action">${esc(s.action)}</div>${
          s.detail?.trim() ? `<div class="step-detail">${esc(s.detail)}</div>` : ""
        }</li>`,
    )
    .join("");
  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>SOP — ${esc(d.title)}</title>
<style>
  @page { margin: 0.75in; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, "Times New Roman", serif; color: #1a1a1a; max-width: 7.5in; margin: 0 auto; padding: 0.5in 0; line-height: 1.45; font-size: 11pt; }
  h1 { font-size: 22pt; margin: 0 0 4pt; }
  .meta { color: #555; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 18pt; }
  h2 { font-size: 10pt; text-transform: uppercase; letter-spacing: 0.18em; color: #555; margin: 18pt 0 6pt; border-bottom: 1px solid #ccc; padding-bottom: 3pt; }
  p { margin: 0 0 6pt; }
  ul, ol { margin: 4pt 0 8pt 22pt; padding: 0; }
  li { margin-bottom: 4pt; }
  ol.procedure { list-style: decimal; }
  ol.procedure .step-action { font-weight: 600; }
  ol.procedure .step-detail { color: #444; font-size: 10.5pt; margin-top: 2pt; }
  .footer { margin-top: 24pt; padding-top: 10pt; border-top: 1px solid #ccc; color: #666; font-size: 9pt; }
</style>
</head>
<body>
  <h1>${esc(d.title)}</h1>
  <div class="meta">${esc(d.department)} &middot; Owner: ${esc(d.owner)}</div>

  <h2>Purpose</h2>
  <p>${esc(d.purpose)}</p>

  <h2>Scope</h2>
  <p>${esc(d.scope)}</p>

  <h2>Trigger</h2>
  <p>${esc(d.trigger)}</p>

  <h2>Inputs</h2>
  <ul>${li(d.inputs)}</ul>

  <h2>Procedure</h2>
  <ol class="procedure">${steps}</ol>

  <h2>Outputs</h2>
  <ul>${li(d.outputs)}</ul>

  <h2>Definition of done</h2>
  <p>${esc(d.definitionOfDone)}</p>

  <h2>KPIs</h2>
  <ul>${li(d.kpis)}</ul>

  <h2>Exceptions / escalation</h2>
  <ul>${li(d.exceptions)}</ul>

  <div class="footer">Revision cadence: ${esc(d.revisionCadence)}</div>
</body></html>`;
}
