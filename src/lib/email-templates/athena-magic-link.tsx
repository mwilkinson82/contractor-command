import * as React from "react";
import type { TemplateEntry } from "./registry";
import { AthenaAuthEmail, ATHENA_AUTH_COPY } from "./athena-auth-email";

// Athena sign-in email for the direct login path (requestMemberMagicLink).
// Chosen for any sign-in started on the Athena host or from an AI app connect.
// Presentation only: the confirmation URL is passed through unchanged.

export const ATHENA_SIGN_IN_SUBJECT = ATHENA_AUTH_COPY.magiclink.subject;

interface AthenaMagicLinkEmailProps {
  confirmationUrl: string;
  otpCode?: string;
  connecting?: boolean;
}

export const AthenaMagicLinkEmail = ({ confirmationUrl, otpCode, connecting }: AthenaMagicLinkEmailProps) => (
  <AthenaAuthEmail kind="magiclink" confirmationUrl={confirmationUrl} code={otpCode} connecting={connecting} />
);

export default AthenaMagicLinkEmail;

export const template = {
  component: AthenaMagicLinkEmail,
  subject: ATHENA_SIGN_IN_SUBJECT,
  displayName: "Athena magic link",
  previewData: { confirmationUrl: "https://app.meetathena.io/auth/callback" },
} satisfies TemplateEntry;
