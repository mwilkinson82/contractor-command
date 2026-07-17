import * as React from "react";
import { Link } from "@react-email/components";
import { TransactionalEmail, transactionalLinkStyle } from "./_transactional-email";

interface EmailChangeEmailProps {
  siteName: string;
  oldEmail: string;
  email: string;
  newEmail: string;
  confirmationUrl: string;
}

export const EmailChangeEmail = ({
  siteName,
  oldEmail,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <TransactionalEmail
    preview={`Confirm your email change for ${siteName}`}
    label="Account security"
    title="Confirm your email change"
    actionLabel="Confirm email change"
    actionUrl={confirmationUrl}
    footer="If you didn't request this change, secure your account immediately."
  >
    You requested to change your email address for {siteName} from{" "}
    <Link href={`mailto:${oldEmail}`} style={transactionalLinkStyle}>
      {oldEmail}
    </Link>{" "}
    to{" "}
    <Link href={`mailto:${newEmail}`} style={transactionalLinkStyle}>
      {newEmail}
    </Link>
    .
  </TransactionalEmail>
);

export default EmailChangeEmail;
