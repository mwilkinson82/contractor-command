import * as React from "react";
import { Link } from "@react-email/components";
import { TransactionalEmail, transactionalLinkStyle } from "./_transactional-email";

interface SignupEmailProps {
  siteName: string;
  siteUrl: string;
  recipient: string;
  confirmationUrl: string;
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
}: SignupEmailProps) => (
  <TransactionalEmail
    preview={`Confirm your email for ${siteName}`}
    label="Email verification"
    title="Confirm your email"
    actionLabel="Verify email"
    actionUrl={confirmationUrl}
    footer="If you didn't create an account, you can safely ignore this email."
  >
    Thanks for signing up for{" "}
    <Link href={siteUrl} style={transactionalLinkStyle}>
      <strong>{siteName}</strong>
    </Link>
    . Confirm{" "}
    <Link href={`mailto:${recipient}`} style={transactionalLinkStyle}>
      {recipient}
    </Link>{" "}
    to enter the Command Center.
  </TransactionalEmail>
);

export default SignupEmail;
