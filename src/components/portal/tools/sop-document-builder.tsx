// SOP Document Builder — the actual authoring surface.
// Opens inline (replaces the right-panel content) when the user clicks
// "Build this SOP" on any backlog row. AI pre-fills via /api/sop-draft.
// User edits inline. Actions: Save to vault · Email · Print/PDF.

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  GripVertical,
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
import { downloadSopAsPdf, downloadSopMarkdown } from "@/lib/tools/sop-download";
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const triedDraft = useRef(isEditMode);
  const [draftElapsed, setDraftElapsed] = useState(0);
  const [draftAttempt, setDraftAttempt] = useState(1);
  const draftAbortRef = useRef<AbortController | null>(null);

  // Drive an elapsed timer while drafting so the UI never looks frozen.
  useEffect(() => {
    if (!loading) {
      setDraftElapsed(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setDraftElapsed(Math.floor((Date.now() - start) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [loading]);

  const DRAFT_PHASES = [
    "Warming up the model…",
    "Scoping the SOP to the seat's authority…",
    "Drafting purpose, scope, trigger…",
    "Writing the runnable procedure…",
    "Wiring inputs, outputs, definition of done…",
    "Setting KPIs and escalation paths…",
    "Polishing the final draft…",
  ];
  const draftPhase =
    DRAFT_PHASES[Math.min(Math.floor(draftElapsed / 8), DRAFT_PHASES.length - 1)];

  // AOS Knowledge Hub hand-off
  const mintAosImport = useServerFn(mintAosSopImportToken);
  const [aosSending, setAosSending] = useState(false);
  const [aosSentAt, setAosSentAt] = useState<number | null>(null);
  const [aosError, setAosError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  async function draft(attempt: number = 1) {
    setLoading(true);
    setError(null);
    setDraftAttempt(attempt);
    // Cancel any prior in-flight request before starting a new one.
    draftAbortRef.current?.abort();
    const controller = new AbortController();
    draftAbortRef.current = controller;
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
        signal: controller.signal,
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
        const msg = (await res.text()) || `Draft failed (${res.status})`;
        // Auto-retry transient first-click failures (timeout / 502 / 504) once
        // so the user doesn't have to click again.
        if (attempt === 1 && (res.status === 502 || res.status === 504 || /timed out/i.test(msg))) {
          await draft(2);
          return;
        }
        setError(msg);
        setLoading(false);
        return;
      }
      const drafted = (await res.json()) as SopDocument;
      setDoc(drafted);
      setLoading(false);
    } catch (e) {
      if (controller.signal.aborted) return;
      const msg = e instanceof Error ? e.message : "Draft failed.";
      if (attempt === 1) {
        await draft(2);
        return;
      }
      setError(msg);
      setLoading(false);
    }
  }

  function markDirty() {
    setSavedId(null);
    setSaveError(null);
  }

  function update<K extends keyof SopDocument>(key: K, value: SopDocument[K]) {
    setDoc((d) => (d ? { ...d, [key]: value } : d));
    markDirty();
  }

  function updateStep(idx: number, patch: Partial<SopStep>) {
    setDoc((d) => {
      if (!d) return d;
      const steps = d.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
      return { ...d, steps };
    });
    markDirty();
  }
  function addStep() {
    setDoc((d) => {
      if (!d) return d;
      const next = d.steps.length + 1;
      return { ...d, steps: [...d.steps, { number: next, action: "", detail: "" }] };
    });
    markDirty();
  }
  function removeStep(idx: number) {
    setDoc((d) => {
      if (!d) return d;
      const steps = d.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, number: i + 1 }));
      return { ...d, steps };
    });
    markDirty();
  }

  function moveStep(idx: number, direction: -1 | 1) {
    setDoc((d) => {
      if (!d) return d;
      const target = idx + direction;
      if (target < 0 || target >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[idx], steps[target]] = [steps[target], steps[idx]];
      return { ...d, steps: steps.map((s, i) => ({ ...s, number: i + 1 })) };
    });
    markDirty();
  }

  function reorderSteps(from: number, to: number) {
    if (from === to) return;
    setDoc((d) => {
      if (!d) return d;
      if (from < 0 || from >= d.steps.length) return d;
      const clamped = Math.max(0, Math.min(to, d.steps.length - 1));
      const steps = [...d.steps];
      const [moved] = steps.splice(from, 1);
      steps.splice(clamped, 0, moved);
      return { ...d, steps: steps.map((s, i) => ({ ...s, number: i + 1 })) };
    });
    markDirty();
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
    markDirty();
  }
  function addListItem(key: "inputs" | "outputs" | "kpis" | "exceptions") {
    setDoc((d) => (d ? { ...d, [key]: [...d[key], ""] } : d));
    markDirty();
  }
  function removeListItem(key: "inputs" | "outputs" | "kpis" | "exceptions", idx: number) {
    setDoc((d) => (d ? { ...d, [key]: d[key].filter((_, i) => i !== idx) } : d));
    markDirty();
  }

  // Tracks the vault packet id this builder is bound to. Seeded from the
  // edit-mode prop and updated after the first save in create-mode so
  // subsequent saves update the same packet instead of creating duplicates.
  const packetIdRef = useRef<string | null>(existingPacketId ?? null);

  async function saveToVault() {
    if (!doc) return;
    setSaving(true);
    setSaveError(null);
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
    try {
      if (packetIdRef.current) {
        const updated = await vault.updateAndPersist(packetIdRef.current, payload);
        if (updated) {
          setSavedId(updated.id);
          return;
        }
        if (isEditMode) {
          setSaveError("Could not save changes to this existing SOP. Please try again.");
          return;
        }
        // Packet vanished (e.g. deleted in another tab) — fall through to create.
        packetIdRef.current = null;
      }
      const saved = await vault.saveAndPersist({
        kind: "command",
        source: "SOP Builder · Document",
        ...payload,
      });
      if (!saved) {
        setSaveError("Could not save this SOP to the vault. Please try again.");
        return;
      }
      packetIdRef.current = saved.id;
      setSavedId(saved.id);
    } finally {
      setSaving(false);
    }
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

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function downloadPdf() {
    if (!doc) return;
    setDownloadError(null);
    setDownloading(true);
    try {
      const res = await downloadSopAsPdf(doc);
      if (res.ok === false) {
        if (res.format === "md") setDownloadError(res.warning);
        else setDownloadError(res.error);
      }
    } finally {
      setDownloading(false);
    }
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
        <div className="mt-6 rounded-md border border-dashed border-border bg-background/60 p-5">
          <div className="flex items-center gap-3">
            <Loader2 className="h-4 w-4 animate-spin text-foreground/70" />
            <p className="text-[13px] text-foreground/90">
              Drafting <span className="font-medium">{item.name}</span>
              <span className="ml-1 tabular-nums text-foreground/60">· {draftElapsed}s</span>
            </p>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">{draftPhase}</p>
          {draftAttempt > 1 && (
            <p className="mt-1 text-[11px] text-foreground/70">
              First attempt timed out — retrying with a faster model. Hang tight.
            </p>
          )}
          {draftElapsed >= 20 && draftAttempt === 1 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              First-run drafts can take up to 60 seconds while the model warms up.
            </p>
          )}
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full bg-foreground/40 transition-[width] duration-500 ease-out"
              style={{ width: `${Math.min(95, draftElapsed * 1.8)}%` }}
            />
          </div>
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
              void draft(1);
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
                {doc.steps.map((s, i) => {
                  const isDragging = dragIndex === i;
                  const isDropTarget = dragOverIndex === i && dragIndex !== null && dragIndex !== i;
                  return (
                  <li
                    key={i}
                    onDragOver={(e) => {
                      if (dragIndex === null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragOverIndex !== i) setDragOverIndex(i);
                    }}
                    onDragLeave={() => {
                      if (dragOverIndex === i) setDragOverIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null) reorderSteps(dragIndex, i);
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    className={`rounded-md border bg-background/60 p-3 transition ${
                      isDragging ? "opacity-40" : ""
                    } ${isDropTarget ? "border-foreground/60 ring-1 ring-foreground/30" : "border-border"}`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          setDragIndex(i);
                          e.dataTransfer.effectAllowed = "move";
                          try { e.dataTransfer.setData("text/plain", String(i)); } catch {}
                        }}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDragOverIndex(null);
                        }}
                        className="mt-1 cursor-grab touch-none rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
                        aria-label="Drag to reorder step"
                        title="Drag to reorder"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
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
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => moveStep(i, -1)}
                          disabled={i === 0}
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                          aria-label="Move step up"
                          title="Move step up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveStep(i, 1)}
                          disabled={i === doc.steps.length - 1}
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                          aria-label="Move step down"
                          title="Move step down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeStep(i)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Remove step"
                          title="Remove step"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </li>
                  );
                })}
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
              disabled={saving || !!savedId}
              className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-[13px] font-medium text-cream hover:opacity-90 disabled:opacity-70"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : savedId ? (
                <Check className="h-3.5 w-3.5 text-signal-success" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {saving
                ? "Saving…"
                : savedId
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
              disabled={downloading}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-[13px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
            >
              {downloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {downloading ? "Preparing…" : "Download PDF"}
            </button>
            <button
              type="button"
              onClick={() => doc && downloadSopMarkdown(doc)}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-[12px] text-foreground/80 hover:bg-muted"
              title="Download a Markdown copy of this SOP"
            >
              <Download className="h-3.5 w-3.5" /> .md
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

          {saveError && <p className="mt-2 text-[12px] text-signal">{saveError}</p>}
          {downloadError && <p className="mt-2 text-[12px] text-signal">{downloadError}</p>}

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

