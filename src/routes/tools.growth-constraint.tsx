import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { calcGcm, DEFAULT_GCM, type GcmInputs } from "@/lib/growth-constraint";
import { vault } from "@/lib/vault";
import { PacketCard } from "@/components/portal/packet-card";
import { Check } from "lucide-react";

export const Route = createFileRoute("/tools/growth-constraint")({
  head: () => ({
    meta: [{ title: "Growth Constraint Map — ALP Contractor Circle" }],
  }),
  component: GrowthConstraintTool,
});

const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;

function GrowthConstraintTool() {
  const [inputs, setInputs] = useState<GcmInputs>(DEFAULT_GCM);
  const [savedId, setSavedId] = useState<string | null>(null);
  const result = useMemo(() => calcGcm(inputs), [inputs]);

  function update<K extends keyof GcmInputs>(key: K, raw: string) {
    const n = Number(raw.replace(/[,$]/g, ""));
    setInputs((p) => ({ ...p, [key]: Number.isFinite(n) ? n : 0 }));
    setSavedId(null);
  }

  function savePacket() {
    const p = vault.save({
      kind: "command",
      source: "Growth Constraint Map",
      title: result.headline,
      primaryFinding: result.finding,
      primaryConstraint: result.headline,
      financialConsequence: `Revenue gap ${fmtMoney(result.revenueGap)} · Gross profit attached ${fmtMoney(result.grossProfitAttachedToGap)}`,
      missingSystem: result.missingSystem,
      recommendedAction: result.recommendedAction,
      relatedAos: result.relatedAos,
      bringOneIssuePrompt: result.bringOneIssuePrompt,
      intensiveRecommended: result.intensiveRecommended,
      inputs: inputs as unknown as Record<string, number>,
    });
    setSavedId(p.id);
  }

  return (
    <div className="grid gap-10 lg:grid-cols-12">
      {/* Inputs */}
      <section className="lg:col-span-5">
        <p className="label-mono">Business variables</p>
        <h2 className="mt-2 font-display text-3xl">Growth Constraint Map</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Twelve numbers about how your business actually runs. The map will show what is genuinely blocking your next revenue tier.
        </p>

        <div className="mt-7 space-y-5">
          <Group label="Revenue target">
            <Field label="Desired annual revenue" value={inputs.desiredRevenue} onChange={(v) => update("desiredRevenue", v)} money />
            <Field label="Current annual revenue" value={inputs.currentRevenue} onChange={(v) => update("currentRevenue", v)} money />
            <Field label="Average gross margin %" value={inputs.avgGrossMarginPct} onChange={(v) => update("avgGrossMarginPct", v)} suffix="%" />
          </Group>
          <Group label="Project economics">
            <Field label="Average project size" value={inputs.avgProjectSize} onChange={(v) => update("avgProjectSize", v)} money />
            <Field label="Average project duration (months)" value={inputs.avgProjectDurationMonths} onChange={(v) => update("avgProjectDurationMonths", v)} />
          </Group>
          <Group label="Delivery capacity">
            <Field label="Current active projects" value={inputs.currentActiveProjects} onChange={(v) => update("currentActiveProjects", v)} />
            <Field label="Realistic active project capacity" value={inputs.realisticActiveProjectCapacity} onChange={(v) => update("realisticActiveProjectCapacity", v)} />
            <Field label="PMs / project leaders" value={inputs.pms} onChange={(v) => update("pms", v)} />
            <Field label="Average projects per PM" value={inputs.avgProjectsPerPm} onChange={(v) => update("avgProjectsPerPm", v)} />
          </Group>
          <Group label="Pipeline">
            <Field label="Qualified leads / month" value={inputs.qualifiedLeadsPerMonth} onChange={(v) => update("qualifiedLeadsPerMonth", v)} />
            <Field label="Estimates sent / month" value={inputs.estimatesSentPerMonth} onChange={(v) => update("estimatesSentPerMonth", v)} />
            <Field label="Close rate %" value={inputs.closeRatePct} onChange={(v) => update("closeRatePct", v)} suffix="%" />
          </Group>
        </div>
      </section>

      {/* Result panel — charcoal focus */}
      <section className="lg:col-span-7 lg:sticky lg:top-24 lg:self-start">
        <div className="overflow-hidden rounded-3xl bg-ink text-cream shadow-[var(--shadow-focus)]">
          <div className="border-b border-cream/10 px-8 py-6">
            <p className="label-mono !text-cream/55">The constraint</p>
            <h3 className="mt-3 font-display text-3xl leading-snug text-cream">{result.headline}</h3>
            <p className="mt-4 text-[15px] leading-relaxed text-cream/80">{result.finding}</p>
          </div>

          <div className="grid grid-cols-2 gap-px bg-cream/5 sm:grid-cols-4">
            <Stat label="Revenue gap" value={fmtMoney(result.revenueGap)} />
            <Stat label="Gross profit attached" value={fmtMoney(result.grossProfitAttachedToGap)} />
            <Stat label="Required active projects" value={result.requiredActiveProjects.toFixed(1)} />
            <Stat label="Estimates needed / yr" value={Math.ceil(result.estimatesRequired).toLocaleString()} />
          </div>

          <div className="space-y-4 px-8 py-7 text-sm">
            <LineItem k="Monthly billing velocity / project" v={fmtMoney(result.monthlyBillingVelocityPerProject)} />
            <LineItem k="Current annual capacity" v={fmtMoney(result.currentAnnualCapacity)} />
            <LineItem k="Realistic annual capacity" v={fmtMoney(result.realisticAnnualCapacity)} />
            <LineItem k="Estimate capacity (yr)" v={result.estimateCapacity.toLocaleString()} />
            <LineItem k="PM capacity" v={result.pmCapacity.toLocaleString()} />
            <LineItem k="Signed contracts required" v={Math.ceil(result.signedContractsRequired).toLocaleString()} />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-cream/10 bg-ink/60 px-8 py-5">
            <button
              onClick={savePacket}
              className="inline-flex items-center gap-1.5 rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:opacity-90"
            >
              {savedId ? <><Check className="h-4 w-4" /> Saved to Vault</> : "Save Command Packet"}
            </button>
            <Link to="/vault" className="rounded-md border border-cream/15 px-3 py-2 text-sm text-cream hover:bg-cream/5">
              Open Vault
            </Link>
            {result.intensiveRecommended ? (
              <Link
                to="/work-with-marshall"
                className="ml-auto rounded-md border border-gold bg-gold/15 px-3 py-2 text-sm text-gold hover:bg-gold/25"
              >
                Consider the Intensive
              </Link>
            ) : null}
          </div>
        </div>

        {savedId ? (
          <div className="mt-6">
            <PacketCard packet={vault.get(savedId)!} />
          </div>
        ) : (
          <p className="mt-6 px-2 text-xs text-muted-foreground">
            Save the Command Packet to keep this finding in your Company Vault. Then carry the recommended action into AOS.
          </p>
        )}
      </section>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label-mono">{label}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  money,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
  money?: boolean;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="relative mt-1">
        {money ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span> : null}
        <input
          type="text"
          inputMode="numeric"
          value={value.toLocaleString()}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm tabular-nums focus:border-ink focus:outline-none ${money ? "pl-7" : ""} ${suffix ? "pr-8" : ""}`}
        />
        {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{suffix}</span> : null}
      </div>
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink px-5 py-4">
      <p className="label-mono !text-cream/50">{label}</p>
      <p className="mt-1 font-display text-xl text-cream tabular-nums">{value}</p>
    </div>
  );
}

function LineItem({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-cream/5 pb-2 last:border-0">
      <span className="text-cream/65">{k}</span>
      <span className="font-mono text-cream tabular-nums">{v}</span>
    </div>
  );
}
