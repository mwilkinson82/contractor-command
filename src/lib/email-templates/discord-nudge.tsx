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
import { DISCORD_URL } from "../program";
import { ContractorCircleEmailFooter, ContractorCircleEmailHeader } from "./_brand-components";

interface DiscordNudgeProps {
  siteName?: string;
  discordUrl?: string;
  firstName?: string;
}

const DiscordNudgeEmail = ({
  siteName = "Contractor Circle",
  discordUrl = DISCORD_URL,
  firstName,
}: DiscordNudgeProps) => {
  const name = firstName?.trim();
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>The room is where the magic is — join the Discord.</Preview>
      <Body style={main}>
        <Container style={container}>
          <ContractorCircleEmailHeader label="The room" />
          <Section style={card}>
            <Text style={eyebrow}>ALP CONTRACTOR CIRCLE · THE ROOM</Text>
            <Heading style={h1}>
              {name ? `${name}, the room is where it happens.` : "The room is where it happens."}
            </Heading>
            <Text style={lede}>
              The calls are the big moments. Discord is where the actual work happens between them —
              deals being closed, contracts being pressure-tested, hires being vetted, every day,
              all day.
            </Text>
            <Text style={lede}>
              Drop into <strong>#welcome</strong>, then <strong>#general-chat</strong>. The rest of
              the room is already in there waiting on you.
            </Text>
            <Section style={ctaWrap}>
              <Button style={button} href={discordUrl}>
                Open the Discord
              </Button>
              <Text style={ctaNote}>
                Free, members-only.{" "}
                <Link href={discordUrl} style={inlineLink}>
                  {discordUrl.replace(/^https?:\/\//, "")}
                </Link>
              </Text>
            </Section>
            <Text style={footer}>
              Already inside? Ignore this — we won't nudge again. Not your thing? Reply and we'll
              skip future Discord nudges.
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
  component: DiscordNudgeEmail,
  subject: (d: Record<string, unknown>) =>
    typeof d?.firstName === "string"
      ? `${d.firstName}, the room is waiting on you`
      : "The room is waiting on you",
  displayName: "Discord nudge (not in guild)",
  previewData: {
    firstName: "Cesar",
    siteName: "Contractor Circle",
    discordUrl: DISCORD_URL,
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
  fontSize: "32px",
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
  margin: "0 0 18px",
  fontFamily: sansFamily,
};
const ctaWrap = { margin: "10px 0 8px" };
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
