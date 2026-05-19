import React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";
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
      <Body style={main}>
        <Container style={container}>
          <Text style={eyebrow}>ALP CONTRACTOR CIRCLE · ADMIN</Text>
          <Heading style={h1}>{event}</Heading>
          <Text style={row}>
            <strong>Who:</strong> {memberName ? `${memberName} ` : ""}
            &lt;{memberEmail}&gt;
          </Text>
          <Text style={row}>
            <strong>When:</strong> {when}
          </Text>
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

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "32px 28px 40px", maxWidth: "560px" };
const eyebrow = {
  fontSize: "10px",
  letterSpacing: "0.22em",
  color: "#7a7a7a",
  margin: "0 0 12px",
  fontWeight: 600 as const,
};
const h1 = {
  fontSize: "22px",
  fontWeight: 700 as const,
  color: "#111111",
  margin: "0 0 18px",
  lineHeight: 1.25,
};
const row = {
  fontSize: "14px",
  color: "#222222",
  margin: "0 0 10px",
  lineHeight: 1.55,
};
