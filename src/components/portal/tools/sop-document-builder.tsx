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
  Download,
  Sparkles,
  Send,
  X,
} from "lucide-react";
import { sendTransactionalEmail } from "@/lib/email/send";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { mintAosSopImportToken } from "@/lib/aos.functions";
import { vault } from "@/lib/vault";
import type { SopDocument, SopStep } from "@/lib/tools/sop-draft";
import type jsPDF from "jspdf";
import type { OptimizationPlay, SopBacklogItem, SopDepartment } from "@/lib/tools/sop-department";

type Props = {
  item: SopBacklogItem;
  department: SopDepartment | string;
  parentPlay: OptimizationPlay | null;
  ownerContext?: string;
  onBack: () => void;
  /** When provided, skip the AI draft fetch and edit this doc directly. */
  initialDoc?: SopDocument;
  /** When provided, "Save to vault" updates this existing packet instead of creating a new one. */
  existingPacketId?: string;
};

export function SopDocumentBuilder({
  item,
  department,
  parentPlay,
  ownerContext,
  onBack,
  initialDoc,
  existingPacketId,
}: Props) {
  const isEditMode = !!initialDoc;
  const [loading, setLoading] = useState(!isEditMode);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<SopDocument | null>(initialDoc ?? null);
  const [savedId, setSavedId] = useState<string | null>(existingPacketId ?? null);
  const triedDraft = useRef(isEditMode);

  // AOS Knowledge Hub hand-off
  const mintAosImport = useServerFn(mintAosSopImportToken);
  const [aosSending, setAosSending] = useState(false);
  const [aosSentAt, setAosSentAt] = useState<number | null>(null);
  const [aosError, setAosError] = useState<string | null>(null);

  async function sendToAos() {
    if (!doc) return;
    setAosSending(true);
    setAosError(null);
    try {
      const res = await mintAosImport({
        data: {
          sop: doc as unknown as Record<string, unknown>,
          defaults: { category: doc.department, owner: doc.owner },
        },
      });
      if (!res.ok) {
        setAosError(res.error);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
      setAosSentAt(Date.now());
    } catch (e) {
      setAosError(e instanceof Error ? e.message : "Hand-off failed.");
    } finally {
      setAosSending(false);
    }
  }

  // localStorage key for persisting the in-progress SOP draft across navigations.
  const storageKey = `sop-doc:${department}:${item.name}`;

  useEffect(() => {
    if (triedDraft.current) return;
    triedDraft.current = true;
    // Try restoring a saved draft first; only call the AI if there isn't one.
    try {
      if (typeof window !== "undefined") {
        const cached = window.localStorage.getItem(storageKey);
        if (cached) {
          const parsed = JSON.parse(cached) as SopDocument;
          setDoc(parsed);
          setLoading(false);
          return;
        }
      }
    } catch {
      // fall through to draft
    }
    void draft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist doc edits so navigating away doesn't lose the work.
  useEffect(() => {
    if (!doc) return;
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, JSON.stringify(doc));
      }
    } catch {
      // ignore quota / serialization errors
    }
  }, [doc, storageKey]);

  async function draft() {
    setLoading(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
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
          parentPlay: parentPlay
            ? { name: parentPlay.name, mechanism: parentPlay.mechanism }
            : undefined,
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
      const steps = d.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, number: i + 1 }));
      return { ...d, steps };
    });
  }

  function updateListItem(
    key: "inputs" | "outputs" | "kpis" | "exceptions",
    idx: number,
    val: string,
  ) {
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

  // Tracks the vault packet id this builder is bound to. Seeded from the
  // edit-mode prop and updated after the first save in create-mode so
  // subsequent saves update the same packet instead of creating duplicates.
  const packetIdRef = useRef<string | null>(existingPacketId ?? null);

  function saveToVault() {
    if (!doc) return;
    const payload = {
      title: `SOP · ${doc.title}`,
      primaryFinding: doc.purpose,
      primaryConstraint: `${department} — ${doc.owner}`,
      financialConsequence: doc.kpis.join(" · "),
      missingSystem: doc.title,
      recommendedAction: `Roll out "${doc.title}" — owner: ${doc.owner}. Trigger: ${doc.trigger}.`,
      bringOneIssuePrompt: "Who on the team needs to be trained on this SOP first?",
      intensiveRecommended: false,
      inputs: {
        department: String(department),
        owner: doc.owner,
        stepCount: doc.steps.length,
        sopDocument: JSON.stringify(doc),
      },
    };
    if (packetIdRef.current) {
      const updated = vault.update(packetIdRef.current, payload);
      if (updated) {
        setSavedId(updated.id);
        return;
      }
      // Packet vanished (e.g. deleted in another tab) — fall through to create.
      packetIdRef.current = null;
    }
    const saved = vault.save({
      kind: "command",
      source: "SOP Builder · Document",
      ...payload,
    });
    packetIdRef.current = saved.id;
    setSavedId(saved.id);
  }

  // Email send state
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const emailPanelRef = useRef<HTMLDivElement | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null);
  const [emailNote, setEmailNote] = useState("");

  async function sendEmail() {
    if (!doc) return;
    const recipient = emailTo.trim();
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailSending(true);
    setEmailError(null);
    try {
      await sendTransactionalEmail({
        templateName: "sop-document",
        recipientEmail: recipient,
        idempotencyKey: `sop-${savedId ?? doc.title}-${recipient}-${Date.now()}`,
        templateData: {
          title: doc.title,
          department: doc.department,
          owner: doc.owner,
          purpose: doc.purpose,
          scope: doc.scope,
          trigger: doc.trigger,
          inputs: doc.inputs,
          steps: doc.steps,
          outputs: doc.outputs,
          definitionOfDone: doc.definitionOfDone,
          kpis: doc.kpis,
          exceptions: doc.exceptions,
          revisionCadence: doc.revisionCadence,
          note: emailNote.trim() || undefined,
        },
      });
      setEmailSentTo(recipient);
      setEmailOpen(false);
      setEmailTo("");
      setEmailNote("");
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setEmailSending(false);
    }
  }

  async function downloadPdf() {
    if (!doc) return;
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "pt", format: "letter" });
    renderSopToPdf(pdf, doc);
    const safe =
      doc.title
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "sop";
    pdf.save(`${safe}.pdf`);
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
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">
            Draft failed
          </p>
          <p className="mt-1 text-[13px] text-foreground">{error}</p>
          <button
            type="button"
            onClick={() => {
              triedDraft.current = false;
              void draft();
            }}
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
              <TextLine
                value={doc.title}
                onChange={(v) => update("title", v)}
                className="text-[18px]"
                serif
              />
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

            <Block
              label="Purpose"
              value={doc.purpose}
              onChange={(v) => update("purpose", v)}
              rows={2}
            />
            <Block label="Scope" value={doc.scope} onChange={(v) => update("scope", v)} rows={2} />
            <Block
              label="Trigger"
              value={doc.trigger}
              onChange={(v) => update("trigger", v)}
              rows={2}
            />

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
                          style={{ fontFamily: "var(--font-sans)" }}
                          className="w-full rounded-sm bg-transparent px-1 text-[14px] font-medium text-foreground outline-none focus:bg-background/80"
                        />
                        <textarea
                          value={s.detail ?? ""}
                          onChange={(e) => updateStep(i, { detail: e.target.value })}
                          placeholder="Optional — examples, thresholds, edge cases"
                          rows={2}
                          style={{ fontFamily: "var(--font-sans)" }}
                          className="w-full resize-y rounded-sm bg-transparent px-1 text-[13px] leading-snug text-foreground/80 outline-none focus:bg-background/80"
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
              <TextLine
                value={doc.revisionCadence}
                onChange={(v) => update("revisionCadence", v)}
              />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={saveToVault}
              disabled={!!savedId}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-70"
            >
              {savedId ? (
                <Check className="h-3.5 w-3.5 text-signal-success" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {savedId
                ? packetIdRef.current && isEditMode
                  ? "Changes saved"
                  : "Saved to vault"
                : packetIdRef.current
                  ? "Save changes"
                  : "Save to vault"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEmailOpen((v) => !v);
                setEmailError(null);
                requestAnimationFrame(() => {
                  emailPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                });
              }}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              <Mail className="h-3.5 w-3.5" />
              {emailSentTo ? `Sent to ${emailSentTo}` : "Email to team"}
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-[13px] font-medium text-foreground hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" /> Download PDF
            </button>
            {/* Send to AOS Knowledge Hub hidden — SSO hand-off temporarily disabled. */}
            {!isEditMode && (
              <button
                type="button"
                onClick={() => {
                  try {
                    if (typeof window !== "undefined") window.localStorage.removeItem(storageKey);
                  } catch {
                    // Ignore storage failures; re-drafting can still continue.
                  }
                  triedDraft.current = false;
                  void draft();
                }}
                className="ml-auto inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[12px] text-foreground/70 hover:bg-muted"
                title="Re-draft from scratch with AI (discards your edits)"
              >
                <Sparkles className="h-3.5 w-3.5" /> Re-draft
              </button>
            )}
          </div>

          {emailOpen && (
            <div
              ref={emailPanelRef}
              className="mt-3 rounded-md border border-border bg-background/60 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Send this SOP from AOS
                </p>
                <button
                  type="button"
                  onClick={() => setEmailOpen(false)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-3 grid gap-3">
                <div>
                  <Label>Recipient email</Label>
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => {
                      setEmailTo(e.target.value);
                      setEmailError(null);
                    }}
                    placeholder="seat@yourcompany.com"
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground/40"
                  />
                </div>
                <div>
                  <Label>Note (optional)</Label>
                  <textarea
                    value={emailNote}
                    onChange={(e) => setEmailNote(e.target.value)}
                    rows={2}
                    placeholder="e.g. Please review by Friday and flag any steps that don't match how we actually run this."
                    className="mt-1 w-full resize-y rounded-md border border-border bg-background p-2.5 text-[13px] leading-relaxed text-foreground outline-none focus:border-foreground/40"
                  />
                </div>
                {emailError && <p className="text-[12px] text-signal">{emailError}</p>}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={sendEmail}
                    disabled={emailSending}
                    className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-70"
                  >
                    {emailSending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    {emailSending ? "Sending…" : "Send SOP"}
                  </button>
                  <p className="text-[11px] text-muted-foreground">
                    From notify.mail.alpcontractorcircle.com
                  </p>
                </div>
              </div>
            </div>
          )}
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
      style={{ fontFamily: serif ? "var(--font-serif)" : "var(--font-sans)" }}
      className={`mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none focus:border-foreground/40 ${className ?? ""}`}
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
        style={{ fontFamily: "var(--font-sans)" }}
        className="mt-1 w-full resize-y rounded-md border border-border bg-background p-2.5 text-[14px] leading-relaxed text-foreground outline-none focus:border-foreground/40"
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
              style={{ fontFamily: "var(--font-sans)" }}
              className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[14px] text-foreground outline-none focus:border-foreground/40"
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

/* ----------------------------- PDF render -----------------------------
 * AOS "ALP Engine" palette, banded layout. jsPDF uses RGB so the AOS
 * oklch tokens are baked to their reference hex equivalents here.
 *
 *   ink         #1A1918  body text + step badge fill
 *   ink-muted   #6E695F  metadata + body-secondary
 *   signal      #E4573D  signal orange-red — accent only
 *   cream       #F4F3EF  page bg + hero band
 *   paper-deep  #ECEBE5  panel fill
 *   card        #FCFBF9  step card fill
 *   border      #D1CFC7  warm border / dividers
 *   divider     #E2DED6  hairline
 */

const INK: [number, number, number] = [26, 25, 24];
const INK_MUTED: [number, number, number] = [110, 105, 95];
const INK_FAINT: [number, number, number] = [159, 153, 141];
const SIGNAL: [number, number, number] = [228, 87, 61];
const CREAM: [number, number, number] = [244, 243, 239];
const PAPER_DEEP: [number, number, number] = [236, 235, 229];
const CARD: [number, number, number] = [252, 251, 249];
const BORDER: [number, number, number] = [209, 207, 199];
const DIVIDER: [number, number, number] = [226, 222, 214];

function renderSopToPdf(pdf: jsPDF, d: SopDocument): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  const footerReserve = 36;
  const contentBottom = pageH - footerReserve;
  let y = margin;

  const safe = (text: string) =>
    text
      .replace(/[→⟶➜]/g, "->")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/\u00a0/g, " ");

  const ensure = (need: number) => {
    if (y + need > contentBottom) {
      pdf.addPage();
      y = margin;
    }
  };

  // Wrap text → array of lines, computing height. Uses a temporary font
  // state (caller is expected to reset font before drawing).
  const wrapLines = (
    text: string,
    width: number,
    size: number,
    family: "times" | "helvetica",
    style: "normal" | "bold" | "italic" = "normal",
  ) => {
    pdf.setCharSpace(0);
    pdf.setFont(family, style);
    pdf.setFontSize(size);
    return pdf.splitTextToSize(safe(text), width) as string[];
  };

  // CRITICAL: jsPDF emulates bold by *stroking* glyph outlines with the
  // current lineWidth. Any prior setLineWidth() (e.g. card borders) will
  // bleed into text rendering and corrupt character metrics. Always reset.
  const resetTextState = () => {
    pdf.setCharSpace(0);
    pdf.setLineWidth(0);
  };

  const drawLines = (
    lines: string[],
    x: number,
    startY: number,
    size: number,
    family: "times" | "helvetica",
    style: "normal" | "bold" | "italic",
    color: [number, number, number],
    lineHeight = 1.4,
  ) => {
    resetTextState();
    pdf.setFont(family, style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lh = size * lineHeight;
    lines.forEach((line, i) => {
      resetTextState();
      pdf.text(line, x, startY + i * lh + size);
    });
    return lines.length * lh;
  };

  const drawCard = (
    x: number,
    cardY: number,
    w: number,
    h: number,
    fill: [number, number, number] = CARD,
    border: [number, number, number] = BORDER,
    radius = 6,
  ) => {
    pdf.setFillColor(...fill);
    pdf.setDrawColor(...border);
    pdf.setLineWidth(0.6);
    pdf.roundedRect(x, cardY, w, h, radius, radius, "FD");
    pdf.setLineWidth(0); // prevent bleed into subsequent text
  };

  // ─── small-caps label (no charSpace tracking; no stroke width)
  const drawLabel = (text: string, x: number, baselineY: number, color = INK_FAINT) => {
    resetTextState();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...color);
    pdf.text(safe(text).toUpperCase(), x, baselineY);
  };

  // ============================ 1. HERO ============================
  // signal-orange rule at top
  pdf.setFillColor(...SIGNAL);
  pdf.rect(0, 0, pageW, 3, "F");

  // hero band (cream tint full-bleed top)
  const heroH = 132;
  pdf.setFillColor(...CREAM);
  pdf.rect(0, 3, pageW, heroH, "F");
  pdf.setDrawColor(...DIVIDER);
  pdf.setLineWidth(0.5);
  pdf.line(0, 3 + heroH, pageW, 3 + heroH);

  y = margin;
  drawLabel("Standard Operating Procedure", margin, y + 8, SIGNAL);
  y += 20;

  // Title — Times for Instrument-Serif feel
  const titleLines = wrapLines(d.title, contentW, 24, "times", "normal");
  const titleH = drawLines(titleLines, margin, y - 24 * 0.2, 24, "times", "normal", INK, 1.15);
  y += titleH;

  // Metadata row
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...INK_MUTED);
  pdf.text(
    safe(`${d.department}  ·  Owner: ${d.owner}  ·  v1  ·  Generated ${today}`),
    margin,
    y + 6,
  );

  // jump past hero band
  y = 3 + heroH + 22;

  // ============================ 2. SUMMARY PANEL ============================
  const summaryItems: Array<[string, string]> = [
    ["Purpose", d.purpose],
    ["Scope", d.scope],
    ["Trigger", d.trigger],
  ];
  const summaryPadX = 18;
  const summaryPadY = 16;
  const summaryInnerW = contentW - summaryPadX * 2;

  // measure
  let summaryH = summaryPadY;
  for (const [, value] of summaryItems) {
    summaryH += 11; // label
    const vLines = wrapLines(value, summaryInnerW, 10.5, "helvetica", "normal");
    summaryH += vLines.length * 10.5 * 1.5 + 12;
  }
  summaryH += summaryPadY - 12;

  ensure(summaryH + 20);
  drawCard(margin, y, contentW, summaryH, PAPER_DEEP, BORDER, 8);
  let sy = y + summaryPadY;
  for (const [label, value] of summaryItems) {
    drawLabel(label, margin + summaryPadX, sy);
    sy += 11;
    const vLines = wrapLines(value, summaryInnerW, 10.5, "helvetica", "normal");
    drawLines(vLines, margin + summaryPadX, sy - 10.5, 10.5, "helvetica", "normal", INK, 1.5);
    sy += vLines.length * 10.5 * 1.5 + 12;
  }
  y += summaryH + 20;

  // ============================ 3. INPUTS / OUTPUTS (2-col) ============================
  const twoColGap = 14;
  const colW = (contentW - twoColGap) / 2;
  const colPadX = 14;
  const colPadY = 14;
  const colInnerW = colW - colPadX * 2;

  const bulletHeight = (items: string[]) => {
    let h = colPadY + 11 + 8; // label + gap
    for (const it of items) {
      const lines = wrapLines(`•  ${it}`, colInnerW - 6, 10, "helvetica", "normal");
      h += lines.length * 10 * 1.45 + 4;
    }
    return h + colPadY - 4;
  };

  const inputsH = bulletHeight(d.inputs);
  const outputsH = bulletHeight(d.outputs);
  const ioH = Math.max(inputsH, outputsH);
  ensure(ioH + 18);

  const drawBulletCard = (xPos: number, label: string, items: string[], cardH: number) => {
    drawCard(xPos, y, colW, cardH, CARD, BORDER, 8);
    let cy = y + colPadY;
    drawLabel(label, xPos + colPadX, cy);
    cy += 14;
    for (const it of items) {
      const lines = wrapLines(`•  ${it}`, colInnerW - 6, 10, "helvetica", "normal");
      drawLines(lines, xPos + colPadX, cy - 10, 10, "helvetica", "normal", INK, 1.45);
      cy += lines.length * 10 * 1.45 + 4;
    }
  };
  drawBulletCard(margin, "Inputs", d.inputs, ioH);
  drawBulletCard(margin + colW + twoColGap, "Outputs", d.outputs, ioH);
  y += ioH + 22;

  // ============================ 4. PROCEDURE ============================
  ensure(28);
  pdf.setFont("times", "normal");
  pdf.setFontSize(16);
  pdf.setTextColor(...INK);
  pdf.text(safe("Procedure"), margin, y + 14);
  y += 22;

  const stepPadX = 14;
  const stepPadY = 14;
  const badgeSize = 28;
  const stepGap = 10;
  const stepTextX = margin + stepPadX + badgeSize + 12;
  const stepTextW = contentW - stepPadX * 2 - badgeSize - 12;

  for (const s of d.steps) {
    const actionLines = wrapLines(s.action, stepTextW, 11, "helvetica", "bold");
    let stepH = stepPadY + actionLines.length * 11 * 1.3;
    let detailLines: string[] = [];
    if (s.detail?.trim()) {
      detailLines = wrapLines(s.detail.trim(), stepTextW, 9.5, "helvetica", "normal");
      stepH += 4 + detailLines.length * 9.5 * 1.5;
    }
    stepH += stepPadY;
    // minimum height so badge has room
    stepH = Math.max(stepH, badgeSize + stepPadY * 2);

    ensure(stepH + stepGap);
    // card
    drawCard(margin, y, contentW, stepH, CARD, BORDER, 8);
    // signal-orange left rail
    pdf.setFillColor(...SIGNAL);
    pdf.rect(margin, y, 3, stepH, "F");
    // ink badge
    pdf.setFillColor(...INK);
    pdf.roundedRect(margin + stepPadX, y + stepPadY, badgeSize, badgeSize, 5, 5, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(252, 251, 249);
    pdf.text(
      String(s.number),
      margin + stepPadX + badgeSize / 2,
      y + stepPadY + badgeSize / 2 + 4,
      { align: "center" },
    );

    let ty = y + stepPadY;
    drawLines(actionLines, stepTextX, ty - 11 + 2, 11, "helvetica", "bold", INK, 1.3);
    ty += actionLines.length * 11 * 1.3;
    if (detailLines.length) {
      ty += 4;
      drawLines(detailLines, stepTextX, ty - 9.5 + 2, 9.5, "helvetica", "normal", INK_MUTED, 1.5);
    }
    y += stepH + stepGap;
  }

  y += 8;

  // ============================ 5. CONTROL BAND (3-col) ============================
  // Definition of Done · KPIs · Exceptions
  const ctrlGap = 12;
  const ctrlColW = (contentW - ctrlGap * 2) / 3;
  const ctrlPadX = 12;
  const ctrlPadY = 14;
  const ctrlInnerW = ctrlColW - ctrlPadX * 2;

  // Pre-render each panel's content lines to compute heights
  type Block =
    | {
        kind: "para";
        size: number;
        family: "times" | "helvetica";
        style: "normal" | "bold";
        color: [number, number, number];
        lines: string[];
        lineHeight: number;
        gap: number;
      }
    | { kind: "kpi"; metric: string[]; target: string[] };

  const ddBlocks: Block[] = [
    {
      kind: "para",
      size: 10,
      family: "helvetica",
      style: "normal",
      color: INK,
      lines: wrapLines(d.definitionOfDone, ctrlInnerW, 10, "helvetica", "normal"),
      lineHeight: 1.5,
      gap: 0,
    },
  ];

  const kpiBlocks: Block[] = d.kpis.map((it) => {
    const cleaned = safe(it);
    const m = cleaned.match(/^(.*?)(?:\s*(?:->|:)\s*)(.+)$/);
    if (m) {
      return {
        kind: "kpi" as const,
        metric: wrapLines(m[1].trim(), ctrlInnerW, 9.5, "helvetica", "normal"),
        target: wrapLines(m[2].trim(), ctrlInnerW, 11, "helvetica", "bold"),
      };
    }
    return {
      kind: "para" as const,
      size: 10,
      family: "helvetica" as const,
      style: "normal" as const,
      color: INK,
      lines: wrapLines(`•  ${cleaned}`, ctrlInnerW, 10, "helvetica", "normal"),
      lineHeight: 1.45,
      gap: 4,
    };
  });

  const excBlocks: Block[] = d.exceptions.map((it) => ({
    kind: "para" as const,
    size: 9.5,
    family: "helvetica" as const,
    style: "normal" as const,
    color: INK,
    lines: wrapLines(`•  ${it}`, ctrlInnerW, 9.5, "helvetica", "normal"),
    lineHeight: 1.5,
    gap: 6,
  }));

  const measureBlocks = (blocks: Block[]) => {
    let h = ctrlPadY + 14; // label + gap
    for (const b of blocks) {
      if (b.kind === "para") {
        h += b.lines.length * b.size * b.lineHeight + b.gap;
      } else {
        h += b.metric.length * 9.5 * 1.4 + 2;
        h += b.target.length * 11 * 1.2 + 8;
      }
    }
    return h + ctrlPadY - 4;
  };

  const ctrlH = Math.max(
    measureBlocks(ddBlocks),
    measureBlocks(kpiBlocks),
    measureBlocks(excBlocks),
  );

  ensure(ctrlH + 18);

  const drawCtrlPanel = (xPos: number, label: string, blocks: Block[]) => {
    drawCard(xPos, y, ctrlColW, ctrlH, CARD, BORDER, 8);
    let cy = y + ctrlPadY;
    drawLabel(label, xPos + ctrlPadX, cy);
    cy += 14;
    for (const b of blocks) {
      if (b.kind === "para") {
        drawLines(
          b.lines,
          xPos + ctrlPadX,
          cy - b.size,
          b.size,
          b.family,
          b.style,
          b.color,
          b.lineHeight,
        );
        cy += b.lines.length * b.size * b.lineHeight + b.gap;
      } else {
        drawLines(b.metric, xPos + ctrlPadX, cy - 9.5, 9.5, "helvetica", "normal", INK_MUTED, 1.4);
        cy += b.metric.length * 9.5 * 1.4 + 2;
        drawLines(b.target, xPos + ctrlPadX, cy - 11, 11, "helvetica", "bold", INK, 1.2);
        cy += b.target.length * 11 * 1.2 + 8;
      }
    }
  };

  drawCtrlPanel(margin, "Definition of done", ddBlocks);
  drawCtrlPanel(margin + ctrlColW + ctrlGap, "KPIs", kpiBlocks);
  drawCtrlPanel(margin + (ctrlColW + ctrlGap) * 2, "Exceptions / escalation", excBlocks);
  y += ctrlH + 16;

  // ============================ 6. REVISION ============================
  ensure(28);
  pdf.setDrawColor(...DIVIDER);
  pdf.setLineWidth(0.5);
  pdf.line(margin, y, margin + contentW, y);
  y += 12;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(...INK_MUTED);
  pdf.text(safe(`Revision cadence: ${d.revisionCadence}`), margin, y + 4);

  // ============================ FOOTER (every page) ============================
  const pageCount = pdf.getNumberOfPages();
  const cadenceRaw = (d.revisionCadence || "").trim();
  // If the cadence value already starts with "Review", strip it so we don't
  // render "Review Review quarterly…" in the footer.
  const cadenceClean = cadenceRaw.replace(/^review\s+/i, "");
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.setCharSpace(0);
    // hairline rule
    pdf.setDrawColor(...DIVIDER);
    pdf.setLineWidth(0.4);
    pdf.line(margin, pageH - 26, pageW - margin, pageH - 26);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(...INK_FAINT);

    // Measure right-side text first so we can clip the left title to whatever
    // space remains — prevents the two strings from overlapping.
    const rightText = safe(`Page ${i} of ${pageCount}  ·  v1  ·  Review ${cadenceClean}`);
    const rightW = pdf.getTextWidth(rightText);
    const gap = 16;
    const leftMax = Math.max(40, contentW - rightW - gap);

    const titleFull = safe(`AOS  ·  ${d.title}`);
    let titleOut = titleFull;
    if (pdf.getTextWidth(titleOut) > leftMax) {
      let lo = 0;
      let hi = titleOut.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        const candidate = titleOut.slice(0, mid).trimEnd() + "…";
        if (pdf.getTextWidth(candidate) <= leftMax) lo = mid;
        else hi = mid - 1;
      }
      titleOut = titleOut.slice(0, lo).trimEnd() + "…";
    }

    pdf.text(titleOut, margin, pageH - 14);
    pdf.text(rightText, pageW - margin, pageH - 14, { align: "right" });
  }
}
