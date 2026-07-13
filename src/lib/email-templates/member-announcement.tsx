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
import ReactMarkdown, { type Components } from "react-markdown";
import { emailStyles } from "./_brand";
import type { TemplateEntry } from "./registry";
import {
  ANNOUNCEMENT_MARKDOWN_ELEMENTS,
  announcementUrlTransform,
} from "@/lib/announcement-markdown";

interface MemberAnnouncementProps {
  /** First name, used in greeting. Falls back gracefully when missing. */
  firstName?: string;
  /** Short preview / preheader text shown in inbox list. */
  preheader?: string;
  /** Headline at the top of the email. */
  headline?: string;
  /** Markdown body rendered through a restricted, email-safe component map. */
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

              <Text style={greeting}>{firstName ? `${firstName} —` : "Hey —"}</Text>

              <ReactMarkdown
                allowedElements={ANNOUNCEMENT_MARKDOWN_ELEMENTS}
                unwrapDisallowed
                urlTransform={announcementUrlTransform}
                components={EMAIL_MARKDOWN_COMPONENTS}
              >
                {body}
              </ReactMarkdown>

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
  subject: (d: Record<string, unknown>) =>
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
const heading2 = {
  fontFamily: "Georgia, 'Times New Roman', serif",
  fontSize: "24px",
  fontWeight: 400,
  lineHeight: 1.2,
  color: "#1C1A17",
  margin: "24px 0 12px",
};
const heading3 = {
  fontSize: "17px",
  fontWeight: 600,
  lineHeight: 1.35,
  color: "#1C1A17",
  margin: "20px 0 10px",
};
const strong = { fontWeight: 700 };
const italic = { fontStyle: "italic" as const };
const list = {
  fontSize: "15px",
  color: "#1C1A17",
  lineHeight: 1.6,
  margin: "0 0 16px",
  paddingLeft: "24px",
};
const listItem = { margin: "0 0 6px" };
const link = {
  color: "#A84F36",
  fontWeight: 600,
  textDecoration: "underline",
};
const image = {
  display: "block",
  width: "100%",
  maxWidth: "560px",
  height: "auto",
  margin: "20px auto",
  borderRadius: "10px",
};
const blockquote = {
  color: "#5F5A52",
  fontSize: "15px",
  fontStyle: "italic" as const,
  lineHeight: 1.6,
  borderLeft: "3px solid #F06B43",
  margin: "18px 0",
  padding: "2px 0 2px 16px",
};
const contentRule = {
  borderColor: "#E8E1D7",
  margin: "22px 0",
};

const EMAIL_MARKDOWN_COMPONENTS: Components = {
  h2: ({ children }) => <h2 style={heading2}>{children}</h2>,
  h3: ({ children }) => <h3 style={heading3}>{children}</h3>,
  p: ({ children }) => <p style={paragraph}>{children}</p>,
  strong: ({ children }) => <strong style={strong}>{children}</strong>,
  em: ({ children }) => <em style={italic}>{children}</em>,
  ul: ({ children }) => <ul style={list}>{children}</ul>,
  ol: ({ children }) => <ol style={list}>{children}</ol>,
  li: ({ children }) => <li style={listItem}>{children}</li>,
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noreferrer" style={link}>
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  img: ({ src, alt }) =>
    src ? <img src={src} alt={alt ?? ""} width="100%" style={image} /> : null,
  blockquote: ({ children }) => <blockquote style={blockquote}>{children}</blockquote>,
  hr: () => <hr style={contentRule} />,
};
