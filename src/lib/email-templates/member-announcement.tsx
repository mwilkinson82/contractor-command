import React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { emailStyles } from "./_brand";
import type { TemplateEntry } from "./registry";

interface MemberAnnouncementProps {
  /** First name, used in greeting. Falls back gracefully when missing. */
  firstName?: string;
  /** Short preview / preheader text shown in inbox list. */
  preheader?: string;
  /** Headline at the top of the email. */
  headline?: string;
  /**
   * Body text. Split into paragraphs by blank lines.
   * No markdown — keep it plain text, React escapes everything.
   */
  body?: string;
  /** Optional CTA button label. If set with ctaUrl, a button renders. */
  ctaLabel?: string;
  ctaUrl?: string;
  /** Sign-off line. */
  signoff?: string;
}

const MemberAnnouncementEmail = ({
  firstName,
  preheader = "An update from the ALP Contractor Circle",
  headline = "An update from the Contractor Circle",
  body = "",
  ctaLabel,
  ctaUrl,
  signoff = "— Marshall",
}: MemberAnnouncementProps) => {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const showCta = !!(ctaLabel && ctaUrl);

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preheader}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Section style={emailStyles.card}>
            <Section style={emailStyles.headerBar}>
              <Text style={emailStyles.brandText}>ALP Contractor Circle</Text>
            </Section>
            <Section style={emailStyles.body}>
              <Text style={emailStyles.eyebrow}>Member note</Text>
              <Heading style={emailStyles.h1}>{headline}</Heading>

              <Text style={greeting}>
                {firstName ? `${firstName} —` : "Hey —"}
              </Text>

              {paragraphs.map((p, i) => (
                <Text key={i} style={paragraph}>
                  {p}
                </Text>
              ))}

              {showCta && (
                <Button href={ctaUrl} style={emailStyles.button}>
                  {ctaLabel}
                </Button>
              )}

              <Hr style={emailStyles.hr} />
              <Text style={emailStyles.footer}>{signoff}</Text>
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: MemberAnnouncementEmail,
  subject: (d: Record<string, any>) =>
    (d?.subject as string) || "An update from the ALP Contractor Circle",
  displayName: "Member announcement",
  previewData: {
    firstName: "Sam",
    preheader: "Your membership is active — set your password to get in.",
    headline: "Welcome to the new Contractor Circle portal",
    body: `The Circle has a new home. Everything you already had access to — Ask Marshall, the Vault, Calls, SOPs — is now in one portal we built from scratch for members.

Your membership is already active on the new system. To get in, set your password using the link below — takes about 60 seconds.`,
    ctaLabel: "Set your password",
    ctaUrl: "https://app.alpcontractorcircle.com/login",
    signoff: "— Marshall",
  },
} satisfies TemplateEntry;

const greeting = {
  fontSize: "15px",
  color: "#1C1A17",
  margin: "0 0 14px",
  lineHeight: 1.5,
};
const paragraph = {
  fontSize: "15px",
  color: "#1C1A17",
  margin: "0 0 14px",
  lineHeight: 1.6,
  whiteSpace: "pre-wrap" as const,
};
