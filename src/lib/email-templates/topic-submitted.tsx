import React from "react";
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from "@react-email/components";
import { emailBrand } from "./_brand";
import type { TemplateEntry } from "./registry";

interface TopicSubmittedProps {
  submitterName?: string;
  submitterEmail?: string;
  kind?: string;
  title?: string;
  needsPressure?: string;
  alreadyTried?: string;
  decisionAvoided?: string;
  financialConsequence?: string;
  winLooksLike?: string;
  adminUrl?: string;
}

const TopicSubmittedEmail = ({
  submitterName,
  submitterEmail,
  kind = "Call",
  title = "(no title)",
  needsPressure,
  alreadyTried,
  decisionAvoided,
  financialConsequence,
  winLooksLike,
  adminUrl,
}: TopicSubmittedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>New {kind} topic from {submitterName || submitterEmail || "a member"}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>NEW TOPIC · {kind.toUpperCase()}</Text>
        <Heading style={h1}>{title}</Heading>
        <Text style={meta}>
          From {submitterName || "—"}{submitterEmail ? ` · ${submitterEmail}` : ""}
        </Text>
        <Hr style={hr} />

        {needsPressure && (<Section><Text style={label}>What needs pressure?</Text><Text style={body}>{needsPressure}</Text></Section>)}
        {alreadyTried && (<Section><Text style={label}>Already tried</Text><Text style={body}>{alreadyTried}</Text></Section>)}
        {decisionAvoided && (<Section><Text style={label}>Decision avoided</Text><Text style={body}>{decisionAvoided}</Text></Section>)}
        {financialConsequence && (<Section><Text style={label}>Financial consequence</Text><Text style={body}>{financialConsequence}</Text></Section>)}
        {winLooksLike && (<Section><Text style={label}>Win looks like</Text><Text style={body}>{winLooksLike}</Text></Section>)}

        <Hr style={hr} />
        <Text style={footer}>
          Review and select in the admin queue{adminUrl ? `: ${adminUrl}` : ""}.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: TopicSubmittedEmail,
  subject: (d: Record<string, any>) =>
    `New ${d.kind || "Call"} topic: ${d.title || "(untitled)"}`,
  displayName: "Call topic submitted (admin)",
  previewData: {
    submitterName: "Jane Contractor",
    submitterEmail: "jane@example.com",
    kind: "Biweekly Call",
    title: "Crew can't read estimates",
    needsPressure: "Estimators keep handing crews unreadable scope.",
    alreadyTried: "Standardized template, but field skips it.",
    decisionAvoided: "Firing the estimator who refuses.",
    financialConsequence: "~$8k/mo in rework.",
    winLooksLike: "Zero scope questions on Monday handoff.",
    adminUrl: "https://contractor-command.lovable.app/admin/topics",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: emailBrand.cream, fontFamily: emailBrand.sans, padding: "32px 0" };
const container = {
  backgroundColor: emailBrand.workSurface,
  border: `1px solid ${emailBrand.paperEdge}`,
  borderRadius: "12px",
  maxWidth: "620px",
  padding: "28px 28px",
};
const eyebrow = { fontSize: "11px", letterSpacing: "0.18em", color: emailBrand.signal, margin: "0 0 8px", fontWeight: 700 as const, fontFamily: emailBrand.sans, textTransform: "uppercase" as const };
const h1 = { fontSize: "22px", color: emailBrand.ink, margin: "0 0 6px", lineHeight: 1.25, fontWeight: 650 as const };
const meta = { fontSize: "13px", color: emailBrand.muted, margin: 0, fontFamily: emailBrand.sans };
const hr = { borderColor: emailBrand.paperEdge, margin: "18px 0" };
const label = { fontSize: "11px", letterSpacing: "0.18em", color: emailBrand.muted, margin: "10px 0 4px", fontWeight: 700 as const, textTransform: "uppercase" as const, fontFamily: emailBrand.sans };
const body = { fontSize: "14px", color: emailBrand.ink, margin: "0 0 6px", lineHeight: 1.55 };
const footer = { fontSize: "12px", color: emailBrand.muted, margin: 0, fontFamily: emailBrand.sans };
