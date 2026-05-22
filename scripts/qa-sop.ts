import { jsPDF } from "jspdf";
import fs from "fs";
// quick local type
type SopDocument = any;
import { renderSopToPdf } from "./_renderer";

const doc: SopDocument = {
  title: "Pre-Con to Ground PM Intake",
  department: "Operations",
  owner: "Project Manager",
  purpose: "Ensure every signed contract becomes a runnable project plan with zero scope gaps and a clean field hand-off within 72 hours.",
  scope: "From contract signature through the first weekly OAC meeting. Out of scope: client billing setup and subcontractor onboarding.",
  trigger: "Contract executed in DocuSign and bid recap finalized by Estimator.",
  inputs: [
    "Signed contract (PDF)",
    "Bid Recap PDF from Estimating",
    "Scope-of-work tab from estimate workbook",
    "Owner contact list and project directory",
  ],
  steps: [
    { number: 1, action: "Open the Pre-Con folder in SharePoint and locate the active project record.", detail: "Path: /Projects/{Job#}/01_PreCon. Confirm you have the latest version before making any edits." },
    { number: 2, action: "Copy the Bid Recap PDF into /02_Handoff and rename with job number prefix.", detail: "Format: {Job#}_BidRecap_{YYYYMMDD}.pdf" },
    { number: 3, action: "Verify scope-of-work tab row 12 matches Exhibit A line-by-line.", detail: "Flag any deltas to the Estimator same day. Do not assume Exhibit A wins by default — confirm intent with Owner." },
    { number: 4, action: "Populate the Project Directory in BuilderTrend with all stakeholder contacts.", detail: "Include: Owner, Architect, all Engineers of Record, key Subs, AHJ inspector." },
    { number: 5, action: "Build the preliminary CPM schedule and circulate for review.", detail: "Use phase template; mark long-lead items in red." },
    { number: 6, action: "Schedule the kickoff meeting within 5 business days of contract signature.", detail: "Mandatory attendees: PM, Superintendent, Estimator, Owner rep." },
    { number: 7, action: "Issue the hand-off packet to the assigned Superintendent.", detail: "Packet must include: signed contract, bid recap, schedule, directory, decision log." },
    { number: 8, action: "Close out the Pre-Con record and update the project scorecard." },
  ],
  outputs: [
    "Signed hand-off form",
    "Populated /02_Handoff folder",
    "Preliminary CPM schedule",
    "Kickoff meeting on the calendar",
  ],
  definitionOfDone: "Superintendent can run the kickoff meeting without re-asking Estimating any scope question.",
  kpis: [
    "Hand-off lead time -> < 3 days",
    "Scope-gap RFIs in first 30 days -> 0",
    "Rework events per 10 completions -> < 1",
  ],
  exceptions: [
    "Missing Exhibit A -> escalate to Estimator + Owner same day, do not start hand-off.",
    "Scope change discovered mid-execution -> pause, log in decision register, escalate to PM lead before proceeding.",
    "Superintendent rejects the packet -> reopen this SOP, log root cause in scorecard, do not silently fix.",
  ],
  revisionCadence: "Quarterly, or after 2 consecutive weeks of escalation breaches.",
};

const pdf = new jsPDF({ unit: "pt", format: "letter" });
renderSopToPdf(pdf, doc);
fs.writeFileSync("/tmp/sopqa/out.pdf", Buffer.from(pdf.output("arraybuffer")));
console.log("pages:", pdf.getNumberOfPages());
