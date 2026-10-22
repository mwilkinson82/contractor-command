import { SUMMARY_OFFER } from "../contract-clauses";
import { whichJobAsk } from "../which-job";
import { isAlertLevel, type AlertLevel } from "./palette";
import type { CardModel, CardRow, CardSection } from "./model";
import { isUuid } from "../refs";
import { safeBoardHref } from "../plain-label";

const TITLES: Record<string, string> = {
  next_question: "Next question",
  answer: "What I have so far",
  intake: "Intake",
  onboarding: "Company",
  list_open_items: "Open items",
  resolve_item: "Close an item",
  carry_forward: "Carried forward",
  contract_terms: "Contract terms",
  report: "Report",
  email_confirm_send: "Email confirmed",
  file_share: "File link",
  file_share_revoke: "Link turned off",
  report_page_link: "Report page",
  report_page_share: "Share link",
  report_page_share_revoke: "Share link turned off",
};

export function visibleBody(text: string): string {
  return text.split("\n---\nAthena powered by ALP")[0].split("\nDisplay: blue (#")[0].trim();
}

function jobOf(text: string): string | null {
  const m = text.match(/^([A-Za-z0-9][\w.-]*) –/m);
  return m?.[1] ?? null;
}

function progressOf(text: string): { done: number; total: number } | null {
  const of = text.match(/Question (\d+) of (\d+)/i);
  if (of) return { done: Number(of[1]), total: Number(of[2]) };
  const more = text.match(/Setup question (\d+) — (\d+) more after this/i);
  if (more) return { done: Number(more[1]), total: Number(more[1]) + Number(more[2]) };
  const last = text.match(/Setup question (\d+) — last one/i);
  if (last) return { done: Number(last[1]), total: Number(last[1]) };
  return null;
}

function questionOf(text: string): string | null {
  const ref = text.split(/Question ref:[^\n]*\n/i)[1];
  if (!ref) return null;
  const chunk = ref.split(/\n(?:Answer with|Call answer|The record shows)/i)[0].trim();
  return chunk || null;
}

function linesOf(text: string): string[] {
  const withoutDocument = text.replace(/<!doctype html[\s\S]*$/i, "");
  return withoutDocument
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("REQUIRED") && !l.startsWith("Display:") && !l.startsWith("---") && !l.startsWith("```") && !l.startsWith("<") && !/<\/?[a-z!]/i.test(l) && !/^[a-z-]+\s*:\s*;?$/i.test(l));
}

function listSection(heading: string, rows: CardRow[]): CardSection {
  return { heading, kind: "list", rows };
}

/** Keep the board address out of label cleanup, which removes visible UUIDs. */
function lookaheadReportRow(line: string): CardRow {
  const link = line.match(/^(?:.*? – )?Styled lookahead \([^)]*\):\s*(.*)$/);
  if (!link) return { cells: [line] };
  const href = safeBoardHref(link[1]);
  if (href) {
    const url = new URL(href);
    const parts = url.pathname.split("/");
    if (url.origin === "https://app.meetathena.io" && !url.username && !url.password &&
      parts.length === 5 && parts[1] === "r" && parts[2] === "job" && isUuid(parts[3]) && parts[4] === "lookahead") {
      return { cells: ["Open live lookahead"], href };
    }
  }
  return { cells: ["Lookahead board link unavailable."] };
}

function riskFlag(flag: string, value: string): AlertLevel | null {
  if (flag === "has_lds" && value === "ON") return "risk";
  if (flag === "notice_requirements" && value === "OFF") return "risk";
  if (/overdue/i.test(value)) return "overdue";
  if (/\bdelay\b/i.test(`${flag} ${value}`)) return "delay";
  return null;
}

/** Risk and delay clauses, matched on the clause line itself (for example §6.3 Liquidated Damages). */
export function lineAlert(line: string): AlertLevel | null {
  if (/liquidated damages|\blds?\b/i.test(line)) return "risk";
  if (/\brisk\b/i.test(line)) return "risk";
  if (/claim notice|notice of claim/i.test(line)) return "risk";
  if (/delay notice|notice of delay/i.test(line)) return "delay";
  return null;
}

function countMatch(text: string, word: string): number {
  const m = text.match(new RegExp(`(\\d+) ${word}`));
  return m ? Number(m[1]) : 0;
}

/** Build a card from a tool's existing text and structured fields. Data lines are not rewritten. */
export function inferCard(tool: string, raw: string, structured: Record<string, unknown> = {}): CardModel {
  const text = visibleBody(raw);
  const job = jobOf(text);
  const base: CardModel = {
    state: "result",
    title: TITLES[tool] ?? "Athena",
    job,
    kpis: [],
    sections: [],
    alerts: [],
    next_move: null,
  };

  if (tool === "next_question") {
    const progress = progressOf(text);
    const prompt = questionOf(text) ?? linesOf(text).slice(-1)[0] ?? "What should we record next?";
    const known = linesOf(text).filter((l) => l.startsWith("Answered for you"));
    return {
      ...base,
      state: "ask",
      progress,
      ask: { prompt },
      sections: known.length ? [{ heading: "Already on the record", kind: "chips", rows: known.map((l) => ({ cells: [l.replace(/^Answered for you:\s*/, "")], tone: "known" as const })) }] : [],
      next_move: "Answer this question, then we take the next one.",
    };
  }

  if (tool === "answer") {
    const recorded = text.match(/Recorded(?:\s+([a-z]+))?/i)?.[1] ?? "saved";
    return {
      ...base,
      state: "progress",
      kpis: [{ label: "Recorded", value: recorded }],
      sections: [listSection("On the record", linesOf(text).slice(0, 6).map((l) => ({ cells: [l], tone: "known" })))],
      next_move: "We take the next question.",
    };
  }

  if (tool === "intake") {
    const known = text.match(/Known:\s*(.+)/i)?.[1];
    const unknown = text.match(/Unknown:\s*(.+)/i)?.[1];
    const rows: CardRow[] = [];
    if (known && known !== "none") known.split(",").forEach((k) => rows.push({ cells: [k.trim()], tone: "known" }));
    if (unknown && unknown !== "none") unknown.split(",").forEach((k) => rows.push({ cells: [k.trim()], tone: "unknown" }));
    return {
      ...base,
      state: "intake",
      sections: [
        { heading: "Known and unknown", kind: "chips", rows },
        listSection("This step", linesOf(text).slice(0, 8).map((l) => ({ cells: [l] }))),
      ],
      next_move: "We keep going through intake.",
    };
  }

  if (tool === "onboarding") {
    const saved = /^Saved\./m.test(text);
    return {
      ...base,
      state: saved ? "result" : "progress",
      title: saved ? "Company saved" : "What I have so far",
      sections: [listSection("Company", linesOf(text).slice(0, 8).map((l) => ({ cells: [l], tone: "known" })))],
      next_move: saved ? "Create the job when you are ready." : "Tell me what is still missing.",
    };
  }

  if (tool === "list_open_items" || tool === "pm_meeting" || tool === "pm_morning" || tool === "pm_evening" || tool === "athena_morning_hitlist" || tool === "submittal_log" || tool === "submittals_list" || tool === "submittals_import" || tool === "project_record_search" || tool === "submittal_chase" || tool === "daily_report_draft" || tool === "daily_report_save" || tool === "daily_report_get") {
    const company = /No job named|Your companies/i.test(text);
    const bullets = linesOf(text).filter((l) => l.startsWith("- ") || l.startsWith("|"));
    if (company) {
      return {
        ...base,
        state: "ask",
        title: "Which job?",
        ask: { prompt: whichJobAsk(tool) },
        sections: [listSection("Companies and jobs", bullets.map((l) => ({ cells: [l.replace(/^- /, "")], tone: "action" })))],
        next_move: "Name the job.",
      };
    }
    if (tool === "list_open_items" && Array.isArray(structured.items)) {
      const listed = structured.items as { action?: string; owner?: string | null; due?: string | null; overdue?: boolean; due_in_7_days?: boolean }[];
      const openN = listed.length;
      const overdueN = listed.filter((item) => item.overdue).length;
      const dueN = listed.filter((item) => item.due_in_7_days).length;
      return {
        ...base,
        state: "result",
        show_state: false,
        kpis: [
          { label: "Open", value: String(openN) },
          { label: "Overdue", value: String(overdueN), flag: overdueN ? "overdue" : null },
          { label: "Due in 7 days", value: String(dueN) },
        ],
        sections: [listSection("Items", listed.map((item) => ({ cells: [String(item.action ?? "Item"), item.owner ?? "Needed", item.due ?? "Needed"], flag: item.overdue ? ("overdue" as const) : null })))],
        alerts: overdueN ? [{ level: "overdue" as const, text: `${overdueN} overdue` }] : [],
        next_move: overdueN ? "Close the overdue item first." : "Pick the next item.",
      };
    }
    if (tool === "list_open_items") {
    const rows = bullets.map((l) => {
      const overdue = /overdue/i.test(l);
      return { cells: [l.replace(/^- /, "")], flag: overdue ? ("overdue" as const) : null };
    });
    const overdueN = rows.filter((r) => r.flag === "overdue").length;
    return {
      ...base,
      state: "result",
      show_state: false,
      kpis: [{ label: "Open items", value: String(rows.length || linesOf(text).length), flag: overdueN ? "overdue" : null }],
      sections: [listSection("Items", rows.length ? rows : linesOf(text).slice(0, 8).map((l) => ({ cells: [l] })))],
      alerts: overdueN ? [{ level: "overdue", text: `${overdueN} overdue` }] : [],
      next_move: overdueN ? "Close the overdue item first." : "Pick the next item.",
    };
    }
  }

  if (tool === "resolve_item") {
    const asking = /Still open/i.test(text);
    return {
      ...base,
      state: asking ? "ask" : "result",
      ask: asking ? { prompt: linesOf(text).find((l) => /Still open/i.test(l)) ?? "Send the evidence that closes this item." } : null,
      sections: [listSection("Item", linesOf(text).slice(0, 4).map((l) => ({ cells: [l] })))],
      next_move: asking ? "Send the evidence." : "The item is updated.",
    };
  }

  if (tool === "carry_forward") {
    const n = text.match(/(\d+) open item/)?.[1] ?? "0";
    return {
      ...base,
      kpis: [{ label: "Carried forward", value: n }],
      sections: [listSection("Move", linesOf(text).slice(0, 3).map((l) => ({ cells: [l] })))],
      next_move: "Review them on the new lookahead.",
    };
  }

  if (tool === "contract_terms") {
    const flags = Array.isArray(structured.flags) ? (structured.flags as { flag?: string; value?: string }[]) : [];
    const flagRows: CardRow[] = flags.map((f) => {
      const name = String(f.flag ?? "").replace(/_/g, " ");
      const value = String(f.value ?? "");
      return { cells: [name, value], flag: riskFlag(String(f.flag ?? ""), value) };
    });
    const rawLines = linesOf(text);
    const incomplete = rawLines.filter((line) => /incomplete terms/i.test(line) || /^\s*-?\s*Missing:/i.test(line));
    const askLine = rawLines.find((line) => line.includes(SUMMARY_OFFER) || /do you want me to summarize/i.test(line));
    const valueLine = (typeof structured.contract_value_display === "string" && structured.contract_value_display) || rawLines.find((line) => /^Contract value:/i.test(line)) || "";
    const clauseRows: CardRow[] = rawLines
      .filter((line) => !incomplete.includes(line) && line !== askLine && line !== valueLine && !/^Contract value:/i.test(line))
      .map((line) => ({ cells: [line], flag: lineAlert(line), raw: true }));
    const alerts = [
      ...clauseRows.flatMap((r) => isAlertLevel(r.flag) ? [{ level: r.flag, text: r.cells[0] }] : []),
      ...flagRows.flatMap((r) => isAlertLevel(r.flag) ? [{ level: r.flag, text: `${r.cells[0]} is ${r.cells[1]}` }] : []),
    ];
    return {
      ...base,
      state: askLine ? "ask" : base.state,
      ask: askLine ? { prompt: SUMMARY_OFFER } : null,
      kpis: [
        ...(valueLine ? [{ label: "Contract value", value: valueLine.replace(/^Contract value:\s*/i, "") }] : []),
        { label: "Clauses", value: String(clauseRows.length) },
        { label: "Risk clauses", value: String(clauseRows.filter((r) => r.flag).length), flag: clauseRows.some((r) => r.flag) ? "risk" : null },
      ],
      sections: [
        ...(Array.isArray(structured.board_links)
          ? [{
              heading: "Job board",
              kind: "chips" as const,
              rows: (structured.board_links as { label?: string; url?: string }[])
                .filter((link) => link.url)
                .map((link) => ({ cells: [String(link.label || "Open")], href: String(link.url), tone: "action" as const })),
            }]
          : []),
        { heading: "Clauses", kind: "list", rows: clauseRows },
        ...(incomplete.length ? [listSection("Incomplete terms", incomplete.map((line) => ({ cells: [line.replace(/^- /, "")], tone: "unknown" as const })))] : []),
        { heading: "Applicability", kind: "table", columns: ["Flag", "Value"], rows: flagRows },
      ],
      alerts,
      next_move: alerts.length ? "Read the red clauses before you price or bill." : "No risk clauses on this read.",
    };
  }

  if (tool === "report") {
    const lookahead = /Two-Week Lookahead/i.test(text);
    const setup = /JOB SETUP REPORT/i.test(text);
    const overdue = countMatch(text, "overdue");
    const risks = countMatch(text, "risks?") ;
    const alerts = [
      ...(overdue ? [{ level: "overdue" as const, text: `${overdue} overdue` }] : []),
      ...(risks ? [{ level: "risk" as const, text: `${risks} risks` }] : []),
    ];
    return {
      ...base,
      state: setup ? "progress" : "result",
      title: lookahead ? "Two-week lookahead" : setup ? "What I have so far" : /schedule of values|SOV/i.test(text) ? "Schedule of values" : "Report",
      kpis: lookahead ? [{ label: "Overdue", value: String(overdue), flag: overdue ? "overdue" : null }, { label: "Risks", value: String(risks), flag: risks ? "risk" : null }] : [],
      sections: [listSection("Report", linesOf(text).slice(0, 8).map((line) => lookahead ? lookaheadReportRow(line) : { cells: [line] }))],
      alerts,
      next_move: lookahead ? "Walk the red items before the meeting moves on." : "Use this card as the report.",
    };
  }

  if (tool === "email_confirm_send") {
    const to = text.match(/email to ([^,]+),/i)?.[1] ?? "";
    const subject = text.match(/subject "([^"]+)"/)?.[1] ?? "";
    return {
      ...base,
      title: "Email confirmed",
      kpis: [
        { label: "To", value: to || "Needed" },
        { label: "Subject", value: subject || "Needed" },
      ],
      sections: [listSection("Confirmation", [{ cells: [linesOf(text)[0] ?? "Confirmed."], tone: "known" }])],
      next_move: "This one email can go out as reviewed.",
    };
  }

  if (tool === "file_share" || tool === "file_share_revoke" || tool === "report_page_link" || tool === "report_page_share" || tool === "report_page_share_revoke") {
    const link = text.match(/https?:\/\/\S+/)?.[0] ?? "";
    return {
      ...base,
      kpis: link ? [{ label: "Link", value: link }] : [],
      sections: [listSection("Link", linesOf(text).slice(0, 4).map((l) => ({ cells: [l], tone: "action" })))],
      next_move: tool.endsWith("revoke") ? "The link is off." : "Give the member this link.",
    };
  }

  return {
    ...base,
    sections: [listSection("Detail", linesOf(text).slice(0, 8).map((l) => ({ cells: [l] })))],
  };
}
