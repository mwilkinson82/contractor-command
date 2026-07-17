import * as React from "react";
import { TransactionalEmail } from "./_transactional-email";

interface ReauthenticationEmailProps {
  token: string;
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <TransactionalEmail
    preview="Your Contractor Circle verification code"
    label="Identity check"
    title="Confirm it is you"
    code={token}
    footer="This code will expire shortly. If you didn't request this, you can safely ignore this email."
  >
    Use the code below to confirm your identity and continue securely.
  </TransactionalEmail>
);

export default ReauthenticationEmail;
