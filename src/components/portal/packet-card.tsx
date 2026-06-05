import { type Packet, packetToClipboard, vault } from "@/lib/vault";
import { Check, Copy, Loader2, Mail, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { sendTransactionalEmail } from "@/lib/email/send";
import { supabase } from "@/integrations/supabase/client";

// All packet kinds share the same internal markers. These are NOTES the
// operator sets for themselves — they do not notify Marshall or fire any
// external integration. The AOS Knowledge Hub connector isn't wired yet,
// so "Carried into AOS" remains as a manual marker for SOP packets only.
const BASE_STATUSES = ["Open", "Brought to Session", "Archived"] as const;
const SOP_STATUSES = ["Open", "Brought to Session", "Carried into AOS", "Archived"] as const;

function isSopPacket(p: Packet): boolean {
  return p.source.toLowerCase().includes("sop");
}

/** True when this packet has an embedded editable SOP document. */
function hasEditableSop(p: Packet): boolean {
  if (p.kind !== "command") return false;
  const sop = p.inputs?.sopDocument;
  return typeof sop === "string" && sop.length > 0;
}

export function PacketCard({
  packet,
  compact = false,
  onChange,
}: {
  packet: Packet;
  compact?: boolean;
  onChange?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const isSop = isSopPacket(packet);
  const statuses = isSop ? SOP_STATUSES : BASE_STATUSES;

  const body = useMemo(() => packetToClipboard(packet), [packet]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <article className="rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="label-mono">
            {packet.source} · {new Date(packet.createdAt).toLocaleDateString()}
          </p>
          <h3 className="mt-2 font-display text-xl leading-snug">{packet.title}</h3>
        </div>
        <select
          value={packet.status}
          onChange={(e) => {
            vault.updateStatus(packet.id, e.target.value as (typeof statuses)[number]);
            onChange?.();
          }}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {packet.kind === "command" ? (
        <dl className={`mt-5 grid gap-x-8 gap-y-4 ${compact ? "" : "sm:grid-cols-2"}`}>
          <Row label="What we found" value={packet.primaryFinding} />
          <Row label="Primary constraint" value={packet.primaryConstraint} />
          <Row label="Financial consequence" value={packet.financialConsequence} />
          <Row label="Missing system" value={packet.missingSystem} />
          <Row label="Recommended next action" value={packet.recommendedAction} />
          <Row label="Bring one issue" value={packet.bringOneIssuePrompt} span />
        </dl>
      ) : (
        <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <Row label="What needs pressure" value={packet.needsPressure} />
          <Row label="Already tried" value={packet.alreadyTried} />
          <Row label="Decision avoided" value={packet.decisionAvoided} />
          <Row label="Financial consequence" value={packet.financialConsequence} />
          <Row label="What a win looks like" value={packet.winLooksLike} span />
        </dl>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy packet"}
        </button>
        <button
          onClick={() => setEmailOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
        >
          <Mail className="h-3.5 w-3.5" />
          Email packet
        </button>
        {hasEditableSop(packet) && (
          <Link
            to="/tools/sop-edit/$packetId"
            params={{ packetId: packet.id }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit SOP
          </Link>
        )}
        <button
          onClick={() => {
            if (confirm(`Delete "${packet.title}"? This can't be undone.`)) {
              vault.remove(packet.id);
              onChange?.();
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-[color:var(--danger-warm)]"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
        {packet.kind === "command" && packet.intensiveRecommended ? (
          <Link
            to="/work-with-marshall"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gold bg-gold-soft px-3 py-1.5 text-xs text-ink hover:bg-gold/30"
          >
            Consider the Intensive
          </Link>
        ) : null}
      </div>

      <EmailPacketDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        packet={packet}
        body={body}
      />
    </article>
  );
}

function EmailPacketDialog({
  open,
  onOpenChange,
  packet,
  body,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  packet: Packet;
  body: string;
}) {
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    setErr(null);
    const recipient = to.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setErr("Enter a valid email address.");
      return;
    }
    setSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = user
        ? await supabase.from("profiles").select("full_name,email").eq("id", user.id).maybeSingle()
        : { data: null as { full_name: string | null; email: string } | null };

      await sendTransactionalEmail({
        templateName: "vault-packet",
        recipientEmail: recipient,
        idempotencyKey: `vault-packet-${packet.id}-${Date.now()}`,
        templateData: {
          senderName: profile?.full_name ?? undefined,
          senderEmail: profile?.email ?? user?.email ?? undefined,
          source: packet.source,
          title: packet.title,
          note: note.trim() || undefined,
          body,
        },
      });
      setSent(true);
      setTimeout(() => {
        onOpenChange(false);
        setSent(false);
        setTo("");
        setNote("");
      }, 1400);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Email packet</DialogTitle>
          <DialogDescription>
            Sends the full packet, branded, from ALP Contractor Circle.
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <p className="flex items-center gap-2 py-6 text-[13px] text-foreground/80">
            <Check className="h-4 w-4 text-signal" /> Sent.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Recipient email
              </label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="name@company.com"
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] focus:border-ink focus:outline-none"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Note <span className="text-muted-foreground/60">· optional</span>
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Quick context for whoever opens this…"
                className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] focus:border-ink focus:outline-none"
              />
            </div>
            {err && <p className="text-[12px] text-[color:var(--danger-warm)]">{err}</p>}
          </div>
        )}

        {!sent && (
          <DialogFooter>
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-[12px] hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={send}
              disabled={sending || !to.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[12px] text-cream hover:opacity-90 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
              {sending ? "Sending…" : "Send packet"}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, span }: { label: string; value: string; span?: boolean }) {
  return (
    <div className={span ? "sm:col-span-2" : ""}>
      <dt className="label-mono">{label}</dt>
      <dd className="mt-1 text-sm leading-relaxed">{value}</dd>
    </div>
  );
}
