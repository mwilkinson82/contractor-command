import * as React from "react";
import { Link } from "@react-email/components";
import { TransactionalEmail, transactionalLinkStyle } from "./_transactional-email";

interface InviteEmailProps {
  siteName: string;
  siteUrl: string;
  confirmationUrl: string;
}

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <TransactionalEmail
    preview={`You've been invited to join ${siteName}`}
    label="Member invitation"
    title="You've been invited"
    actionLabel="Accept invitation"
    actionUrl={confirmationUrl}
    footer="If you weren't expecting this invitation, you can safely ignore this email."
  >
    You&apos;ve been invited to join{" "}
    <Link href={siteUrl} style={transactionalLinkStyle}>
      <strong>{siteName}</strong>
    </Link>
    . Accept the invitation to create your account and enter the Command Center.
  </TransactionalEmail>
);

export default InviteEmail;
