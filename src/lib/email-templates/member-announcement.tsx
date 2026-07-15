import React from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import ReactMarkdown, { type Components } from "react-markdown";
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
  const greetingName = firstName?.trim();

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preheader}</Preview>
      <Body style={layout.main}>
        <Container style={layout.container}>
          <Section style={layout.shell}>
            <Section style={layout.header}>
              <Row>
                <Column>
                  <Text style={layout.brand}>ALP Contractor Circle</Text>
                </Column>
                <Column align="right">
                  <Text style={layout.headerLabel}>Member operating brief</Text>
                </Column>
              </Row>
            </Section>

            <Section style={layout.body}>
              <Section style={layout.verdictBand}>
                <Text style={layout.eyebrow}>Contractor Circle / Member note</Text>
                <Heading style={layout.headline}>{headline}</Heading>
              </Section>

              <Text style={greeting}>{greetingName ? `${greetingName} —` : "Hi there —"}</Text>

              <ReactMarkdown
                allowedElements={ANNOUNCEMENT_MARKDOWN_ELEMENTS}
                unwrapDisallowed
                urlTransform={announcementUrlTransform}
                components={EMAIL_MARKDOWN_COMPONENTS}
              >
                {body}
              </ReactMarkdown>

              {showCta && (
                <Button href={ctaUrl} style={layout.button}>
                  {ctaLabel}
                </Button>
              )}

              <Text style={layout.signoff}>{signoff}</Text>
            </Section>

            <Section style={layout.footer}>
              <Row>
                <Column style={layout.footerWordmarkColumn}>
                  <Text style={layout.footerWordmark}>
                    ALP Contractor Circle <span style={layout.claySquare}>■</span>
                  </Text>
                </Column>
                <Column align="right">
                  <Text style={layout.productMark}>— an ALP product</Text>
                  <Text style={layout.productLine}>Build the company behind the projects.</Text>
                </Column>
              </Row>
            </Section>
          </Section>

          <Text style={layout.deliveryNote}>
            Sent to Contractor Circle members as part of their active membership.
          </Text>
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

const announcementBrand = {
  paper: "#FAF9F5",
  surface: "#FFFFFF",
  paper2: "#F0EEE6",
  edge: "#E4E1D6",
  ink: "#1F1E1B",
  muted: "#76736B",
  signal: "#D97757",
  clay: "#C36E4F",
  serif: '"Source Serif 4", Georgia, "Times New Roman", serif',
  sans: 'Archivo, "Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: '"JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace',
} as const;

const greeting = {
  fontFamily: announcementBrand.sans,
  fontSize: "14px",
  color: announcementBrand.muted,
  margin: "0 0 18px",
  lineHeight: 1.55,
};
const paragraph = {
  fontFamily: announcementBrand.sans,
  fontSize: "15px",
  color: announcementBrand.ink,
  margin: "0 0 16px",
  lineHeight: 1.65,
  whiteSpace: "pre-wrap" as const,
};
const heading2 = {
  fontFamily: announcementBrand.serif,
  fontSize: "25px",
  fontWeight: 400,
  lineHeight: 1.2,
  color: announcementBrand.ink,
  margin: "28px 0 12px",
};
const heading3 = {
  fontFamily: announcementBrand.sans,
  fontSize: "17px",
  fontWeight: 600,
  lineHeight: 1.35,
  color: announcementBrand.ink,
  margin: "20px 0 10px",
};
const strong = { fontWeight: 700 };
const italic = { fontStyle: "italic" as const };
const list = {
  fontFamily: announcementBrand.sans,
  fontSize: "15px",
  color: announcementBrand.ink,
  lineHeight: 1.65,
  margin: "0 0 16px",
  paddingLeft: "24px",
};
const listItem = { margin: "0 0 6px" };
const link = {
  color: announcementBrand.clay,
  fontWeight: 600,
  textDecoration: "underline",
};
const image = {
  display: "block",
  width: "100%",
  maxWidth: "560px",
  height: "auto",
  margin: "24px auto",
  border: `1px solid ${announcementBrand.edge}`,
  borderRadius: "12px",
};
const blockquote = {
  color: announcementBrand.muted,
  fontFamily: announcementBrand.serif,
  fontSize: "15px",
  fontStyle: "italic" as const,
  lineHeight: 1.6,
  borderLeft: `3px solid ${announcementBrand.clay}`,
  margin: "22px 0",
  padding: "2px 0 2px 16px",
};
const contentRule = {
  borderColor: announcementBrand.edge,
  margin: "26px 0",
};

const layout = {
  main: {
    backgroundColor: announcementBrand.paper,
    fontFamily: announcementBrand.sans,
    margin: 0,
    padding: "36px 0",
  },
  container: {
    maxWidth: "620px",
    margin: "0 auto",
    padding: "0 16px",
  },
  shell: {
    backgroundColor: announcementBrand.surface,
    border: `1px solid ${announcementBrand.edge}`,
    borderRadius: "14px",
    overflow: "hidden",
  },
  header: {
    borderBottom: `1px solid ${announcementBrand.edge}`,
    padding: "18px 28px",
  },
  brand: {
    color: announcementBrand.ink,
    fontFamily: announcementBrand.serif,
    fontSize: "17px",
    fontWeight: 600,
    lineHeight: 1.2,
    margin: 0,
  },
  headerLabel: {
    color: announcementBrand.muted,
    fontFamily: announcementBrand.mono,
    fontSize: "8.5px",
    fontWeight: 600,
    letterSpacing: "0.16em",
    lineHeight: 1.3,
    margin: 0,
    textTransform: "uppercase" as const,
  },
  body: {
    padding: "36px 34px 32px",
  },
  verdictBand: {
    borderLeft: `3px solid ${announcementBrand.signal}`,
    marginBottom: "26px",
    paddingLeft: "18px",
  },
  eyebrow: {
    color: announcementBrand.clay,
    fontFamily: announcementBrand.mono,
    fontSize: "9px",
    fontWeight: 600,
    letterSpacing: "0.17em",
    lineHeight: 1.3,
    margin: "0 0 10px",
    textTransform: "uppercase" as const,
  },
  headline: {
    color: announcementBrand.ink,
    fontFamily: announcementBrand.serif,
    fontSize: "34px",
    fontWeight: 400,
    letterSpacing: "-0.025em",
    lineHeight: 1.08,
    margin: 0,
  },
  button: {
    backgroundColor: announcementBrand.ink,
    borderRadius: "8px",
    color: announcementBrand.surface,
    display: "inline-block",
    fontFamily: announcementBrand.sans,
    fontSize: "14px",
    fontWeight: 650,
    margin: "8px 0 24px",
    padding: "14px 22px",
    textDecoration: "none",
  },
  signoff: {
    color: announcementBrand.ink,
    fontFamily: announcementBrand.serif,
    fontSize: "17px",
    fontStyle: "italic",
    lineHeight: 1.45,
    margin: "22px 0 0",
  },
  footer: {
    backgroundColor: announcementBrand.paper,
    borderTop: `1px solid ${announcementBrand.edge}`,
    padding: "22px 28px",
  },
  footerWordmarkColumn: {
    width: "58%",
  },
  footerWordmark: {
    color: announcementBrand.muted,
    fontFamily: announcementBrand.serif,
    fontSize: "20px",
    lineHeight: 1.2,
    margin: 0,
  },
  claySquare: {
    color: announcementBrand.clay,
    fontSize: "12px",
  },
  productMark: {
    color: announcementBrand.ink,
    fontFamily: announcementBrand.mono,
    fontSize: "8.5px",
    fontWeight: 600,
    letterSpacing: "0.12em",
    lineHeight: 1.3,
    margin: "0 0 5px",
    textTransform: "uppercase" as const,
  },
  productLine: {
    color: announcementBrand.muted,
    fontFamily: announcementBrand.sans,
    fontSize: "10px",
    lineHeight: 1.35,
    margin: 0,
  },
  deliveryNote: {
    color: announcementBrand.muted,
    fontFamily: announcementBrand.sans,
    fontSize: "10px",
    lineHeight: 1.5,
    margin: "14px 8px 0",
    textAlign: "center" as const,
  },
} as const;

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
