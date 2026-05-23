import type { Annotation, Dependency, Task } from "./types";

/**
 * Commercial Tenant Fit-Out — a realistic ~30-activity CPM sample.
 *
 * Covers: WBS hierarchy, FS/SS dependencies with lag, percent-complete to a
 * data date, resources, budgets, milestone annotations. Designed so the CPM
 * engine produces a clear critical path through MEP rough-in → drywall →
 * finishes → punchlist → substantial completion.
 */
export interface SamplePayload {
  name: string;
  projectStartDate: string;
  dataDate: string;
  workDays: number;
  holidays: string[];
  tasks: Task[];
  dependencies: Dependency[];
  annotations: Annotation[];
}

export function commercialFitOutSample(): SamplePayload {
  const tasks: Task[] = [
    // 1 — Pre-Construction
    { id: "A1010", wbs: "1 Pre-Construction", name: "Notice to Proceed", duration: 0, percentComplete: 100 },
    { id: "A1020", wbs: "1 Pre-Construction", name: "Submittals & Long-Lead Procurement", duration: 15, percentComplete: 100, resourceName: "PM", resourceUnitsPerDay: 1, budgetCost: 18000 },
    { id: "A1030", wbs: "1 Pre-Construction", name: "Permits Issued", duration: 0, percentComplete: 100 },

    // 2 — Demolition & Protection
    { id: "A2010", wbs: "2 Demolition & Protection", name: "Site Mobilization", duration: 3, percentComplete: 100, resourceName: "Supt", resourceUnitsPerDay: 1, budgetCost: 6500 },
    { id: "A2020", wbs: "2 Demolition & Protection", name: "Demolition — Walls & Ceilings", duration: 8, percentComplete: 100, resourceName: "Demo Crew", resourceUnitsPerDay: 4, budgetCost: 32000 },
    { id: "A2030", wbs: "2 Demolition & Protection", name: "Temporary Protection & Dust Walls", duration: 3, percentComplete: 100, resourceName: "Carpenters", resourceUnitsPerDay: 2, budgetCost: 7500 },
    { id: "A2040", wbs: "2 Demolition & Protection", name: "Haul-Off & Disposal", duration: 4, percentComplete: 100, resourceName: "Demo Crew", resourceUnitsPerDay: 2, budgetCost: 9200 },

    // 3 — MEP Rough-In
    { id: "A3010", wbs: "3 MEP Rough-In", name: "MEP Coordination Drawings", duration: 10, percentComplete: 100, resourceName: "MEP Coord", resourceUnitsPerDay: 1, budgetCost: 14000 },
    { id: "A3020", wbs: "3 MEP Rough-In", name: "Plumbing Rough-In", duration: 10, percentComplete: 90, resourceName: "Plumbing", resourceUnitsPerDay: 2, budgetCost: 42000 },
    { id: "A3030", wbs: "3 MEP Rough-In", name: "HVAC Ductwork Rough-In", duration: 12, percentComplete: 75, resourceName: "HVAC", resourceUnitsPerDay: 3, budgetCost: 68000 },
    { id: "A3040", wbs: "3 MEP Rough-In", name: "Electrical Rough-In", duration: 12, percentComplete: 65, resourceName: "Electrical", resourceUnitsPerDay: 3, budgetCost: 58000 },
    { id: "A3050", wbs: "3 MEP Rough-In", name: "Fire Sprinkler Rough-In", duration: 8, percentComplete: 50, resourceName: "Fire Protection", resourceUnitsPerDay: 2, budgetCost: 22000 },
    { id: "A3060", wbs: "3 MEP Rough-In", name: "MEP Inspections — Rough", duration: 3, percentComplete: 0, resourceName: "Inspector", resourceUnitsPerDay: 1, budgetCost: 2500 },

    // 4 — Framing & Drywall
    { id: "A4010", wbs: "4 Framing & Drywall", name: "Metal Stud Framing", duration: 10, percentComplete: 80, resourceName: "Framers", resourceUnitsPerDay: 4, budgetCost: 38000 },
    { id: "A4020", wbs: "4 Framing & Drywall", name: "In-Wall Blocking & Backing", duration: 4, percentComplete: 25, resourceName: "Carpenters", resourceUnitsPerDay: 2, budgetCost: 6800 },
    { id: "A4030", wbs: "4 Framing & Drywall", name: "Drywall Hang & Tape", duration: 10, percentComplete: 0, resourceName: "Drywall", resourceUnitsPerDay: 5, budgetCost: 41000 },
    { id: "A4040", wbs: "4 Framing & Drywall", name: "Drywall Finish & Prime", duration: 6, percentComplete: 0, resourceName: "Drywall", resourceUnitsPerDay: 3, budgetCost: 18000 },

    // 5 — Ceilings & MEP Trim
    { id: "A5010", wbs: "5 Ceilings & MEP Trim", name: "Ceiling Grid Installation", duration: 6, percentComplete: 0, resourceName: "Acoustical", resourceUnitsPerDay: 3, budgetCost: 16000 },
    { id: "A5020", wbs: "5 Ceilings & MEP Trim", name: "MEP Trim Above Ceiling", duration: 6, percentComplete: 0, resourceName: "MEP", resourceUnitsPerDay: 3, budgetCost: 21000 },
    { id: "A5030", wbs: "5 Ceilings & MEP Trim", name: "Ceiling Tiles", duration: 3, percentComplete: 0, resourceName: "Acoustical", resourceUnitsPerDay: 3, budgetCost: 9000 },

    // 6 — Finishes
    { id: "A6010", wbs: "6 Finishes", name: "Paint — Walls", duration: 8, percentComplete: 0, resourceName: "Painters", resourceUnitsPerDay: 3, budgetCost: 17500 },
    { id: "A6020", wbs: "6 Finishes", name: "Millwork & Casework Install", duration: 10, percentComplete: 0, resourceName: "Millwork", resourceUnitsPerDay: 3, budgetCost: 54000 },
    { id: "A6030", wbs: "6 Finishes", name: "Flooring — LVT & Carpet Tile", duration: 8, percentComplete: 0, resourceName: "Flooring", resourceUnitsPerDay: 3, budgetCost: 36000 },
    { id: "A6040", wbs: "6 Finishes", name: "Doors, Frames & Hardware", duration: 5, percentComplete: 0, resourceName: "Carpenters", resourceUnitsPerDay: 2, budgetCost: 14500 },
    { id: "A6050", wbs: "6 Finishes", name: "Glass & Storefront", duration: 5, percentComplete: 0, resourceName: "Glazing", resourceUnitsPerDay: 2, budgetCost: 23000 },
    { id: "A6060", wbs: "6 Finishes", name: "Plumbing Fixtures & Trim", duration: 4, percentComplete: 0, resourceName: "Plumbing", resourceUnitsPerDay: 2, budgetCost: 11000 },
    { id: "A6070", wbs: "6 Finishes", name: "Electrical Devices & Light Trim", duration: 5, percentComplete: 0, resourceName: "Electrical", resourceUnitsPerDay: 3, budgetCost: 19500 },

    // 7 — Commissioning & Closeout
    { id: "A7010", wbs: "7 Commissioning & Closeout", name: "Punchlist", duration: 5, percentComplete: 0, resourceName: "Supt", resourceUnitsPerDay: 1, budgetCost: 5500 },
    { id: "A7020", wbs: "7 Commissioning & Closeout", name: "Final MEP Inspections", duration: 3, percentComplete: 0, resourceName: "Inspector", resourceUnitsPerDay: 1, budgetCost: 2500 },
    { id: "A7030", wbs: "7 Commissioning & Closeout", name: "Owner Training & Commissioning", duration: 3, percentComplete: 0, resourceName: "MEP", resourceUnitsPerDay: 2, budgetCost: 7500 },
    { id: "A7040", wbs: "7 Commissioning & Closeout", name: "Substantial Completion", duration: 0, percentComplete: 0 },
    { id: "A7050", wbs: "7 Commissioning & Closeout", name: "Closeout Documents & Warranties", duration: 5, percentComplete: 0, resourceName: "PM", resourceUnitsPerDay: 1, budgetCost: 4500 },
  ];

  const dependencies: Dependency[] = [
    { from: "A1010", to: "A1020", type: "FS", lag: 0 },
    { from: "A1010", to: "A1030", type: "FS", lag: 0 },
    { from: "A1020", to: "A2010", type: "FS", lag: 0 },
    { from: "A1030", to: "A2010", type: "FS", lag: 0 },

    { from: "A2010", to: "A2020", type: "FS", lag: 0 },
    { from: "A2010", to: "A2030", type: "FS", lag: 0 },
    { from: "A2020", to: "A2040", type: "FS", lag: 0 },

    { from: "A2030", to: "A3010", type: "SS", lag: 2 },
    { from: "A2040", to: "A3010", type: "FS", lag: 0 },
    { from: "A3010", to: "A3020", type: "FS", lag: 0 },
    { from: "A3010", to: "A3030", type: "FS", lag: 0 },
    { from: "A3010", to: "A3040", type: "FS", lag: 0 },
    { from: "A3010", to: "A3050", type: "FS", lag: 0 },
    { from: "A3020", to: "A3060", type: "FS", lag: 0 },
    { from: "A3030", to: "A3060", type: "FS", lag: 0 },
    { from: "A3040", to: "A3060", type: "FS", lag: 0 },
    { from: "A3050", to: "A3060", type: "FS", lag: 0 },

    { from: "A2020", to: "A4010", type: "FS", lag: 0 },
    { from: "A4010", to: "A4020", type: "FS", lag: 0 },
    { from: "A3060", to: "A4030", type: "FS", lag: 0 },
    { from: "A4020", to: "A4030", type: "FS", lag: 0 },
    { from: "A4030", to: "A4040", type: "FS", lag: 0 },

    { from: "A4040", to: "A5010", type: "FS", lag: 0 },
    { from: "A5010", to: "A5020", type: "FS", lag: 0 },
    { from: "A5020", to: "A5030", type: "FS", lag: 0 },

    { from: "A4040", to: "A6010", type: "FS", lag: 1 },
    { from: "A6010", to: "A6020", type: "FS", lag: 0 },
    { from: "A6010", to: "A6030", type: "FS", lag: 0 },
    { from: "A6020", to: "A6040", type: "FS", lag: 0 },
    { from: "A6030", to: "A6060", type: "FS", lag: 0 },
    { from: "A6030", to: "A6070", type: "FS", lag: 0 },
    { from: "A5030", to: "A6050", type: "FS", lag: 0 },

    { from: "A6040", to: "A7010", type: "FS", lag: 0 },
    { from: "A6050", to: "A7010", type: "FS", lag: 0 },
    { from: "A6060", to: "A7010", type: "FS", lag: 0 },
    { from: "A6070", to: "A7010", type: "FS", lag: 0 },
    { from: "A7010", to: "A7020", type: "FS", lag: 0 },
    { from: "A7020", to: "A7030", type: "FS", lag: 0 },
    { from: "A7030", to: "A7040", type: "FS", lag: 0 },
    { from: "A7030", to: "A7050", type: "SS", lag: 0 },
    { from: "A7050", to: "A7040", type: "FS", lag: 0 },
  ];

  const annotations: Annotation[] = [
    { id: "m-ntp", kind: "milestone", date: "2026-04-06", label: "NTP", taskId: "A1010" },
    { id: "m-permits", kind: "milestone", date: "2026-04-27", label: "Permits Issued", taskId: "A1030" },
    { id: "m-walkthrough", kind: "callout", date: "2026-06-30", label: "Owner Walkthrough" },
    { id: "m-furniture", kind: "callout", date: "2026-07-20", label: "Furniture Delivery" },
    { id: "m-sub", kind: "milestone", date: "2026-08-07", label: "Substantial Completion", taskId: "A7040" },
  ];

  return {
    name: "Commercial Fit-Out (Sample)",
    projectStartDate: "2026-04-06",
    dataDate: "2026-05-22",
    workDays: 31, // Mon–Fri
    holidays: ["2026-05-25"], // Memorial Day
    tasks,
    dependencies,
    annotations,
  };
}

/**
 * Parse a pasted activity list. Accepts CSV/TSV/whitespace separated.
 * Recognized columns (case-insensitive, in order if no header):
 *   id, name, duration, wbs, percent, resource
 * If a header row is detected (contains "name" or "activity"), it is used
 * to map columns. Otherwise the first column is treated as name and the
 * second as duration. Unknown rows produce a sensible default.
 */
export function parsePastedActivities(raw: string): { tasks: Task[]; dependencies: Dependency[] } {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { tasks: [], dependencies: [] };

  const split = (l: string) =>
    l.includes("\t") ? l.split("\t") : l.includes(",") ? l.split(",") : l.split(/\s{2,}|\s\|\s/);

  let header: string[] | null = null;
  const first = split(lines[0]).map((s) => s.trim().toLowerCase());
  if (first.some((h) => /^(name|activity|task|description)$/.test(h))) {
    header = first;
    lines.shift();
  }

  const idx = (key: string) => (header ? header.indexOf(key) : -1);
  const colId = idx("id");
  const colName = header ? Math.max(idx("name"), idx("activity"), idx("task"), idx("description")) : 0;
  const colDur = header ? Math.max(idx("duration"), idx("dur"), idx("days")) : 1;
  const colWbs = idx("wbs");
  const colPct = header ? Math.max(idx("percent"), idx("%"), idx("complete")) : -1;
  const colRes = header ? Math.max(idx("resource"), idx("crew")) : -1;

  const tasks: Task[] = [];
  let seq = 1010;
  for (const line of lines) {
    const cells = split(line).map((s) => s.trim());
    if (cells.length === 0) continue;
    const name = (colName >= 0 ? cells[colName] : cells[0]) || `Activity ${seq}`;
    const durRaw = colDur >= 0 ? cells[colDur] : cells[1];
    const duration = Math.max(0, parseInt(durRaw ?? "1", 10) || 1);
    const id = (colId >= 0 ? cells[colId] : "") || `A${seq}`;
    seq += 10;
    const t: Task = { id, name, duration };
    if (colWbs >= 0 && cells[colWbs]) t.wbs = cells[colWbs];
    if (colPct >= 0 && cells[colPct]) {
      const p = parseFloat(cells[colPct].replace("%", ""));
      if (!Number.isNaN(p)) t.percentComplete = Math.max(0, Math.min(100, p));
    }
    if (colRes >= 0 && cells[colRes]) t.resourceName = cells[colRes];
    tasks.push(t);
  }

  // Chain into a simple FS waterfall so the user sees bars immediately.
  const dependencies: Dependency[] = [];
  for (let i = 1; i < tasks.length; i++) {
    dependencies.push({ from: tasks[i - 1].id, to: tasks[i].id, type: "FS", lag: 0 });
  }
  return { tasks, dependencies };
}
