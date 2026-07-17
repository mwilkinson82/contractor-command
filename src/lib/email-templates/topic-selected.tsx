import React from "react";
import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";
import { emailBrand } from "./_brand";
import type { TemplateEntry } from "./registry";
import { ContractorCircleEmailFooter, ContractorCircleEmailHeader } from "./_brand-components";

interface TopicSelectedProps {
  submitterName?: string;
  kind?: string;
  title?: string;
  sessionDate?: string;
  zoomUrl?: string;
}

const TopicSelectedEmail = ({
  submitterName,
  kind = "Call",
  title = "your topic",
  sessionDate,
  zoomUrl,
}: TopicSelectedProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your topic is on the agenda for the next {kind}</Preview>
    <Body style={main}>
      <Container style={container}>
        <ContractorCircleEmailHeader label="Contractor Circle call" />
        <Text style={eyebrow}>YOUR TOPIC WAS SELECTED</Text>
        <Heading style={h1}>
          {submitterName ? `${submitterName}, ` : ""}you're on the agenda.
        </Heading>
        <Text style={body}>
          Marshall pulled your topic — <strong>{title}</strong> — into the next{" "}
          <strong>{kind}</strong>
          {sessionDate ? ` on ${sessionDate}` : ""}.
        </Text>
        <Text style={body}>
          Come ready to be in the chair. Bring the numbers, the names, and the specific decision
          you're stuck on. The prep you did in your submission is the starting point — Marshall will
          pressure-test from there.
        </Text>
        {zoomUrl && (
          <Text style={body}>
            Join link:{" "}
            <a href={zoomUrl} style={link}>
              {zoomUrl}
            </a>
          </Text>
        )}
        <Hr style={hr} />
        <Text style={footer}>— Contractor Circle</Text>
        <ContractorCircleEmailFooter />
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: TopicSelectedEmail,
  subject: (d: Record<string, unknown>) =>
    `You're on the agenda — ${typeof d.kind === "string" ? d.kind : "next call"}`,
  displayName: "Topic selected (member)",
  previewData: {
    submitterName: "Jane",
    kind: "Biweekly Call",
    title: "Crew can't read estimates",
    sessionDate: "Sun, Jun 8 · 5:00 PM ET",
    zoomUrl: "https://zoom.us/j/0000000000",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: emailBrand.cream, fontFamily: emailBrand.sans, padding: "32px 0" };
const container = {
  backgroundColor: emailBrand.workSurface,
  border: `1px solid ${emailBrand.paperEdge}`,
  borderRadius: "12px",
  maxWidth: "560px",
  padding: "32px 28px",
};
const eyebrow = {
  fontSize: "11px",
  letterSpacing: "0.18em",
  color: emailBrand.signal,
  margin: "0 0 10px",
  fontWeight: 700 as const,
  fontFamily: emailBrand.sans,
  textTransform: "uppercase" as const,
};
const h1 = {
  fontSize: "26px",
  color: emailBrand.ink,
  margin: "0 0 16px",
  lineHeight: 1.2,
  fontWeight: 650 as const,
};
const body = { fontSize: "15px", color: emailBrand.ink, margin: "0 0 14px", lineHeight: 1.6 };
const link = { color: emailBrand.signal, textDecoration: "underline" };
const hr = { borderColor: emailBrand.paperEdge, margin: "22px 0" };
const footer = {
  fontSize: "12px",
  color: emailBrand.muted,
  margin: 0,
  fontFamily: emailBrand.sans,
};
