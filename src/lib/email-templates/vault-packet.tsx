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
import { emailBrand, emailStyles } from "./_brand";
import type { TemplateEntry } from "./registry";
import { ContractorCircleEmailFooter, ContractorCircleEmailHeader } from "./_brand-components";

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
        <ContractorCircleEmailHeader label="Company Vault" />
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
        <Text style={footer}>Generated in the ALP Contractor Circle Operator's Workbench.</Text>
        <ContractorCircleEmailFooter />
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: VaultPacketEmail,
  subject: (d: Record<string, unknown>) =>
    `${typeof d?.source === "string" ? d.source : "Vault"} — ${
      typeof d?.title === "string" ? d.title : "Packet"
    }`,
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

const main = { backgroundColor: emailBrand.cream, fontFamily: emailBrand.sans, padding: "32px 0" };
const container = {
  backgroundColor: emailBrand.workSurface,
  border: `1px solid ${emailBrand.paperEdge}`,
  borderRadius: "12px",
  padding: "28px 28px 36px",
  maxWidth: "640px",
};
const eyebrow = {
  fontSize: "11px",
  letterSpacing: "0.18em",
  color: emailBrand.signal,
  margin: "0 0 6px",
  fontWeight: 700 as const,
  textTransform: "uppercase" as const,
};
const h1 = {
  fontSize: "22px",
  fontWeight: 650 as const,
  color: emailBrand.ink,
  margin: "0 0 8px",
  lineHeight: 1.25,
};
const meta = { fontSize: "13px", color: emailBrand.muted, margin: 0 };
const noteBox = emailStyles.inset;
const noteText = { fontSize: "13.5px", color: emailBrand.ink, margin: 0, lineHeight: 1.5 };
const hr = { borderColor: emailBrand.paperEdge, margin: "20px 0" };
const label = {
  fontSize: "11px",
  letterSpacing: "0.18em",
  color: emailBrand.muted,
  margin: "0 0 8px",
  fontWeight: 700 as const,
  textTransform: "uppercase" as const,
};
const pre = emailStyles.pre;
const footer = { fontSize: "11px", color: emailBrand.muted, margin: 0 };
