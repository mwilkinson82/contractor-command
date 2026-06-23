import React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { emailStyles } from "./_brand";
import type { TemplateEntry } from "./registry";

interface AdminActivityNoticeProps {
  /** Short event label, e.g. "Member signed in" or "Password set". */
  event?: string;
  /** Email of the user the event is about. */
  memberEmail?: string;
  /** Optional display name. */
  memberName?: string;
  /** ISO timestamp when it happened. */
  occurredAt?: string;
}

const AdminActivityNoticeEmail = ({
  event = "Member activity",
  memberEmail = "—",
  memberName,
  occurredAt,
}: AdminActivityNoticeProps) => {
  const when = occurredAt
    ? new Date(occurredAt).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "just now";

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>
        {event} — {memberName || memberEmail}
      </Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Section style={emailStyles.card}>
            <Section style={emailStyles.headerBar}>
              <Text style={emailStyles.brandText}>ALP Contractor Circle</Text>
            </Section>
            <Section style={emailStyles.body}>
              <Text style={emailStyles.eyebrow}>Admin notice</Text>
              <Heading style={emailStyles.h1}>{event}</Heading>
              <Text style={row}>
                <strong>Who:</strong> {memberName ? `${memberName} ` : ""}
                &lt;{memberEmail}&gt;
              </Text>
              <Text style={row}>
                <strong>When:</strong> {when}
              </Text>
            </Section>
          </Section>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: AdminActivityNoticeEmail,
  subject: (d: Record<string, any>) =>
    `${d?.event || "Member activity"} — ${d?.memberName || d?.memberEmail || "member"}`,
  displayName: "Admin activity notice",
  to: "wilkinson.marshall@gmail.com",
  previewData: {
    event: "Member signed in",
    memberEmail: "sam@example.com",
    memberName: "Sam Carter",
    occurredAt: new Date().toISOString(),
  },
} satisfies TemplateEntry;

const row = {
  fontSize: "14px",
  color: "#1C1A17",
  margin: "0 0 10px",
  lineHeight: 1.55,
};
