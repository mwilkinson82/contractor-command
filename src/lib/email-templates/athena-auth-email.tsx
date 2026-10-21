import * as React from "react";
import { Body, Button, Container, Heading, Html, Img, Preview, Section, Text } from "@react-email/components";

// Athena auth emails (sign-in link, typed code, invite, signup, reset, email
// change). Presentation only: the confirmation URL is passed through unchanged.
// White background, the slanted blue A, navy and blue text, a blue button.
// No Circle copy, no orange, no red.

export const ATHENA_EMAIL_LOGO_URL = "https://app.meetathena.io/brand/athena/email/athena-mark-180.png";
export const ATHENA_BLUE = "#1E5FED";
export const ATHENA_NAVY = "#0F1E3D";
const ATHENA_SLATE = "#3B4A66";
const ATHENA_MUTED = "#6B7488";
const ATHENA_LINE = "#E3E8F2";
export const ATHENA_TAGLINE = "Athena powered by ALP";

export type AthenaAuthKind =
  | "magiclink"
  | "code"
  | "invite"
  | "signup"
  | "recovery"
  | "email_change";

type Copy = { subject: string; heading: string; body: string; button?: string };

export const ATHENA_AUTH_COPY: Record<AthenaAuthKind, Copy> = {
  magiclink: {
    subject: "Sign in to Athena",
    heading: "Sign in to Athena",
    body: "Use the secure button below to sign in to Athena. The link works once, so open the newest email only.",
    button: "Sign in to Athena",
  },
  code: {
    subject: "Your Athena sign-in code",
    heading: "Your Athena sign-in code",
    body: "Type this code on the Athena page you already have open.",
  },
  invite: {
    subject: "You're invited to Athena",
    heading: "You're invited to Athena",
    body: "Your team added you to Athena. Accept below to sign in and see the jobs shared with you.",
    button: "Accept and sign in",
  },
  signup: {
    subject: "Confirm your email for Athena",
    heading: "Confirm your email",
    body: "Confirm this address to finish setting up your Athena account.",
    button: "Confirm email",
  },
  recovery: {
    subject: "Reset your Athena password",
    heading: "Reset your password",
    body: "Use the button below to choose a new password for Athena.",
    button: "Reset password",
  },
  email_change: {
    subject: "Confirm your new email for Athena",
    heading: "Confirm your new email",
    body: "Confirm this change to use the new address for Athena.",
    button: "Confirm new email",
  },
};

export const ATHENA_CONNECT_BODY =
  "Use the secure button below to sign in to Athena and finish connecting your AI app.";

export interface AthenaAuthEmailProps {
  kind: AthenaAuthKind;
  confirmationUrl?: string;
  /** One-time code shown for typed entry (sign-in code, or alongside a link). */
  code?: string;
  /** Sign-in started from an AI app connect. */
  connecting?: boolean;
  newEmail?: string;
}

export function athenaAuthSubject(kind: AthenaAuthKind): string {
  return ATHENA_AUTH_COPY[kind].subject;
}

export const AthenaAuthEmail = ({ kind, confirmationUrl, code, connecting, newEmail }: AthenaAuthEmailProps) => {
  const copy = ATHENA_AUTH_COPY[kind];
  const body = kind === "magiclink" && connecting ? ATHENA_CONNECT_BODY : copy.body;
  const showButton = Boolean(copy.button && confirmationUrl && kind !== "code");
  return (
    <Html lang="en" dir="ltr">
      <Preview>{copy.subject}</Preview>
      <Body style={s.main}>
        <Container style={s.container}>
          <Section style={s.header}>
            <Img src={ATHENA_EMAIL_LOGO_URL} width="56" height="56" alt="Athena" style={s.logo} />
            <Text style={s.tagline}>{ATHENA_TAGLINE}</Text>
          </Section>
          <Section style={s.body}>
            <Heading style={s.h1}>{copy.heading}</Heading>
            <Text style={s.text}>{body}</Text>
            {kind === "email_change" && newEmail ? (
              <Text style={s.text}>
                New email: <strong style={{ color: ATHENA_NAVY }}>{newEmail}</strong>
              </Text>
            ) : null}
            {showButton ? (
              <Section style={{ margin: "28px 0 8px" }}>
                <Button href={confirmationUrl} style={s.button}>
                  {copy.button}
                </Button>
              </Section>
            ) : null}
            {code ? (
              <>
                {showButton ? (
                  <Text style={s.text}>Or type this code on the sign-in page you already have open:</Text>
                ) : null}
                <Text style={s.code}>{code}</Text>
              </>
            ) : null}
            <Text style={s.footer}>
              If you didn't ask for this, you can safely ignore this email. Nobody can sign in without this link or code.
            </Text>
          </Section>
        </Container>
        <Text style={s.legal}>{ATHENA_TAGLINE} · app.meetathena.io</Text>
      </Body>
    </Html>
  );
};

export default AthenaAuthEmail;

const font = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const s = {
  main: { backgroundColor: "#FFFFFF", fontFamily: font, margin: 0, padding: "32px 12px" },
  container: {
    backgroundColor: "#FFFFFF",
    border: `1px solid ${ATHENA_LINE}`,
    borderRadius: 14,
    maxWidth: 520,
    margin: "0 auto",
    overflow: "hidden",
  },
  header: { padding: "32px 36px 0" },
  logo: { display: "block", width: 56, height: 56 },
  tagline: {
    color: ATHENA_BLUE,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "1.4px",
    textTransform: "uppercase" as const,
    margin: "14px 0 0",
  },
  body: { padding: "8px 36px 32px" },
  h1: { color: ATHENA_NAVY, fontSize: 26, lineHeight: "32px", fontWeight: 800, margin: "18px 0 12px" },
  text: { color: ATHENA_SLATE, fontSize: 15, lineHeight: "24px", margin: "0 0 12px" },
  button: {
    backgroundColor: ATHENA_BLUE,
    borderRadius: 10,
    color: "#FFFFFF",
    display: "inline-block",
    fontSize: 15,
    fontWeight: 700,
    padding: "14px 26px",
    textDecoration: "none",
  },
  code: {
    color: ATHENA_NAVY,
    backgroundColor: "#F2F6FF",
    border: `1px solid ${ATHENA_LINE}`,
    borderRadius: 10,
    fontFamily: "Menlo, Consolas, monospace",
    fontSize: 30,
    fontWeight: 700,
    letterSpacing: "8px",
    padding: "14px 18px",
    textAlign: "center" as const,
    margin: "8px 0 4px",
  },
  footer: {
    color: ATHENA_MUTED,
    fontSize: 12,
    lineHeight: "19px",
    borderTop: `1px solid ${ATHENA_LINE}`,
    margin: "28px 0 0",
    paddingTop: 18,
  },
  legal: { color: ATHENA_MUTED, fontSize: 11, textAlign: "center" as const, margin: "18px 0 0" },
} as const;
