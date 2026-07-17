import * as React from "react";
import { TransactionalEmail } from "./_transactional-email";

interface RecoveryEmailProps {
  siteName: string;
  confirmationUrl: string;
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: RecoveryEmailProps) => (
  <TransactionalEmail
    preview={`Reset your password for ${siteName}`}
    label="Account recovery"
    title="Reset your password"
    actionLabel="Reset password"
    actionUrl={confirmationUrl}
    footer="If you didn't request a password reset, you can safely ignore this email. Your password will not be changed."
  >
    We received a request to reset your password for {siteName}. Choose a new password to get back
    into the Command Center.
  </TransactionalEmail>
);

export default RecoveryEmail;
