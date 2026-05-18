import React from "react";
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

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
        <Text style={eyebrow}>YOUR TOPIC WAS SELECTED</Text>
        <Heading style={h1}>
          {submitterName ? `${submitterName}, ` : ""}you're on the agenda.
        </Heading>
        <Text style={body}>
          Marshall pulled your topic — <strong>{title}</strong> — into the next{" "}
          <strong>{kind}</strong>{sessionDate ? ` on ${sessionDate}` : ""}.
        </Text>
        <Text style={body}>
          Come ready to be in the chair. Bring the numbers, the names, and the
          specific decision you're stuck on. The prep you did in your submission
          is the starting point — Marshall will pressure-test from there.
        </Text>
        {zoomUrl && (
          <Text style={body}>
            Join link: <a href={zoomUrl} style={link}>{zoomUrl}</a>
          </Text>
        )}
        <Hr style={hr} />
        <Text style={footer}>— Contractor Circle</Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: TopicSelectedEmail,
  subject: (d: Record<string, any>) =>
    `You're on the agenda — ${d.kind || "next call"}`,
  displayName: "Topic selected (member)",
  previewData: {
    submitterName: "Jane",
    kind: "Biweekly Call",
    title: "Crew can't read estimates",
    sessionDate: "Sun, Jun 8 · 5:00 PM ET",
    zoomUrl: "https://zoom.us/j/0000000000",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Georgia, 'Times New Roman', serif" };
const container = { padding: "32px 28px", maxWidth: "560px" };
const eyebrow = { fontSize: "10px", letterSpacing: "0.22em", color: "#E4573D", margin: "0 0 10px", fontWeight: 700 as const, fontFamily: "Arial, sans-serif" };
const h1 = { fontSize: "26px", color: "#111", margin: "0 0 16px", lineHeight: 1.2 };
const body = { fontSize: "15px", color: "#222", margin: "0 0 14px", lineHeight: 1.6 };
const link = { color: "#111", textDecoration: "underline" };
const hr = { borderColor: "#e6e3dc", margin: "22px 0" };
const footer = { fontSize: "12px", color: "#888", margin: 0, fontFamily: "Arial, sans-serif" };
