import { calculateSchedule } from "@/lib/scheduler/engine";
import { bridgeLegacyScheduleToEngine2, instantToIsoDate } from "@/lib/scheduler/engine2/legacy-bridge";
import { calculateCpm } from "@/lib/scheduler/engine2/cpm";
import type { Schedule } from "@/lib/scheduler/types";

const s: Schedule = {
  name: "fs-chain",
  projectStartDate: "2026-06-01",
  calendar: { workDays: 31, holidays: [] },
  tasks: [
    { id: "A", name: "Site prep", duration: 3 },
    { id: "B", name: "Foundations", duration: 5 },
    { id: "C", name: "Framing", duration: 7 },
    { id: "D", name: "Roofing", duration: 4 },
    { id: "E", name: "Closeout", duration: 2 },
  ],
  dependencies: [
    { from: "A", to: "B", type: "FS", lag: 0 },
    { from: "B", to: "C", type: "FS", lag: 0 },
    { from: "C", to: "D", type: "FS", lag: 0 },
    { from: "D", to: "E", type: "FS", lag: 0 },
  ],
};

const legacy = calculateSchedule(s);
const bridge = bridgeLegacyScheduleToEngine2(s);
const e2 = calculateCpm(bridge.input);

console.log("LEGACY finish:", legacy.projectFinishDate);
console.log("ENGINE2 finish raw:", e2.projectFinish, "iso:", new Date(e2.projectFinish).toISOString());
console.log("\nLEGACY tasks:");
for (const lt of legacy.tasks) {
  console.log(`  ${lt.id}: ES=${lt.earlyStartDate} EF=${lt.earlyFinishDate} TF=${lt.totalFloat} crit=${lt.isCritical}`);
}
console.log("\nENGINE2 activities:");
for (const a of e2.activities) {
  console.log(`  ${a.id}: ES=${new Date(a.earlyStart).toISOString()} EF=${new Date(a.earlyFinish).toISOString()} TF(min)=${a.totalFloatMinutes} crit=${a.isCritical}`);
}
