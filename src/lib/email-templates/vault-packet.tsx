import React from "react";
import {
  Body, Container, Head, Heading, Hr, Html, Preview, Section, Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface VaultPacketProps {
  senderName?: string;
  senderEmail?: string;
  note?: string;
  source?: string;
  title?: string;
  /** Pre-formatted packet body (plain text). Rendered as monospace block. */
  body?: string;
}

const VaultPacketEmail = ({
  senderName,
  senderEmail,
  note,
  source = "Command Tool",
  title = "Vault packet",
  body = "",
}: VaultPacketProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${source} — ${title}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={eyebrow}>{source.toUpperCase()}</Text>
        <Heading style={h1}>{title}</Heading>
        <Text style={meta}>
          Shared by {senderName || senderEmail || "an ALP Contractor Circle member"}
          {senderEmail ? ` · ${senderEmail}` : ""}
        </Text>

        {note ? (
          <Section style={noteBox}>
            <Text style={noteText}>{note}</Text>
          </Section>
        ) : null}

        <Hr style={hr} />
        <Text style={label}>Packet</Text>
        <pre style={pre}>{body}</pre>

        <Hr style={hr} />
        <Text style={footer}>
          Generated in the ALP Contractor Circle Operator's Workbench.
        </Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: VaultPacketEmail,
  subject: (d: Record<string, any>) =>
    `${d?.source || "Vault"} — ${d?.title || "Packet"}`,
  displayName: "Vault packet share",
  previewData: {
    senderName: "Jane Contractor",
    senderEmail: "jane@example.com",
    source: "Margin Leak Detector",
    title: "Q3 margin slide",
    note: "Sharing this with you so we can talk through it Monday.",
    body: "WHAT WE FOUND\nMargin slipped 4.2pts QoQ on T&M work.\n\nPRIMARY CONSTRAINT\nNo change-order discipline in the field.",
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "28px 28px 36px", maxWidth: "640px" };
const eyebrow = { fontSize: "10px", letterSpacing: "0.22em", color: "#7a7a7a", margin: "0 0 6px", fontWeight: 600 as const };
const h1 = { fontSize: "22px", fontWeight: 700 as const, color: "#111111", margin: "0 0 8px", lineHeight: 1.25 };
const meta = { fontSize: "13px", color: "#555", margin: 0 };
const noteBox = { marginTop: "16px", padding: "12px 14px", background: "#f6f4ee", borderLeft: "3px solid #111111", borderRadius: "4px" };
const noteText = { fontSize: "13.5px", color: "#222", margin: 0, lineHeight: 1.5 };
const hr = { borderColor: "#e6e3dc", margin: "20px 0" };
const label = { fontSize: "10px", letterSpacing: "0.22em", color: "#7a7a7a", margin: "0 0 8px", fontWeight: 600 as const, textTransform: "uppercase" as const };
const pre = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12.5px", color: "#222", margin: 0, padding: "12px 14px", background: "#fafaf7", border: "1px solid #ececec", borderRadius: "6px", whiteSpace: "pre-wrap" as const, lineHeight: 1.55 };
const footer = { fontSize: "11px", color: "#888", margin: 0 };
