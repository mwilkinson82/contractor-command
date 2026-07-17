import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { emailBrand } from "./_brand";
import type { TemplateEntry } from "./registry";
import { ContractorCircleEmailFooter, ContractorCircleEmailHeader } from "./_brand-components";

interface LoginNudgeProps {
  siteName?: string;
  siteUrl?: string;
  confirmationUrl?: string;
  firstName?: string;
}

const LoginNudgeEmail = ({
  siteName = "Contractor Circle",
  siteUrl = "https://app.alpcontractorcircle.com",
  confirmationUrl = "https://app.alpcontractorcircle.com/login",
  firstName,
}: LoginNudgeProps) => {
  const name = firstName?.trim();
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your seat at {siteName} is waiting — one click to step inside.</Preview>
      <Body style={main}>
        <Container style={container}>
          <ContractorCircleEmailHeader label="Member access" />
          <Section style={card}>
            <Text style={eyebrow}>ALP CONTRACTOR CIRCLE · QUICK NUDGE</Text>
            <Heading style={h1}>
              {name ? `${name}, your seat is waiting.` : "Your seat is waiting."}
            </Heading>
            <Text style={lede}>
              You're paid up and you're in the room — but we haven't seen you log in yet. Use the
              email this was sent to and your password to step inside the portal: Vault, replays,
              AOS Engine, the whole thing.
            </Text>
            <Section style={ctaWrap}>
              <Button style={button} href={confirmationUrl}>
                Sign in
              </Button>
              <Text style={ctaNote}>
                Opens at{" "}
                <Link href={siteUrl} style={inlineLink}>
                  app.alpcontractorcircle.com
                </Link>
                . If you need a new password, use the reset link on the login page.
              </Text>
            </Section>
            <Text style={footer}>
              Already in? Ignore this — we won't nudge again. Trouble with the link? Reply and we'll
              get you in by hand.
            </Text>
          </Section>
          <Text style={signoff}>— Marshall &amp; the ALP team</Text>
          <ContractorCircleEmailFooter />
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: LoginNudgeEmail,
  subject: (d: Record<string, unknown>) =>
    typeof d?.firstName === "string"
      ? `${d.firstName}, your seat is waiting`
      : "Your seat at the Circle is waiting",
  displayName: "Login nudge (magic link)",
  previewData: {
    firstName: "Cesar",
    siteName: "Contractor Circle",
    siteUrl: "https://app.alpcontractorcircle.com",
    confirmationUrl: "https://app.alpcontractorcircle.com/login",
  },
} satisfies TemplateEntry;

const sansFamily = emailBrand.sans;
const serifFamily = emailBrand.sans;
const monoFamily = emailBrand.mono;
const INK = emailBrand.ink,
  INK_SOFT = emailBrand.inkPanel,
  MUTED = emailBrand.muted;
const PAPER = emailBrand.workSurface,
  HAIRLINE = emailBrand.paperEdge,
  SIGNAL = emailBrand.signal;

const main = {
  backgroundColor: emailBrand.cream,
  fontFamily: sansFamily,
  margin: 0,
  padding: "32px 0",
};
const container = { maxWidth: "560px", margin: "0 auto", padding: "0 16px" };
const card = {
  backgroundColor: PAPER,
  border: `1px solid ${HAIRLINE}`,
  borderRadius: "20px",
  padding: "40px 36px",
};
const eyebrow = {
  fontSize: "11px",
  letterSpacing: "0.22em",
  color: MUTED,
  margin: "0 0 18px",
  fontFamily: monoFamily,
};
const h1 = {
  fontSize: "34px",
  fontWeight: 400,
  color: INK,
  lineHeight: 1.1,
  margin: "0 0 16px",
  fontFamily: serifFamily,
  letterSpacing: "-0.01em",
};
const lede = {
  fontSize: "16px",
  color: INK_SOFT,
  lineHeight: 1.55,
  margin: "0 0 28px",
  fontFamily: sansFamily,
};
const ctaWrap = { margin: "4px 0 8px" };
const button = {
  backgroundColor: INK,
  color: PAPER,
  fontSize: "13px",
  letterSpacing: "0.22em",
  textTransform: "uppercase" as const,
  borderRadius: "999px",
  padding: "16px 28px",
  textDecoration: "none",
  display: "inline-block",
  fontWeight: 500,
  fontFamily: monoFamily,
};
const ctaNote = {
  fontSize: "12px",
  color: MUTED,
  margin: "14px 0 0",
  lineHeight: 1.5,
  fontFamily: sansFamily,
};
const inlineLink = { color: SIGNAL, textDecoration: "underline" };
const footer = {
  fontSize: "12px",
  color: MUTED,
  margin: "24px 0 0",
  lineHeight: 1.55,
  fontFamily: sansFamily,
};
const signoff = {
  fontSize: "13px",
  color: INK,
  margin: "20px 4px 0",
  textAlign: "center" as const,
  fontFamily: sansFamily,
};
