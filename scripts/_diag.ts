import { calculateSchedule } from "@/lib/scheduler/engine";
import { bridgeLegacyScheduleToEngine2 } from "@/lib/scheduler/engine2/legacy-bridge";
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
const e2 = calculateCpm(bridgeLegacyScheduleToEngine2(s).input);
const iso = (ms: number) => new Date(ms).toISOString();
const ymd = (ms: number) => iso(ms).slice(0, 10);
const e2Finish = e2.activities.reduce((m, a) => Math.max(m, a.earlyFinish), 0);

console.log("LEGACY finish:", legacy.projectFinishDate, " ENGINE2 finish:", ymd(e2Finish), `(${iso(e2Finish)})`);
console.log("\nid | legES        legEF        | e2 ES                       e2 EF                       | dES(d) dEF(d)");
for (const lt of legacy.tasks) {
  const er = e2.activities.find(a => a.id === lt.id)!;
  const dES = Math.round((Date.parse(ymd(er.earlyStart)+"T00:00:00Z") - Date.parse(lt.earlyStartDate!+"T00:00:00Z"))/86400000);
  const dEF = Math.round((Date.parse(ymd(er.earlyFinish)+"T00:00:00Z") - Date.parse(lt.earlyFinishDate!+"T00:00:00Z"))/86400000);
  console.log(`${lt.id}  | ${lt.earlyStartDate}  ${lt.earlyFinishDate}  | ${iso(er.earlyStart)}  ${iso(er.earlyFinish)}  | ${dES}      ${dEF}`);
}
