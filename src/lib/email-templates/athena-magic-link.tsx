import * as React from "react";
import { Body, Button, Container, Heading, Html, Img, Preview, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { EmailSection, responsiveEmail, ResponsiveEmailHead } from "./_responsive";
import { emailBrand, emailStyles } from "./_brand";

// Athena sign-in email. Selected server-side only after a validated, signed
// OAuth consent continuation. Presentation only: the confirmation URL is
// passed through unchanged. No membership copy.

export const ATHENA_SIGN_IN_SUBJECT = "Sign into Athena";
export const ATHENA_SIGN_IN_BODY =
  "Use the secure link below to sign into Athena and continue connecting your account.";
const ATHENA_LOGO_URL = "https://app.alpcontractorcircle.com/brand/athena/athena-mono-blue-512.png";

// 0.8.8: Athena blue brand (mono-blue mark, #2563EB accents) replaces the old orange.
const ATHENA_BLUE = "#2563EB";

interface AthenaMagicLinkEmailProps {
  confirmationUrl: string;
  otpCode?: string;
}

export const AthenaMagicLinkEmail = ({ confirmationUrl, otpCode }: AthenaMagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <ResponsiveEmailHead />
    <Preview>{ATHENA_SIGN_IN_SUBJECT}</Preview>
    <Body style={responsiveEmail.main}>
      <Container style={responsiveEmail.container}>
        <EmailSection style={responsiveEmail.card}>
          <EmailSection style={styles.header}>
            <Img
              src={ATHENA_LOGO_URL}
              width="96"
              alt="Athena powered by ALP, construction agents"
              style={{ display: "block", width: 96, height: "auto" }}
            />
            <Text style={styles.label}>Athena powered by ALP, construction agents</Text>
          </EmailSection>
          <EmailSection style={responsiveEmail.body}>
            <Heading style={emailStyles.h1}>{ATHENA_SIGN_IN_SUBJECT}</Heading>
            <Text style={emailStyles.text}>{ATHENA_SIGN_IN_BODY}</Text>
            <Button style={{ ...responsiveEmail.button, backgroundColor: ATHENA_BLUE, borderColor: ATHENA_BLUE, color: "#FFFFFF" }} href={confirmationUrl}>
              {ATHENA_SIGN_IN_SUBJECT}
            </Button>
            {otpCode ? (
              <>
                <Text style={emailStyles.text}>Or type this code on the sign-in page you already have open:</Text>
                <Text style={styles.code}>{otpCode}</Text>
              </>
            ) : null}
            <Text style={styles.footer}>
              If you didn't request this link, you can safely ignore this email.
            </Text>
          </EmailSection>
        </EmailSection>
      </Container>
    </Body>
  </Html>
);

export default AthenaMagicLinkEmail;

export const template = {
  component: AthenaMagicLinkEmail,
  subject: ATHENA_SIGN_IN_SUBJECT,
  displayName: "Athena magic link",
  previewData: { confirmationUrl: "https://app.alpcontractorcircle.com/auth/callback" },
} satisfies TemplateEntry;

const styles = {
  header: {
    backgroundColor: "#EFF6FF",
    borderTop: `5px solid ${ATHENA_BLUE}`,
    padding: "26px 16px 20px",
    width: "100%",
    tableLayout: "fixed",
  },
  label: {
    color: "#5B616B",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 10,
    lineHeight: "17px",
    letterSpacing: "1.35px",
    textTransform: "uppercase",
    margin: "18px 0 0",
  },
  code: {
    color: "#0F1E3D",
    fontFamily: "Menlo, Consolas, monospace",
    fontSize: 28,
    fontWeight: 700,
    letterSpacing: "6px",
    margin: "4px 0 0",
  },
  footer: {
    ...emailStyles.footer,
    borderTop: `1px solid ${emailBrand.paperEdge}`,
    margin: "28px 0 0",
    paddingTop: "18px",
  },
} as const;
