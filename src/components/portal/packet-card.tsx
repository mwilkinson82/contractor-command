import { type Packet, packetToClipboard, vault, type PacketStatus } from "@/lib/vault";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";

// Terminus for command-tool packets is intentionally narrow: Vault + Calls.
// No AOS hand-off — there is no real connection to wire one to.
const STATUSES: PacketStatus[] = ["Open", "Brought to Session", "Archived"];

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

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(packetToClipboard(packet));
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
            vault.updateStatus(packet.id, e.target.value as PacketStatus);
            onChange?.();
          }}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          {STATUSES.map((s) => (
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
        {packet.kind === "command" ? (
          <Link
            to="/calls"
            hash="submit-topic"
            className="inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs text-cream hover:opacity-90"
          >
            Bring to next call
          </Link>
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
