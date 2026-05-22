import type { Dependency, Task } from "./types";

export interface Fragnet {
  id: string;
  name: string;
  description: string;
  category: "Sitework" | "Concrete" | "Framing" | "MEP" | "Finishes" | "Closeout";
  /** Tasks inside the fragnet — local IDs are unique within the fragnet only. */
  items: Array<Omit<Task, "id"> & { localId: string }>;
  /** Dependencies use the localIds above. */
  links: Array<Omit<Dependency, "from" | "to"> & { from: string; to: string }>;
}

type FragnetDef = Fragnet;

export const FRAGNETS: FragnetDef[] = [
  {
    id: "concrete-pour-week",
    name: "Concrete pour week",
    description: "Layout → form → rebar → inspection → pour → strip & cure.",
    category: "Concrete",
    items: [
      { localId: "LAY", name: "Layout & survey", duration: 1, wbs: "03 Concrete" },
      { localId: "FRM", name: "Form work", duration: 2, wbs: "03 Concrete" },
      { localId: "RBR", name: "Rebar & embeds", duration: 2, wbs: "03 Concrete" },
      { localId: "INS", name: "Pre-pour inspection", duration: 1, wbs: "03 Concrete" },
      { localId: "PUR", name: "Pour & finish", duration: 1, wbs: "03 Concrete" },
      { localId: "CUR", name: "Strip & cure", duration: 3, wbs: "03 Concrete" },
    ],
    links: [
      { from: "LAY", to: "FRM", type: "FS" },
      { from: "FRM", to: "RBR", type: "SS", lag: 1 },
      { from: "RBR", to: "INS", type: "FS" },
      { from: "INS", to: "PUR", type: "FS" },
      { from: "PUR", to: "CUR", type: "FS" },
    ],
  },
  {
    id: "interior-roughin",
    name: "Interior rough-in",
    description: "Framing → MEP rough → in-wall inspections → insulation → drywall hang.",
    category: "MEP",
    items: [
      { localId: "FRM", name: "Framing & blocking", duration: 5, wbs: "06 Wood" },
      { localId: "PLB", name: "Plumbing rough", duration: 4, wbs: "22 Plumbing" },
      { localId: "ELE", name: "Electrical rough", duration: 4, wbs: "26 Electrical" },
      { localId: "HVC", name: "HVAC rough", duration: 4, wbs: "23 HVAC" },
      { localId: "IWI", name: "In-wall inspection", duration: 1, wbs: "01 General" },
      { localId: "INS", name: "Insulation", duration: 2, wbs: "07 Thermal" },
      { localId: "DWH", name: "Drywall hang", duration: 3, wbs: "09 Interiors" },
    ],
    links: [
      { from: "FRM", to: "PLB", type: "FS" },
      { from: "FRM", to: "ELE", type: "FS" },
      { from: "FRM", to: "HVC", type: "FS" },
      { from: "PLB", to: "IWI", type: "FS" },
      { from: "ELE", to: "IWI", type: "FS" },
      { from: "HVC", to: "IWI", type: "FS" },
      { from: "IWI", to: "INS", type: "FS" },
      { from: "INS", to: "DWH", type: "FS" },
    ],
  },
  {
    id: "interior-finishes",
    name: "Interior finishes",
    description: "Tape & finish → prime → paint → flooring → trim → devices.",
    category: "Finishes",
    items: [
      { localId: "TAP", name: "Tape & finish", duration: 4, wbs: "09 Interiors" },
      { localId: "PRM", name: "Prime walls", duration: 1, wbs: "09 Interiors" },
      { localId: "PNT", name: "Paint", duration: 3, wbs: "09 Interiors" },
      { localId: "FLR", name: "Flooring", duration: 4, wbs: "09 Interiors" },
      { localId: "TRM", name: "Trim & doors", duration: 3, wbs: "08 Openings" },
      { localId: "DEV", name: "Devices & plates", duration: 2, wbs: "26 Electrical" },
    ],
    links: [
      { from: "TAP", to: "PRM", type: "FS" },
      { from: "PRM", to: "PNT", type: "FS" },
      { from: "PNT", to: "FLR", type: "FS" },
      { from: "FLR", to: "TRM", type: "FS" },
      { from: "TRM", to: "DEV", type: "FS" },
    ],
  },
  {
    id: "sitework-startup",
    name: "Sitework startup",
    description: "Mobilize → erosion control → strip & grub → mass excavation.",
    category: "Sitework",
    items: [
      { localId: "MOB", name: "Mobilize", duration: 2, wbs: "01 General" },
      { localId: "ESC", name: "Erosion & sediment control", duration: 1, wbs: "31 Earthwork" },
      { localId: "STR", name: "Strip & grub", duration: 2, wbs: "31 Earthwork" },
      { localId: "EXC", name: "Mass excavation", duration: 5, wbs: "31 Earthwork" },
    ],
    links: [
      { from: "MOB", to: "ESC", type: "FS" },
      { from: "ESC", to: "STR", type: "FS" },
      { from: "STR", to: "EXC", type: "SS", lag: 1 },
    ],
  },
  {
    id: "closeout",
    name: "Closeout",
    description: "Punch list → final inspections → commissioning → owner training → TCO.",
    category: "Closeout",
    items: [
      { localId: "PCH", name: "Punch list", duration: 5, wbs: "01 General" },
      { localId: "CXG", name: "Commissioning", duration: 3, wbs: "01 General" },
      { localId: "FIN", name: "Final inspections", duration: 2, wbs: "01 General" },
      { localId: "TRN", name: "Owner training", duration: 1, wbs: "01 General" },
      { localId: "TCO", name: "TCO / occupancy", duration: 1, wbs: "01 General" },
    ],
    links: [
      { from: "PCH", to: "CXG", type: "SS", lag: 2 },
      { from: "CXG", to: "FIN", type: "FS" },
      { from: "FIN", to: "TRN", type: "FS" },
      { from: "TRN", to: "TCO", type: "FS" },
    ],
  },
];

/**
 * Insert a fragnet into an existing task list.
 *
 * - Local IDs are prefixed with `prefix` to avoid collisions (e.g. "C1_LAY").
 * - If `attachToTaskId` is provided, the first task in the fragnet gets an FS
 *   predecessor from that activity.
 */
export function insertFragnet(
  existing: { tasks: Task[]; dependencies: Dependency[] },
  fragnetId: string,
  opts: { prefix: string; attachToTaskId?: string },
): { tasks: Task[]; dependencies: Dependency[]; addedIds: string[] } {
  const def = FRAGNETS.find((f) => f.id === fragnetId);
  if (!def) throw new Error(`Unknown fragnet: ${fragnetId}`);

  const prefix = opts.prefix.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12) || "X";
  const taken = new Set(existing.tasks.map((t) => t.id));
  const map = new Map<string, string>();
  for (const item of def.items) {
    let candidate = `${prefix}_${item.localId}`;
    let n = 2;
    while (taken.has(candidate)) {
      candidate = `${prefix}_${item.localId}_${n++}`;
    }
    taken.add(candidate);
    map.set(item.localId, candidate);
  }

  const newTasks: Task[] = def.items.map((item) => ({
    id: map.get(item.localId)!,
    name: item.name,
    duration: item.duration,
    wbs: item.wbs,
    description: item.description,
  }));

  const newDeps: Dependency[] = def.links.map((l) => ({
    from: map.get(l.from)!,
    to: map.get(l.to)!,
    type: l.type ?? "FS",
    lag: l.lag ?? 0,
  }));

  // Optional attachment
  const firstLocal = def.items[0]?.localId;
  if (opts.attachToTaskId && firstLocal && taken.has(opts.attachToTaskId)) {
    newDeps.unshift({
      from: opts.attachToTaskId,
      to: map.get(firstLocal)!,
      type: "FS",
      lag: 0,
    });
  }

  return {
    tasks: [...existing.tasks, ...newTasks],
    dependencies: [...existing.dependencies, ...newDeps],
    addedIds: Array.from(map.values()),
  };
}
