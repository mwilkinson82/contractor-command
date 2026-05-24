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
console.log("ENGINE2 finish:", instantToIsoDate(e2.projectFinish));
console.log("\nid | legES legEF | e2ES e2EF | dES dEF");
for (const lt of legacy.tasks) {
  const er = e2.activities.find(a => a.id === lt.id)!;
  const e2ES = instantToIsoDate(er.earlyStart);
  const e2EF = instantToIsoDate(er.earlyFinish);
  const dES = (Date.parse(e2ES+"T00:00:00Z") - Date.parse(lt.earlyStartDate!+"T00:00:00Z"))/86400000;
  const dEF = (Date.parse(e2EF+"T00:00:00Z") - Date.parse(lt.earlyFinishDate!+"T00:00:00Z"))/86400000;
  console.log(`${lt.id} | ${lt.earlyStartDate} ${lt.earlyFinishDate} | ${e2ES} ${e2EF} | ${dES}d ${dEF}d`);
}
