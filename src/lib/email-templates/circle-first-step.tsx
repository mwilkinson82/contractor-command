import { EmailSection } from "./_responsive";
import * as React from "react";
import {
  Body,
  Button,
  Container,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { ContractorCircleEmailHeader, ContractorCircleEmailFooter } from "./_brand-components";
import { responsiveEmail, ResponsiveEmailHead } from "./_responsive";
import type { TemplateEntry } from "./registry";
/** Available for explicit admin use; no automatic campaign or new send trigger. */
export function CircleFirstStepEmail({
  firstName,
  startHereUrl = "https://app.alpcontractorcircle.com/start-here",
}: {
  firstName?: string;
  startHereUrl?: string;
}) {
  return (
    <Html lang="en">
      <ResponsiveEmailHead />
      <Preview>Start with one clear step.</Preview>
      <Body style={responsiveEmail.main}>
        <Container style={responsiveEmail.container}>
          <ContractorCircleEmailHeader label="Your first step" />
          <EmailSection style={{ ...responsiveEmail.card, ...responsiveEmail.body }}>
            <Heading
              style={{
                color: "#1C1A17",
                fontSize: 34,
                lineHeight: "38px",
                margin: "0 0 24px",
                overflowWrap: "anywhere",
              }}
            >
              Start with one clear step.
            </Heading>
            <Text>Hi {firstName?.trim() || "there"},</Text>
            <Text>
              Start Here brings together the Professional Contractor Control Loop video, one-pager
              and first steps.
            </Text>
            <EmailSection
              style={{
                backgroundColor: "#F7F2EA",
                padding: 16,
                tableLayout: "fixed",
                width: "100%",
              }}
            >
              <Text>
                See the Control Loop. Then use the State of Control assessment to identify the
                constraint in your business.
              </Text>
            </EmailSection>
            <Button href={startHereUrl} style={{ ...responsiveEmail.button, marginTop: 24 }}>
              Open Start Here
            </Button>
            <Text>Marshall &amp; the ALP team</Text>
          </EmailSection>
          <ContractorCircleEmailFooter />
        </Container>
      </Body>
    </Html>
  );
}
export const template = {
  component: CircleFirstStepEmail,
  subject: "Start with one clear step.",
  displayName: "Circle first step",
  previewData: { firstName: "Sam" },
} satisfies TemplateEntry;
