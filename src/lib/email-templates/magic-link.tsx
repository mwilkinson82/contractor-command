import * as React from "react";
import type { TemplateEntry } from "./registry";
import { TransactionalEmail } from "./_transactional-email";

interface MagicLinkEmailProps {
  siteName: string;
  confirmationUrl: string;
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <TransactionalEmail
    preview={`Your login link for ${siteName}`}
    label="Secure login"
    title="Your login link"
    actionLabel="Log in"
    actionUrl={confirmationUrl}
    footer="If you didn't request this link, you can safely ignore this email."
  >
    Click the button below to log in to {siteName}. This link will expire shortly.
  </TransactionalEmail>
);

export default MagicLinkEmail;

export const template = {
  component: MagicLinkEmail,
  subject: (data: Record<string, unknown>) =>
    typeof data?.firstName === "string"
      ? `${data.firstName}, your login link`
      : "Your Contractor Circle login link",
  displayName: "Magic link",
  previewData: {
    firstName: "Caleb",
    siteName: "Contractor Circle",
    confirmationUrl: "https://app.alpcontractorcircle.com/auth/callback",
  },
} satisfies TemplateEntry;
