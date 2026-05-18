import React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface SopStep {
  number?: number;
  action: string;
  detail?: string;
}

interface SopEmailProps {
  title?: string;
  department?: string;
  owner?: string;
  purpose?: string;
  scope?: string;
  trigger?: string;
  inputs?: string[];
  steps?: SopStep[];
  outputs?: string[];
  definitionOfDone?: string;
  kpis?: string[];
  exceptions?: string[];
  revisionCadence?: string;
  senderName?: string;
  note?: string;
}

const SopEmail = ({
  title = "Standard Operating Procedure",
  department,
  owner,
  purpose,
  scope,
  trigger,
  inputs = [],
  steps = [],
  outputs = [],
  definitionOfDone,
  kpis = [],
  exceptions = [],
  revisionCadence,
  senderName,
  note,
}: SopEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`SOP · ${title}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>STANDARD OPERATING PROCEDURE</Text>
        <Heading style={h1}>{title}</Heading>

        {(department || owner) && (
          <Text style={metaLine}>
            {department ? <span><strong>Department:</strong> {department}</span> : null}
            {department && owner ? <span style={dot}>·</span> : null}
            {owner ? <span><strong>Owner:</strong> {owner}</span> : null}
          </Text>
        )}

        {note ? (
          <Section style={noteBox}>
            <Text style={noteText}>{note}</Text>
          </Section>
        ) : null}

        {purpose ? <Field label="Purpose" value={purpose} /> : null}
        {scope ? <Field label="Scope" value={scope} /> : null}
        {trigger ? <Field label="Trigger" value={trigger} /> : null}

        {inputs.length > 0 ? <ListField label="Inputs" items={inputs} /> : null}

        {steps.length > 0 ? (
          <>
            <Hr style={hr} />
            <Text style={sectionLabel}>Procedure</Text>
            <ol style={ol}>
              {steps.map((s, i) => (
                <li key={i} style={li}>
                  <Text style={stepAction}>{s.action}</Text>
                  {s.detail ? <Text style={stepDetail}>{s.detail}</Text> : null}
                </li>
              ))}
            </ol>
          </>
        ) : null}

        {outputs.length > 0 ? <ListField label="Outputs" items={outputs} /> : null}
        {definitionOfDone ? <Field label="Definition of done" value={definitionOfDone} /> : null}
        {kpis.length > 0 ? <ListField label="KPIs" items={kpis} /> : null}
        {exceptions.length > 0 ? <ListField label="Exceptions / escalation" items={exceptions} /> : null}
        {revisionCadence ? <Field label="Revision cadence" value={revisionCadence} /> : null}

        <Hr style={hr} />
        <Text style={footer}>
          Sent{senderName ? ` by ${senderName}` : ""} from AOS — the Altitude Operating System.
        </Text>
      </Container>
    </Body>
  </Html>
);

function Field({ label, value }: { label: string; value: string }) {
  return (
    <Section style={{ marginTop: "18px" }}>
      <Text style={sectionLabel}>{label}</Text>
      <Text style={bodyText}>{value}</Text>
    </Section>
  );
}

function ListField({ label, items }: { label: string; items: string[] }) {
  return (
    <Section style={{ marginTop: "18px" }}>
      <Text style={sectionLabel}>{label}</Text>
      <ul style={ul}>
        {items.map((it, i) => (
          <li key={i} style={liPlain}><Text style={bodyText}>{it}</Text></li>
        ))}
      </ul>
    </Section>
  );
}

export const template = {
  component: SopEmail,
  subject: (data: Record<string, any>) =>
    `SOP · ${(data?.title as string) || "Standard Operating Procedure"}`,
  displayName: "SOP document",
  previewData: {
    title: "Pre-Con Hand-off Protocol",
    department: "Operations",
    owner: "Project Manager",
    purpose: "Ensure every signed contract becomes a runnable project plan with zero scope gaps.",
    scope: "From contract signature through the first weekly OAC meeting.",
    trigger: "Contract executed in DocuSign.",
    inputs: ["Signed contract", "Bid recap PDF", "Scope-of-work tab"],
    steps: [
      { action: "Open the Pre-Con folder in SharePoint.", detail: "Path: /Projects/{Job#}/01_PreCon" },
      { action: "Copy the Bid Recap PDF into /02_Handoff." },
      { action: "Verify scope-of-work tab row 12 matches Exhibit A.", detail: "Flag any deltas to the Estimator same day." },
    ],
    outputs: ["Signed hand-off form", "Populated /02_Handoff folder"],
    definitionOfDone: "PM can run the kickoff meeting without re-asking Estimating any scope question.",
    kpis: ["Hand-off lead time < 3 days", "Zero scope-gap RFIs in first 30 days"],
    exceptions: ["Missing Exhibit A → escalate to Estimator + Owner same day."],
    revisionCadence: "Quarterly",
    senderName: "Marshall",
  },
} satisfies TemplateEntry;

/* ---------- styles ---------- */

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "28px 28px 36px", maxWidth: "640px" };
const eyebrow = {
  fontSize: "10px",
  letterSpacing: "0.22em",
  color: "#7a7a7a",
  margin: "0 0 6px",
  fontWeight: 600 as const,
};
const h1 = {
  fontSize: "24px",
  fontWeight: 700 as const,
  color: "#111111",
  margin: "0 0 10px",
  lineHeight: 1.2,
};
const metaLine = { fontSize: "13px", color: "#444444", margin: "0 0 8px" };
const dot = { padding: "0 8px", color: "#bbb" };
const noteBox = {
  marginTop: "14px",
  padding: "12px 14px",
  background: "#f6f4ee",
  borderLeft: "3px solid #111111",
  borderRadius: "4px",
};
const noteText = { fontSize: "13px", color: "#222", margin: 0, lineHeight: 1.5 };
const sectionLabel = {
  fontSize: "10px",
  letterSpacing: "0.22em",
  color: "#7a7a7a",
  margin: "0 0 4px",
  fontWeight: 600 as const,
  textTransform: "uppercase" as const,
};
const bodyText = { fontSize: "13.5px", color: "#222222", margin: "0 0 4px", lineHeight: 1.55 };
const stepAction = { fontSize: "14px", color: "#111111", margin: "0 0 2px", fontWeight: 600 as const };
const stepDetail = { fontSize: "13px", color: "#555555", margin: "0 0 4px", lineHeight: 1.5 };
const ol = { paddingLeft: "20px", margin: "8px 0 0" };
const ul = { paddingLeft: "18px", margin: "6px 0 0" };
const li = { margin: "0 0 10px" };
const liPlain = { margin: "0 0 2px" };
const hr = { borderColor: "#e6e3dc", margin: "22px 0" };
const footer = { fontSize: "11px", color: "#888", margin: 0 };
