// SOP Priority Builder — deterministic logic.
// Owner lists the areas they still touch. We score each by leverage
// (owner hours saved × blast radius / setup effort) and surface the
// single system to build first.

export type SopArea = {
  name: string;
  ownerHoursPerWeek: number;  // hours/wk the owner spends here today
  blastRadius: number;        // 1..5  — what breaks if owner is out
  setupEffort: number;        // 1..5  — how hard to systematize (1=easy)
  frequency: number;          // 1..5  — how often it recurs (5=daily)
};

export const DEFAULT_SOP_AREAS: SopArea[] = [
  { name: "Estimating new bids", ownerHoursPerWeek: 8, blastRadius: 5, setupEffort: 4, frequency: 5 },
  { name: "Client communication", ownerHoursPerWeek: 6, blastRadius: 4, setupEffort: 2, frequency: 5 },
  { name: "Hiring & onboarding", ownerHoursPerWeek: 3, blastRadius: 3, setupEffort: 3, frequency: 2 },
  { name: "Billing & AR collection", ownerHoursPerWeek: 4, blastRadius: 5, setupEffort: 2, frequency: 4 },
  { name: "Field problem-solving", ownerHoursPerWeek: 10, blastRadius: 5, setupEffort: 5, frequency: 5 },
];

export type SopScored = SopArea & {
  leverageScore: number;
  annualHoursSaved: number;
  rank: number;
};

export type SopPriorityResult = {
  ranked: SopScored[];
  top: SopScored;
  headline: string;
  finding: string;
  recommendedAction: string;
  totalOwnerHours: number;
  totalRecoverableHours: number;
};

export function calcSopPriority(areas: SopArea[]): SopPriorityResult {
  const cleaned = areas.filter((a) => a.name.trim().length > 0);
  const safe = cleaned.length > 0 ? cleaned : DEFAULT_SOP_AREAS;

  const scored: SopScored[] = safe
    .map((a) => {
      const effort = Math.max(1, a.setupEffort);
      const leverageScore =
        (a.ownerHoursPerWeek * a.blastRadius * a.frequency) / effort;
      const annualHoursSaved = a.ownerHoursPerWeek * 50 * 0.7; // assume SOP recovers ~70%
      return { ...a, leverageScore, annualHoursSaved, rank: 0 };
    })
    .sort((x, y) => y.leverageScore - x.leverageScore)
    .map((s, i) => ({ ...s, rank: i + 1 }));

  const top = scored[0];
  const totalOwnerHours = scored.reduce((sum, s) => sum + s.ownerHoursPerWeek, 0);
  const totalRecoverableHours = scored.reduce((sum, s) => sum + s.annualHoursSaved, 0);

  const headline = `Build the SOP for ${top.name} first.`;
  const finding =
    `Across the ${scored.length} areas you still touch, ${top.name} scores the highest leverage — ` +
    `${top.ownerHoursPerWeek}h/wk of owner time, blast radius ${top.blastRadius}/5, setup effort ${top.setupEffort}/5. ` +
    `Systematizing it recovers roughly ${Math.round(top.annualHoursSaved)} owner hours/yr and removes a single point of failure.`;
  const recommendedAction =
    `Block 4 focused hours this week to draft the ${top.name.toLowerCase()} SOP. ` +
    `Format: trigger → steps → who owns each → done-when. Hand it to the person closest to the work, not the most senior.`;

  return {
    ranked: scored,
    top,
    headline,
    finding,
    recommendedAction,
    totalOwnerHours,
    totalRecoverableHours,
  };
}

export const SOP_PRIORITY_STEPS = [
  { label: "Loading owner-touch areas and weights…", ms: 360 },
  { label: "Scoring each area on hours, blast radius, frequency…", ms: 440 },
  { label: "Dividing by setup effort to rank by leverage…", ms: 380 },
  { label: "Projecting annual hours recoverable from the top SOP…", ms: 420 },
  { label: "Composing Command Packet for the vault…", ms: 360 },
];

export function sopPriorityTicker(areas: SopArea[], r: SopPriorityResult): string[] {
  const lines: string[] = [`load inputs.areas = ${areas.length}`];
  for (const a of areas.slice(0, 6)) {
    lines.push(
      `  → ${a.name}: ${a.ownerHoursPerWeek}h/wk, blast ${a.blastRadius}, effort ${a.setupEffort}, freq ${a.frequency}`,
    );
  }
  lines.push(
    `derive leverage = (hours * blast * freq) / effort`,
    `rank by leverage`,
  );
  for (const s of r.ranked.slice(0, 5)) {
    lines.push(`  → #${s.rank} ${s.name} = ${s.leverageScore.toFixed(1)}`);
  }
  lines.push(
    `project annual_hours_saved (top)`,
    `  → ${Math.round(r.top.annualHoursSaved)}h/yr`,
    `compose command packet …`,
    `done.`,
  );
  return lines;
}
