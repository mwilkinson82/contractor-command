import { type Packet, packetToClipboard, vault, type PacketStatus } from "@/lib/vault";
import { Check, Copy, Mail, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";

// Status options. For SOP packets we expose "Carried into AOS" because the
// packet is a real artifact that can land in the AOS Knowledge Hub. For
// non-SOP packets the terminal state is "Brought to Session" — a marker that
// says "raise this on the next call."
const BASE_STATUSES: PacketStatus[] = ["Open", "Brought to Session", "Archived"];
const SOP_STATUSES: PacketStatus[] = ["Open", "Brought to Session", "Carried into AOS", "Archived"];

function isSopPacket(p: Packet): boolean {
  return p.source.toLowerCase().includes("sop");
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
  const [hubSent, setHubSent] = useState(false);
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

  function handleEmail() {
    const subject = encodeURIComponent(`${packet.source} — ${packet.title}`);
    const bodyEnc = encodeURIComponent(body);
    window.location.href = `mailto:?subject=${subject}&body=${bodyEnc}`;
  }

  function sendToKnowledgeHub() {
    // Real AOS connector isn't wired yet. For now, mark the packet as
    // "Carried into AOS" so the operator has a record that this SOP belongs
    // in the Knowledge Hub. When the connector ships, this hook becomes a
    // real push.
    vault.updateStatus(packet.id, "Carried into AOS");
    setHubSent(true);
    setTimeout(() => setHubSent(false), 2000);
    onChange?.();
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
            vault.updateStatus(packet.id, e.target.value as PacketStatus);
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
          onClick={handleEmail}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted"
        >
          <Mail className="h-3.5 w-3.5" />
          Email packet
        </button>
        {packet.kind === "command" && !isSop ? (
          <Link
            to="/calls"
            hash="submit-topic"
            onClick={() => {
              vault.updateStatus(packet.id, "Brought to Session");
              onChange?.();
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs text-cream hover:opacity-90"
            title="Marks this packet as 'Brought to Session' and opens the topic submission form."
          >
            Bring to next call
          </Link>
        ) : null}
        {isSop ? (
          <button
            onClick={sendToKnowledgeHub}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs text-cream hover:opacity-90"
            title="Marks this SOP as carried into the AOS Knowledge Hub. Live sync wires in when the AOS connector ships."
          >
            {hubSent ? <Check className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            {hubSent ? "Marked carried" : "Send to AOS Knowledge Hub"}
          </button>
        ) : null}
        {packet.kind === "command" && packet.intensiveRecommended ? (
          <Link
            to="/work-with-marshall"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-gold bg-gold-soft px-3 py-1.5 text-xs text-ink hover:bg-gold/30"
          >
            Consider the Intensive
          </Link>
        ) : null}
      </div>
    </article>
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
