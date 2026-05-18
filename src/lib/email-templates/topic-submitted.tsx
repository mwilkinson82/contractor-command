import React from "react";
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from "@react-email/components";
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

const main = { backgroundColor: "#ffffff", fontFamily: "Georgia, 'Times New Roman', serif" };
const container = { padding: "28px 28px", maxWidth: "620px" };
const eyebrow = { fontSize: "10px", letterSpacing: "0.22em", color: "#7a7a7a", margin: "0 0 8px", fontWeight: 600 as const, fontFamily: "Arial, sans-serif" };
const h1 = { fontSize: "22px", color: "#111", margin: "0 0 6px", lineHeight: 1.25 };
const meta = { fontSize: "13px", color: "#555", margin: 0, fontFamily: "Arial, sans-serif" };
const hr = { borderColor: "#e6e3dc", margin: "18px 0" };
const label = { fontSize: "10px", letterSpacing: "0.18em", color: "#7a7a7a", margin: "10px 0 4px", fontWeight: 600 as const, textTransform: "uppercase" as const, fontFamily: "Arial, sans-serif" };
const body = { fontSize: "14px", color: "#222", margin: "0 0 6px", lineHeight: 1.55 };
const footer = { fontSize: "12px", color: "#888", margin: 0, fontFamily: "Arial, sans-serif" };
