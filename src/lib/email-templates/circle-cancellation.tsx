import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { emailStyles } from "./_brand";
import { ContractorCircleEmailFooter, ContractorCircleEmailHeader } from "./_brand-components";
import type { CircleCancellationFacts } from "@/lib/email/circle-cancellation";
import { CIRCLE_CANCELLATION_OWNER_EMAIL } from "@/lib/email/circle-cancellation";
import { MEMBER_REPLY_TO } from "@/lib/email/reply-to";
import type { TemplateEntry } from "./registry";

function cancellationDate(value: string): string {
  return (
    new Date(value).toLocaleString("en-US", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC"
  );
}

function CircleCancellationEmail({
  facts,
  owner = false,
}: {
  facts: CircleCancellationFacts;
  owner?: boolean;
}) {
  const headline = owner
    ? "Contractor Circle cancellation"
    : "Your Contractor Circle cancellation confirmation";
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{headline}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Section style={emailStyles.card}>
            <ContractorCircleEmailHeader
              label={owner ? "Owner notice" : "Subscription confirmation"}
            />
            <Section style={emailStyles.body}>
              <Heading style={emailStyles.h1}>{headline}</Heading>
              {owner && (
                <>
                  {facts.customerName && <Text>Customer: {facts.customerName}</Text>}
                  <Text>Member email: {facts.memberEmail}</Text>
                  {facts.billingEmail !== facts.memberEmail && (
                    <Text>Stripe billing email: {facts.billingEmail}</Text>
                  )}
                  <Text>Requested: {cancellationDate(facts.requestedAt)}</Text>
                </>
              )}
              <Text>
                {facts.state === "scheduled"
                  ? `${owner ? "The customer’s" : "Your"} Contractor Circle subscription is scheduled to cancel${facts.effectiveAt ? ` on ${cancellationDate(facts.effectiveAt)}` : ". The effective date is under review"}.`
                  : `${owner ? "The customer’s" : "Your"} Contractor Circle subscription was canceled${facts.effectiveAt ? ` on ${cancellationDate(facts.effectiveAt)}` : ". The effective date is under review"}.`}
              </Text>
              <Text>
                {facts.paidThrough && !facts.reviewReason
                  ? `Verified paid Circle access from this subscription runs through ${cancellationDate(facts.paidThrough)}.`
                  : owner
                    ? "The customer’s paid-access end date is under review."
                    : "Your paid-access end date is under review. Reply to this email if you need help."}
              </Text>
              <Text>
                Any other active subscription or separately granted access is handled independently.
              </Text>
              {owner ? (
                <>
                  {facts.reviewReason && <Text>Review: {facts.reviewReason}</Text>}
                  {!facts.memberAllowed && (
                    <Text>Member confirmation withheld for identity review.</Text>
                  )}
                  {facts.neverEmail && (
                    <Text>Member confirmation withheld by existing email policy.</Text>
                  )}
                  {facts.reason && <Text>Reason provided: {facts.reason}</Text>}
                  {facts.feedback && <Text>Feedback provided: {facts.feedback}</Text>}
                  {facts.comment && <Text>Comment provided: {facts.comment}</Text>}
                </>
              ) : (
                <>
                  <Text>
                    Questions about your cancellation or billing?{" "}
                    <Link href={`mailto:${MEMBER_REPLY_TO}`}>Reply to this email</Link>.
                  </Text>
                  <Text>
                    <Link href="https://app.alpcontractorcircle.com/upgrade?tier=circle">
                      View Contractor Circle membership options
                    </Link>
                  </Text>
                </>
              )}
            </Section>
            <ContractorCircleEmailFooter>
              {owner
                ? "Private Command Center notification."
                : "Contractor Circle subscription confirmation."}
            </ContractorCircleEmailFooter>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export const memberTemplate = {
  component: CircleCancellationEmail,
  subject: "Your Contractor Circle cancellation confirmation",
  displayName: "Circle cancellation confirmation",
} satisfies TemplateEntry;

export const ownerTemplate = {
  component: (props: { facts: CircleCancellationFacts }) => (
    <CircleCancellationEmail {...props} owner />
  ),
  subject: "Contractor Circle cancellation",
  to: CIRCLE_CANCELLATION_OWNER_EMAIL,
  displayName: "Circle cancellation owner notice",
} satisfies TemplateEntry;
