import { isUuid, pageUrl } from "../../report-pages";
import { detailAnchor } from "../plain-label";
import { money } from "../sov";
import type { CardModel, CardRow } from "../cards/model";
import {
  STAGE_LABEL,
  stagesFor,
  type FlowData,
  type FlowItem,
  type FlowName,
  type IorRow,
} from "./types";

const yn = (v: boolean | null, yes: string, no: string) => (v === true ? yes : v === false ? no : "Needed");

function dollars(n: number | null, show: boolean): string {
  if (!show) return "Hidden";
  return n === null ? "Needed" : money(n);
}

export type IorDelta = { slipped: IorRow[]; fresh: IorRow[]; resolved: IorRow[]; still: IorRow[] };

export function iorDelta(now: IorRow[], previous: IorRow[]): IorDelta {
  const prev = new Map(previous.map((r) => [r.id, r]));
  const slipped: IorRow[] = [];
  const fresh: IorRow[] = [];
  const still: IorRow[] = [];
  const resolved: IorRow[] = [];
  for (const row of now) {
    const was = prev.get(row.id);
    prev.delete(row.id);
    if (row.state === "resolved") resolved.push(row);
    else if (!was) fresh.push(row);
    else if (was.due && row.due && row.due > was.due) slipped.push(row);
    else still.push(row);
  }
  for (const row of prev.values()) resolved.push(row);
  return { slipped, fresh, resolved, still };
}

function crewAsk(data: FlowData): string {
  return data.selfPerform
    ? "Are the self-perform crews and materials confirmed for this lookahead?"
    : "Are the subs, suppliers and crews confirmed for this lookahead?";
}

function crewLabel(data: FlowData): string {
  return data.selfPerform ? "Self-perform crews and materials" : "Subs, suppliers and crews";
}

function changeRows(items: FlowItem[]): { outstanding: FlowItem[]; pricing: FlowItem[]; waiting: FlowItem[] } {
  const changes = items.filter((i) => i.kind === "change" && i.status === "open");
  return {
    pricing: changes.filter((i) => /pric/i.test(i.action)),
    waiting: changes.filter((i) => /wait|pending/i.test(i.action)),
    outstanding: changes.filter((i) => !/pric/i.test(i.action) && !/wait|pending/i.test(i.action)),
  };
}

function itemHref(data: FlowData, page: "items" | "ior", id: string): string | null {
  if (!data.jobId || !isUuid(data.jobId)) return null;
  return `${pageUrl(page, data.jobId)}#${detailAnchor("item", id)}`;
}

function itemRow(data: FlowData, i: FlowItem, flag?: CardRow["flag"]): CardRow {
  return { cells: [i.action, i.owner ?? "Needed", i.due ?? "Needed"], flag: flag ?? null, href: itemHref(data, "items", i.id), refId: i.id };
}

function candidates(items: FlowItem[]): FlowItem[] {
  return items.filter((i) => i.status === "open" && (i.kind === "risk" || i.kind === "delay"));
}

function noteSection(data: FlowData): CardModel["sections"] {
  if (!data.note) return [];
  const line = data.sample
    ? "Sample on job 2701. Nothing was saved."
    : data.logged
      ? "Filed on the risk log and saved for the next IOR comparison."
      : data.itemFiled
        ? "Filed on the risk log. The IOR snapshot was not stored."
        : "On this card. It was not stored.";
  return [{ heading: "From this meeting", kind: "list", rows: [{ cells: [data.note], tone: "action" }, { cells: [line], tone: data.logged ? "known" : "unknown" }] }];
}

function shell(flow: FlowName, stage: string, data: FlowData, card: Omit<CardModel, "job" | "progress">): CardModel {
  const stages = stagesFor(flow);
  const index = Math.max(0, stages.indexOf(stage));
  const next = stages[index + 1];
  const move = card.next_move ?? (next ? `Next up is ${STAGE_LABEL[next]}.` : "That is the last stage of this meeting.");
  return {
    ...card,
    job: `${data.jobNumber} – ${data.jobName}`,
    progress: { done: index + 1, total: stages.length },
    next_move: data.sample ? `${move} Sample on job 2701. Nothing was saved.` : move,
    sections: [...(card.sections ?? []), ...(noteSection(data) ?? [])],
  };
}

function scheduleCard(flow: FlowName, data: FlowData): CardModel {
  const gaps: string[] = [];
  if (data.lookaheadLocked !== true) gaps.push("Is the two-week lookahead locked in?");
  if (data.crewsConfirmed !== true) gaps.push(crewAsk(data));
  const chips: CardRow[] = [
    { cells: [`Progress: ${data.progressLabel ?? "Needed"}`], tone: data.progressLabel ? "known" : "unknown" },
    { cells: [`Two-week lookahead: ${yn(data.lookaheadLocked, "Locked in", "Not locked")}`], tone: data.lookaheadLocked ? "known" : "unknown" },
    { cells: [`${crewLabel(data)}: ${yn(data.crewsConfirmed, "Confirmed", "Not confirmed")}`], tone: data.crewsConfirmed ? "known" : "unknown" },
  ];
  const risks = candidates(data.items);
  if (flow === "pm_morning") {
    return shell(flow, "schedule", data, {
      state: data.onSchedule === null ? "ask" : "result",
      title: "On schedule?",
      ask: data.onSchedule === null ? { prompt: "Are we on schedule against the lookahead?" } : null,
      kpis: [{ label: "On schedule", value: yn(data.onSchedule, "Yes", "No"), flag: data.onSchedule === false ? "delay" : null }],
      sections: [{ heading: "Against the lookahead", kind: "chips", rows: chips.slice(0, 2) }],
      alerts: data.onSchedule === false ? [{ level: "delay", text: "Off the lookahead." }] : [],
    });
  }
  return shell(flow, "schedule", data, {
    state: gaps.length ? "ask" : "result",
    title: "Schedule",
    ask: gaps.length ? { prompt: gaps[0] } : null,
    kpis: [
      { label: "Lookahead", value: yn(data.lookaheadLocked, "Locked", "Open") },
      { label: "On schedule", value: yn(data.onSchedule, "Yes", "No"), flag: data.onSchedule === false ? "delay" : null },
    ],
    sections: [
      { heading: "Locked lookahead", kind: "chips", rows: [chips[1]] },
      { heading: crewLabel(data), kind: "chips", rows: [chips[2]] },
      { heading: "Needed", kind: "list", rows: gaps.map((g) => ({ cells: [g], tone: "action" as const })) },
      {
        heading: "Change order candidates",
        kind: "table",
        columns: ["Item", "Owner", "Due"],
        rows: risks.map((i) => itemRow(data, i, i.kind === "delay" ? "delay" : "risk")),
      },
    ],
    alerts: [
      ...(data.onSchedule === false ? [{ level: "delay" as const, text: "Off the lookahead. The slip is a change order candidate." }] : []),
      ...risks.map((i) => ({ level: (i.kind === "delay" ? "delay" : "risk") as "delay" | "risk", text: i.action })),
    ],
  });
}

const amount = (raw: string) => {
  const n = Number(raw.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

/** Pull "planned 10000" and "realistic 8000" out of a meeting note. */
export function readMeetingMoney(text: string): { plan?: number; realistic?: number } {
  const plan = text.match(/\b(?:planned|plan)\b[^0-9$]{0,24}\$?([0-9][0-9,]*(?:\.\d+)?)/i);
  const realistic = text.match(/\brealistic(?:\s+bill)?\b[^0-9$]{0,24}\$?([0-9][0-9,]*(?:\.\d+)?)/i);
  return { plan: plan ? amount(plan[1]) : undefined, realistic: realistic ? amount(realistic[1]) : undefined };
}

export function applyMeetingFigures(data: FlowData, input: { plan?: number; realistic?: number; percent_complete?: number; note?: string }) {
  const parsed = readMeetingMoney(input.note ?? "");
  const plan = input.plan ?? parsed.plan;
  const realistic = input.realistic ?? parsed.realistic;
  if (plan != null) data.money.plan = plan;
  if (realistic != null) data.money.realistic = realistic;
  if (input.percent_complete != null) data.percentComplete = input.percent_complete;
}

function progressCard(data: FlowData): CardModel {
  const missing = data.percentComplete == null;
  const pct = missing ? "Needed" : `${data.percentComplete}%`;
  const done = data.activitiesDone.length ? data.activitiesDone : ["Needed"];
  return shell("pm_meeting", "progress", data, {
    state: missing ? "ask" : "progress",
    title: "Schedule progress",
    ask: missing ? { prompt: "What percent complete is the schedule?" } : null,
    kpis: [
      { label: "Percent complete", value: pct },
      { label: "Critical path", value: data.criticalPath ?? "Needed", flag: data.onSchedule === false ? "delay" : null },
    ],
    sections: [
      { heading: "Activities done since last meeting", kind: "list", rows: done.map((line) => ({ cells: [line], tone: line === "Needed" ? "unknown" as const : "known" as const })) },
      { heading: "Critical-path status", kind: "list", rows: [{ cells: [data.criticalPath ?? "Needed"], tone: data.criticalPath ? "known" : "unknown" }] },
      ...(missing ? [{ heading: "Percent complete", kind: "list" as const, rows: [{ cells: ["It is not on the saved schedule. Reply with the percent and I will record it."], tone: "action" as const }] }] : []),
    ],
  });
}

export function buildFlowCard(flow: FlowName, stage: string, data: FlowData): CardModel {
  if (flow === "pm_meeting" && stage === "progress") return progressCard(data);
  if (stage === "schedule") return scheduleCard(flow, data);
  if (flow === "pm_meeting" && stage === "change_orders") {
    const groups = changeRows(data.items);
    const empty = !groups.outstanding.length && !groups.pricing.length && !groups.waiting.length;
    return shell(flow, stage, data, {
      state: empty ? "ask" : "result",
      title: "Change orders",
      ask: empty ? { prompt: "What is outstanding, what needs pricing, and what are you waiting on?" } : null,
      kpis: [
        { label: "Outstanding", value: String(groups.outstanding.length) },
        { label: "Needs pricing", value: String(groups.pricing.length) },
        { label: "Waiting on", value: String(groups.waiting.length) },
      ],
      sections: [
        { heading: "Outstanding", kind: "table", columns: ["Item", "Owner", "Due"], rows: groups.outstanding.map((i) => itemRow(data, i)) },
        { heading: "Needs pricing", kind: "table", columns: ["Item", "Owner", "Due"], rows: groups.pricing.map((i) => itemRow(data, i, "risk")) },
        { heading: "Waiting on", kind: "table", columns: ["Item", "Owner", "Due"], rows: groups.waiting.map((i) => itemRow(data, i)) },
      ],
      alerts: groups.pricing.map((i) => ({ level: "risk" as const, text: `${i.action} needs pricing` })),
    });
  }
  if (flow === "pm_meeting" && stage === "accounting") {
    const m = data.money;
    const miss = data.showMoney && m.plan !== null && m.realistic !== null && m.realistic < m.plan;
    const tie = data.showMoney && m.billed !== null && m.remaining !== null && m.contract !== null && Math.round((m.billed + m.remaining) * 100) !== Math.round(m.contract * 100);
    return shell(flow, stage, data, {
      state: m.plan === null || m.realistic === null ? "ask" : "result",
      title: "Accounting",
      ask: m.plan === null || m.realistic === null ? { prompt: "What is this month's billing forecast, and what will we actually bill?" } : null,
      kpis: [
        { label: "Plan this month", value: dollars(m.plan, data.showMoney) },
        { label: "Realistic bill", value: dollars(m.realistic, data.showMoney), flag: miss ? "risk" : null },
        { label: "Billed to date", value: dollars(m.billed, data.showMoney) },
        { label: "Remaining", value: dollars(m.remaining, data.showMoney) },
        { label: "Retention held", value: dollars(m.retentionHeld, data.showMoney) },
        { label: "Retention release", value: m.retentionReleasable === null ? "Needed" : m.retentionReleasable ? "Yes" : "No" },
      ],
      sections: [
        {
          heading: "Other ways to make money",
          kind: "list",
          rows: [
            { cells: ["Stored materials, when the contract allows a bill for them"] },
            { cells: ["Change orders that are priced and approved"] },
            { cells: [m.retentionReleasable ? "Retention can be released" : "Retention stays held until the contract allows a release"] },
          ],
        },
        ...(miss
          ? [{
              heading: "If we miss the forecast",
              kind: "list" as const,
              rows: [
                { cells: ["Accelerate the work that can bill this month"], tone: "action" as const },
                { cells: ["Grease the skids on approvals that are holding a bill"], tone: "action" as const },
                { cells: ["Partial billings on activities, to justify a larger SOV bill"], tone: "action" as const },
              ],
            }]
          : []),
      ],
      alerts: [
        ...(miss ? [{ level: "risk" as const, text: `Realistic bill ${dollars(m.realistic, true)} is under the plan ${dollars(m.plan, true)}.` }] : []),
        ...(tie ? [{ level: "risk" as const, text: `Doesn't tie: billed plus remaining is off the contract by ${dollars(Math.abs((m.billed ?? 0) + (m.remaining ?? 0) - (m.contract ?? 0)), true)}.` }] : []),
      ],
    });
  }
  if (flow === "pm_meeting" && stage === "ior") {
    if (!data.hasSnapshot) {
      return shell(flow, stage, data, {
        state: "result",
        title: "IOR delta",
        kpis: [{ label: "Previous snapshot", value: "None stored" }],
        sections: [{ heading: "Stored snapshot", kind: "list", rows: [{ cells: ["No previous meeting snapshot is stored yet. Slipped, new, and resolved stay empty until one is."], tone: "unknown" }] }],
        alerts: [],
      });
    }
    const d = iorDelta(data.iorNow, data.iorPrevious);
    const row = (r: IorRow, flag: CardRow["flag"]) => ({ cells: [r.title, r.due ?? "Needed"], flag, href: itemHref(data, "ior", r.id), refId: r.id });
    return shell(flow, stage, data, {
      state: "result",
      title: "IOR delta",
      kpis: [
        { label: "Slipped", value: String(d.slipped.length), flag: d.slipped.length ? "delay" : null },
        { label: "New", value: String(d.fresh.length), flag: d.fresh.length ? "risk" : null },
        { label: "Resolved", value: String(d.resolved.length) },
      ],
      sections: [
        { heading: "Against the stored snapshot", kind: "list", rows: [{ cells: ["Compared with the previous meeting snapshot."], tone: "known" }] },
        { heading: "Slipped", kind: "table", columns: ["Item", "Due"], rows: d.slipped.map((r) => row(r, "delay")) },
        { heading: "New", kind: "table", columns: ["Item", "Due"], rows: d.fresh.map((r) => row(r, "risk")) },
        { heading: "Resolved", kind: "table", columns: ["Item", "Due"], rows: d.resolved.map((r) => row(r, null)) },
        { heading: "Still open", kind: "list", rows: d.still.map((r) => ({ cells: [r.title], tone: "unknown" as const })) },
      ],
      alerts: [
        ...d.slipped.map((r) => ({ level: "delay" as const, text: `${r.title} slipped` })),
        ...d.fresh.map((r) => ({ level: "risk" as const, text: `${r.title} is new` })),
      ],
    });
  }
  if (flow === "pm_morning" && stage === "crews") {
    const open = data.crewsConfirmed !== true;
    return shell(flow, stage, data, {
      state: open ? "ask" : "result",
      title: crewLabel(data),
      ask: open ? { prompt: crewAsk(data) } : null,
      kpis: [{ label: "Locked in", value: yn(data.crewsConfirmed, "Yes", "No") }],
      sections: [{ heading: "Crews", kind: "list", rows: data.items.filter((i) => i.kind === "crew").map((i) => itemRow(data, i)) }],
    });
  }
  if ((flow === "pm_morning" || flow === "pm_evening") && stage === "risks") {
    const risks = candidates(data.items);
    return shell(flow, stage, data, {
      state: risks.length ? "result" : "ask",
      title: "Current risks",
      ask: risks.length ? null : { prompt: "What risks are live on the job right now?" },
      sections: [{ heading: "Risk log", kind: "table", columns: ["Item", "Owner", "Due"], rows: risks.map((i) => itemRow(data, i, i.kind === "delay" ? "delay" : "risk")) }],
      alerts: risks.map((i) => ({ level: (i.kind === "delay" ? "delay" : "risk") as "delay" | "risk", text: i.action })),
      next_move: "These feed the IOR and the risk log.",
    });
  }
  if (flow === "pm_morning" && stage === "spillover") {
    const rows = data.spillover;
    return shell(flow, stage, data, {
      state: rows.length ? "result" : "ask",
      title: "From last night",
      ask: rows.length ? null : { prompt: "What spilled over from last night?" },
      sections: [{ heading: "Spillover", kind: "list", rows: rows.map((r) => ({ cells: [r], tone: "action" as const })) }],
    });
  }
  if (flow === "pm_evening" && (stage === "dailies" || stage === "photos" || stage === "happened" || stage === "disruptions")) {
    const bag = stage === "dailies" ? data.dailies : stage === "photos" ? data.photos : stage === "happened" ? data.happened : data.disruptions;
    const flag = stage === "disruptions" ? "delay" : null;
    const page = stage === "dailies" ? "daily" : stage === "photos" ? "photos" : null;
    const href = page && data.jobId && isUuid(data.jobId) ? pageUrl(page, data.jobId) : null;
    return shell(flow, stage, data, {
      state: bag.length ? "result" : "ask",
      title: STAGE_LABEL[stage],
      ask: bag.length ? null : { prompt: `What should I log for ${STAGE_LABEL[stage].toLowerCase()}?` },
      sections: [{ heading: STAGE_LABEL[stage], kind: "list", rows: bag.map((r) => ({ cells: [r], flag, href })) }],
      alerts: flag ? bag.map((r) => ({ level: "delay" as const, text: r })) : [],
    });
  }
  if (flow === "pm_meeting") {
    throw new Error("PM meeting stages are Schedule progress, Schedule, Change orders, Accounting, and IOR delta. There is no other stage.");
  }
  return shell(flow, "log", data, {
    state: "result",
    title: flow === "pm_evening" ? "Logged to the project record" : "Feeds the IOR",
    kpis: [{ label: "Stored", value: data.logged ? "Yes" : data.sample ? "Sample only" : "Not yet" }],
    sections: [{
      heading: flow === "pm_evening" ? "Project record and IOR" : "IOR and risk log",
      kind: "list",
      rows: [
        { cells: [data.logged ? "Logged to the project record and saved for the IOR." : "Say what changed and I will file it on the risk log."], tone: data.logged ? "known" : "action" },
      ],
    }],
  });
}
